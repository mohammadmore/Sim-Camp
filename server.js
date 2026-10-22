import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import { store as rawStore, adapterName, ConflictError, ExistsError, NotFoundError } from './db/index.js';
import { createCampRepo, TooLargeError, MEDIA_NAME_RE, MEDIA_TYPES, mediaNameFor } from './lib/campRepo.js';
import { BACKUP_FORMAT, buildBackup, allCampIds } from './lib/backup.js';
import {
    DEFAULT_POSITIVE_TAGS, DEFAULT_NEGATIVE_TAGS, DEFAULT_FIELD_JUDGING_VALUES, DEFAULT_LADDER, OVERRIDE_KEY,
    isValidId, isPlainObject, parseMaybeJson, isDnfValue, num, round2, parseLadder, normalizeTeam, recomputeTeamScore,
    applyJudgesToStage, computeTieredResults, mergeTeams, publicUser, displayName
} from './lib/campLogic.js';
import {
    hashPassword, isHashed, verifyPassword, randomPassword, randomSecret, createToken, verifyToken, createRateLimiter
} from './lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT, 10) || 3000;
// Firestore rejects documents above 1 MiB; keep a safety margin.
// Scores and images are stored outside the camp document, so this is rarely reached.
const MAX_CAMP_BYTES = adapterName === 'firebase' ? 950 * 1024 : 15 * 1024 * 1024;
const ROLES = ['operator', 'head_referee', 'referee'];
const AUDIT_LIMIT = 500;
const MIN_PASSWORD = 6;
const MANAGER_ROLES = ['operator', 'head_referee'];

// Operational limits (all overridable with environment variables).
const envInt = (name, def) => { const v = parseInt(process.env[name], 10); return Number.isFinite(v) && v > 0 ? v : def; };
const DB_TIMEOUT_MS = envInt('DB_TIMEOUT_MS', 10000);        // one database call
const LOCK_WAIT_MS = envInt('LOCK_WAIT_MS', 20000);          // waiting for other writes to the same camp
const LOCK_HOLD_MS = envInt('LOCK_HOLD_MS', 15000);          // one write operation
const RATE_READ_PER_MIN = envInt('RATE_READ_PER_MIN', 3000); // per IP (a whole venue may share one IP)
const RATE_WRITE_PER_MIN = envInt('RATE_WRITE_PER_MIN', 1200);
const SSE_MAX_PER_IP = envInt('SSE_MAX_PER_IP', 100);
const SSE_MAX_TOTAL = envInt('SSE_MAX_TOTAL', 3000);
const BODY_LIMIT_SMALL = process.env.BODY_LIMIT_SMALL || '256kb';
const BODY_LIMIT_LARGE = process.env.BODY_LIMIT_LARGE || '10mb';
const BODY_LIMIT_IMPORT = process.env.BODY_LIMIT_IMPORT || '100mb';
const CACHE_IDLE_MS = envInt('CACHE_IDLE_MINUTES', 10) * 60000;  // unused camps leave the memory cache
const MEDIA_CACHE_BYTES = envInt('MEDIA_CACHE_MB', 64) * 1024 * 1024;
const TRASH_DAYS = envInt('TRASH_DAYS', 30);                      // deleted camps can be restored for this long
const MAX_CONFLICT_RETRIES = 4;
const STARTED_AT = Date.now();

function withTimeout(promise, ms, makeError) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(makeError()), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Every database call gets a deadline, so a hanging connection can never freeze the server.
const dbTimeoutError = name => () => new HttpError(503, `پایگاه داده پاسخ نمی‌دهد (${name}). چند لحظه بعد دوباره تلاش کنید.`);
const timed = (fn, name) => (...args) => withTimeout(Promise.resolve().then(() => fn(...args)), DB_TIMEOUT_MS, dbTimeoutError(name));
const store = Object.fromEntries(Object.entries(rawStore).map(([k, fn]) => [k, ['info', 'watchCamp'].includes(k) ? fn : timed(fn, k)]));
const { getSetting, setSetting } = store;

let ready = false;          // true once the session secret / superadmin password are loaded
let lastStartupError = null;

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy / Cloud Run the client address is in X-Forwarded-For.
const trustProxy = process.env.TRUST_PROXY;
app.set('trust proxy', trustProxy === undefined ? 1 : (/^\d+$/.test(trustProxy) ? parseInt(trustProxy, 10) : trustProxy === 'true' ? true : trustProxy === 'false' ? false : trustProxy));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Errors & helpers
// ---------------------------------------------------------------------------
class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

// Wraps a handler so thrown HttpErrors become JSON responses (never a double send).
const route = fn => async (req, res) => {
    try {
        await fn(req, res);
    } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error(err);
        if (!res.headersSent) {
            const message = status === 500 ? 'خطای داخلی سرور' : err.message;
            res.status(status).json({ success: false, status: 'error', error: message, message });
        }
    }
};

function requireId(id, label = 'شناسه') {
    if (!isValidId(id)) throw new HttpError(400, `${label} نامعتبر است.`);
    return id;
}

function isLocked(camp) {
    return camp.locked === true || camp.locked === 1 || camp.locked === '1';
}

function clientIp(req) {
    return req.ip || req.socket.remoteAddress || 'unknown';
}

function fingerprint(secretValue) {
    return crypto.createHash('sha256').update(String(secretValue || '')).digest('hex').slice(0, 12);
}

// Object keys coming from clients (judge keys may be Persian usernames).
function isSafeKey(k) {
    return typeof k === 'string' && k.length > 0 && k.length <= 100 && !['__proto__', 'constructor', 'prototype'].includes(k);
}

// Camp links: chosen by the superadmin (optional) or random.
const CAMP_ID_RE = /^[A-Za-z0-9_-]{3,64}$/;
const CAMP_ID_HELP = 'لینک اختصاصی فقط می‌تواند شامل حروف انگلیسی، عدد، خط تیره (-) و زیرخط (_) و بین ۳ تا ۶۴ کاراکتر باشد.';

function newRandomCampId() {
    return 'camp_' + crypto.randomBytes(6).toString('hex');
}

// Returns the cleaned custom id, or null when none was requested.
function requestedCampId(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const id = String(raw).trim();
    if (!CAMP_ID_RE.test(id)) throw new HttpError(400, CAMP_ID_HELP);
    return id;
}

// Writes a new camp, refusing to overwrite an existing one with the same id (also across server instances).
async function createCampUnique(id, camp) {
    try {
        await repo.create(id, camp);
    } catch (e) {
        if (e instanceof ExistsError) throw new HttpError(409, `لینک «${id}» قبلاً برای مسابقه دیگری استفاده شده است. لینک دیگری انتخاب کنید.`);
        if (e instanceof TooLargeError) throw tooLarge();
        throw e;
    }
}

function strOrEmpty(v, max = 500) {
    return typeof v === 'string' ? v.slice(0, max) : '';
}

function tooLarge() {
    return new HttpError(413, 'حجم اطلاعات مسابقه بیش از حد مجاز است. تعداد تیم‌ها، کاربران یا متن‌ها را کمتر کنید.');
}

// ---------------------------------------------------------------------------
// Camp state
// ---------------------------------------------------------------------------
function parseCamp(raw) {
    if (!raw) return null;
    const camp = {
        ...raw,
        teams: parseMaybeJson(raw.teams, []),
        stages: parseMaybeJson(raw.stages, []),
        users: parseMaybeJson(raw.users, []),
        fieldJudgingMode: raw.fieldJudgingMode || 'free',
        fieldJudgingValues: parseMaybeJson(raw.fieldJudgingValues, null),
        positiveTags: parseMaybeJson(raw.positiveTags, null),
        negativeTags: parseMaybeJson(raw.negativeTags, null),
        campType: raw.campType || 'simple',
        tieredPointsLadder: parseLadder(parseMaybeJson(raw.tieredPointsLadder, DEFAULT_LADDER)),
        closedStages: parseMaybeJson(raw.closedStages, {}),
        stageTieredResults: parseMaybeJson(raw.stageTieredResults, {}),
        auditLog: parseMaybeJson(raw.auditLog, []),
        announcement: parseMaybeJson(raw.announcement, null),
        activeStageId: raw.activeStageId || null,
        numLang: raw.numLang || 'fa',
        dir: raw.dir || 'rtl'
    };
    if (!Array.isArray(camp.teams)) camp.teams = [];
    if (!Array.isArray(camp.stages)) camp.stages = [];
    if (!Array.isArray(camp.users)) camp.users = [];
    if (!Array.isArray(camp.fieldJudgingValues) || !camp.fieldJudgingValues.length) camp.fieldJudgingValues = DEFAULT_FIELD_JUDGING_VALUES;
    if (!Array.isArray(camp.positiveTags) || !camp.positiveTags.length) camp.positiveTags = DEFAULT_POSITIVE_TAGS;
    if (!Array.isArray(camp.negativeTags) || !camp.negativeTags.length) camp.negativeTags = DEFAULT_NEGATIVE_TAGS;
    if (!isPlainObject(camp.closedStages)) camp.closedStages = {};
    if (!isPlainObject(camp.stageTieredResults)) camp.stageTieredResults = {};
    if (!Array.isArray(camp.auditLog)) camp.auditLog = [];
    if (!isPlainObject(camp.announcement)) camp.announcement = null;
    camp.teams.forEach(t => { normalizeTeam(t); recomputeTeamScore(t); });
    return camp;
}

function publicTeam(t) {
    return {
        ...t,
        scoreLogs: t.scoreLogs.map(l => (l && l.user ? { ...l, user: publicUser(l.user) } : l))
    };
}

// What the live board and everyone with the link may see: no passwords, no user list.
function publicState(camp) {
    const { password, users, auditLog, deletedAt, ...rest } = camp;
    return { ...rest, locked: isLocked(camp), archived: !!camp.archived, teams: camp.teams.map(publicTeam) };
}

// Superadmin edit form: everything except stored password hashes.
function adminState(camp) {
    return {
        ...publicState(camp),
        password: '',
        hasPassword: !!camp.password,
        users: camp.users.map(u => ({ ...u, password: '', hasPassword: !!u.password }))
    };
}

const sseClients = new Map(); // Map<campId, Set<Response>>
const sseByIp = new Map();    // Map<ip, open connections>

function sendToClients(id, payload) {
    const clients = sseClients.get(id);
    if (!clients) return;
    for (const client of clients) {
        try { client.write(payload); } catch (e) { clients.delete(client); }
    }
}

// Called by the cache after every change, whether made here or by another server instance.
const pendingBroadcast = new Set();
function scheduleBroadcast(id, entry) {
    if (!sseClients.get(id)?.size) return;
    if (!entry) return sendToClients(id, 'event: deleted\ndata: {}\n\n');
    if (pendingBroadcast.has(id)) return;
    pendingBroadcast.add(id);
    setImmediate(() => { // several changes in a row become one update
        pendingBroadcast.delete(id);
        if (entry.doc.deletedAt) return sendToClients(id, 'event: deleted\ndata: {}\n\n');
        sendToClients(id, `data: ${repo.jsonOf(entry).json}\n\n`);
    });
}

// Full-screen "score" animation on live boards for each new instant score.
function sendSplash(id, entry, log) {
    if (!sseClients.get(id)?.size) return;
    const team = repo.campOf(entry).teams.find(t => t.id === log.teamId);
    if (!team) return;
    sendToClients(id, `event: splash\ndata: ${JSON.stringify({
        teamId: team.id, delta: log.value, teamName: team.name, score: team.score,
        user: publicUser(log.user), tag: log.tag || '', logId: log.id,
        image: team.image || '', happyImage: team.happyImage || '', sadImage: team.sadImage || '',
        teamColor: team.color || '#3b82f6'
    })}\n\n`);
}

const repo = createCampRepo(store, {
    parse: parseCamp,
    publicView: publicState,
    maxDocBytes: MAX_CAMP_BYTES,
    idleMs: CACHE_IDLE_MS,
    isInUse: id => !!sseClients.get(id)?.size,
    onChange: scheduleBroadcast,
    onInstant: sendSplash
});

// Cached camp (never mutate the returned object). Camps in the trash count as missing.
async function loadEntry(id, { includeDeleted = false } = {}) {
    const entry = await repo.get(id);
    if (!entry || (!includeDeleted && entry.doc.deletedAt)) return null;
    return entry;
}

async function loadCamp(id, opts) {
    const entry = await loadEntry(id, opts);
    return entry ? repo.campOf(entry) : null;
}

async function loadCampOr404(id, opts) {
    const camp = await loadCamp(id, opts);
    if (!camp) throw new HttpError(404, 'مسابقه یافت نشد.');
    return camp;
}

setInterval(() => {
    for (const [id, clients] of sseClients.entries()) {
        if (clients.size === 0) { sseClients.delete(id); continue; }
        sendToClients(id, 'event: ping\ndata: 1\n\n'); // keeps proxies open and lets boards detect a dead connection
    }
}, 15000).unref();

// Per-camp mutex so concurrent requests never overwrite each other's changes.
// Waiting and holding are both time-limited, so one stuck request cannot block a camp forever.
const campLocks = new Map();
async function withLock(id, fn) {
    const prev = campLocks.get(id) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    const tail = prev.then(() => current);
    campLocks.set(id, tail);
    const lease = { expired: false };
    try {
        await withTimeout(prev, LOCK_WAIT_MS, () => new HttpError(503, 'سرور مشغول ثبت تغییرات دیگر این مسابقه است. چند لحظه بعد دوباره تلاش کنید.'));
        return await withTimeout(Promise.resolve().then(() => fn(lease)), LOCK_HOLD_MS, () => {
            lease.expired = true;
            console.error(`[lock] operation on camp ${id} exceeded ${LOCK_HOLD_MS} ms; lock released`);
            return new HttpError(503, 'انجام عملیات بیش از حد طول کشید و لغو شد. لطفاً دوباره تلاش کنید.');
        });
    } finally {
        release();
        if (campLocks.get(id) === tail) campLocks.delete(id);
    }
}

// Load → mutate (a copy) → save → broadcast, under the camp lock of this server instance.
// Another instance may have changed the camp in the meantime: then the save is refused
// (revision check) and the operation runs again on the fresh data.
async function mutateCamp(id, { allowLocked = false, allowDeleted = false } = {}, mutate) {
    return withLock(id, async lease => {
        for (let attempt = 0; ; attempt++) {
            const entry = await repo.get(id, { fresh: attempt > 0 });
            if (!entry || (!allowDeleted && entry.doc.deletedAt)) throw new HttpError(404, 'مسابقه یافت نشد.');
            const { camp, baseLogs } = repo.snapshot(entry);
            if (!allowLocked && isLocked(camp)) throw new HttpError(403, 'این مسابقه قفل شده است.');
            const result = await mutate(camp);
            let changes = result && result.changes;
            if (changes && result.audit) {
                const { user, action, details } = result.audit;
                const item = { ts: Date.now(), by: { username: user.username, name: displayName(user), role: user.role }, action, details: details || {} };
                changes = { ...changes, auditLog: [...camp.auditLog, item].slice(-AUDIT_LIMIT) };
            }
            if (!changes || !Object.keys(changes).length) return { ...(result || {}), camp };
            // A timed-out operation must not write after the lock has passed to the next request.
            if (lease.expired) throw new HttpError(503, 'انجام عملیات بیش از حد طول کشید و لغو شد.');
            try {
                await repo.commit(entry, changes, { baseLogs });
            } catch (e) {
                if (e instanceof ConflictError) {
                    if (attempt < MAX_CONFLICT_RETRIES) continue;
                    throw new HttpError(409, 'هم‌زمان تغییر دیگری روی این مسابقه ثبت شد. لطفاً دوباره تلاش کنید.');
                }
                if (e instanceof TooLargeError) throw tooLarge();
                if (e instanceof NotFoundError) throw new HttpError(404, 'مسابقه یافت نشد.');
                throw e;
            }
            return { ...(result || {}), camp: repo.campOf(entry) };
        }
    });
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
let SESSION_SECRET = process.env.SESSION_SECRET || null;
let superadminHash = null;
const loginLimiter = createRateLimiter({ max: 10, windowMs: 5 * 60 * 1000 });

async function initSecurity() {
    if (!SESSION_SECRET) {
        // Created once and shared by every server instance (the first one to start wins).
        SESSION_SECRET = await getSetting('session_secret') || await store.createSettingIfAbsent('session_secret', randomSecret());
    }
    superadminHash = await loadSuperadminHash({ generate: true });
    ready = true;
}

// A password changed from the panel wins over the environment variable,
// unless SUPERADMIN_PASS_RESET=1 is set (recovery when the password is forgotten).
let envSuperadminHash = null;
async function loadSuperadminHash({ generate = false } = {}) {
    const custom = process.env.SUPERADMIN_PASS_RESET === '1' ? null : await getSetting('superadmin_password_custom');
    if (custom) return custom;
    if (process.env.SUPERADMIN_PASS) {
        if (!envSuperadminHash) {
            if (process.env.SUPERADMIN_PASS === 'admin123') console.warn('⚠️  SUPERADMIN_PASS is the well-known default "admin123". Please change it.');
            // Same salt on every instance → same hash → a superadmin session works on all of them.
            const salt = crypto.createHmac('sha256', SESSION_SECRET).update('superadmin-env-salt').digest('hex').slice(0, 32);
            envSuperadminHash = await hashPassword(process.env.SUPERADMIN_PASS, salt);
        }
        return envSuperadminHash;
    }
    let stored = await getSetting('superadmin_password_hash');
    if (!stored && generate) {
        const generated = randomPassword(14);
        const hash = await hashPassword(generated);
        stored = await store.createSettingIfAbsent('superadmin_password_hash', hash);
        console.log('==============================================================');
        if (stored === hash) {
            console.log(`🔐 Generated superadmin password: ${generated}`);
            console.log('   Set SUPERADMIN_PASS to choose your own.');
        } else {
            console.log('🔐 The superadmin password was generated by another server instance (see its log),');
            console.log('   or set SUPERADMIN_PASS to choose your own.');
        }
        console.log('==============================================================');
    }
    return stored;
}

// The superadmin password may have been changed on another server instance.
let superadminCheckedAt = 0;
async function refreshSuperadminHash(force = false) {
    if (!ready || (!force && Date.now() - superadminCheckedAt < 3000)) return false;
    superadminCheckedAt = Date.now();
    const h = await loadSuperadminHash();
    if (!h || h === superadminHash) return false;
    superadminHash = h;
    return true;
}
setInterval(() => { refreshSuperadminHash(true).catch(() => {}); }, 60000).unref();

// Configuration problems that do not stop the server but are reported by /health.
function configWarnings() {
    const w = [];
    const info = rawStore.info();
    if (info.mode === 'web') w.push('FIREBASE_SERVICE_ACCOUNT is not set: using the Firebase Web SDK, which needs open (insecure) Firestore rules.');
    if (process.env.SUPERADMIN_PASS === 'admin123') w.push('SUPERADMIN_PASS is the well-known default "admin123".');
    if (adapterName === 'memory') w.push('DB_ADAPTER=memory: data is lost when the server restarts.');
    return w;
}

// Fatal configuration errors are reported clearly at startup instead of failing on the first request.
function validateConfig() {
    const errors = [];
    const adapter = process.env.DB_ADAPTER || 'firebase';
    if (!['firebase', 'memory', 'sql'].includes(adapter)) errors.push(`DB_ADAPTER="${adapter}" is not supported (firebase | memory | sql).`);
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            if (!sa.private_key || !sa.client_email) errors.push('FIREBASE_SERVICE_ACCOUNT is missing private_key or client_email.');
        } catch (e) {
            errors.push('FIREBASE_SERVICE_ACCOUNT is not valid JSON (paste the whole service-account file on one line).');
        }
    }
    if (process.env.PORT && !(parseInt(process.env.PORT, 10) > 0)) errors.push(`PORT="${process.env.PORT}" is not a valid port.`);
    return errors;
}

function readToken(req) {
    return req.get('X-Auth-Token') || '';
}

async function requireSuperadmin(req) {
    const p = verifyToken(readToken(req), SESSION_SECRET);
    if (p && p.t === 'sa' && p.pv !== fingerprint(superadminHash)) await refreshSuperadminHash();
    if (!p || p.t !== 'sa' || p.pv !== fingerprint(superadminHash)) throw new HttpError(401, 'نشست سوپرادمین نامعتبر یا منقضی شده است. دوباره وارد شوید.');
}

function findCampUser(camp, username) {
    const user = camp.users.find(u => u && u.username === username);
    if (user) return { user, secret: user.password };
    if (username === 'admin' && camp.password) {
        return {
            user: { id: 'admin', role: 'operator', firstName: 'اپراتور', lastName: 'اصلی', username: 'admin', profilePic: camp.adminProfilePic || '' },
            secret: camp.password
        };
    }
    return null;
}

// Returns the logged-in user of this camp (with the role currently stored in the camp).
function requireCampUser(req, camp, roles = ROLES) {
    const p = verifyToken(readToken(req), SESSION_SECRET);
    if (!p || p.t !== 'camp' || p.campId !== camp.id) throw new HttpError(401, 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.');
    const found = findCampUser(camp, p.username);
    if (!found || p.pv !== fingerprint(found.secret)) throw new HttpError(401, 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.');
    const role = ROLES.includes(found.user.role) ? found.user.role : 'referee';
    if (!roles.includes(role)) throw new HttpError(403, 'شما دسترسی لازم برای این عملیات را ندارید.');
    return { ...found.user, role };
}

function campTokenFor(camp, username, secret) {
    return createToken({ t: 'camp', campId: camp.id, username, pv: fingerprint(secret) }, SESSION_SECRET);
}

// ---------------------------------------------------------------------------
// Input sanitising for setup / settings
// ---------------------------------------------------------------------------
function cleanStages(stages) {
    if (!Array.isArray(stages)) throw new HttpError(400, 'فهرست مراحل نامعتبر است.');
    return stages.map(s => {
        requireId(s && s.id, 'شناسه مرحله');
        const multiplier = parseFloat(s.multiplier);
        return {
            ...s,
            name: strOrEmpty(s.name, 200),
            unit: ['points', 'time', 'time_asc', 'time_desc'].includes(s.unit) ? s.unit : 'points',
            timeOrder: s.timeOrder === 'desc' ? 'desc' : 'asc',
            multiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
        };
    });
}

function cleanTeamDefs(teams) {
    if (!Array.isArray(teams)) throw new HttpError(400, 'فهرست تیم‌ها نامعتبر است.');
    const seen = new Set();
    return teams.map(t => {
        requireId(t && t.id, 'شناسه تیم');
        if (seen.has(t.id)) throw new HttpError(400, 'شناسه تیم تکراری است.');
        seen.add(t.id);
        return {
            ...t,
            name: strOrEmpty(t.name, 200),
            color: strOrEmpty(t.color, 64),
            image: strOrEmpty(t.image, 2_000_000),
            happyImage: strOrEmpty(t.happyImage, 2_000_000),
            sadImage: strOrEmpty(t.sadImage, 2_000_000)
        };
    });
}

function cleanStringList(list, fallback) {
    if (!Array.isArray(list)) return fallback;
    const out = list.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 100));
    return out.length ? out : fallback;
}

function cleanNumberList(list, fallback) {
    if (!Array.isArray(list)) return fallback;
    const out = list.map(x => parseInt(x, 10)).filter(x => Number.isFinite(x) && x > 0);
    return out.length ? out : fallback;
}

// Users from the superadmin form. An empty password keeps the existing one.
// New passwords are hashed in parallel on the thread pool.
async function cleanUsers(users, existingUsers = []) {
    if (!Array.isArray(users)) return [];
    const byName = new Map(existingUsers.map(u => [u.username, u]));
    const byId = new Map(existingUsers.filter(u => u.id).map(u => [u.id, u]));
    const seen = new Set();
    return Promise.all(users.map(async u => {
        const username = strOrEmpty(u && u.username, 100).trim();
        if (!username) throw new HttpError(400, 'نام کاربری خالی است.');
        if (seen.has(username)) throw new HttpError(400, `نام کاربری «${username}» تکراری است.`);
        seen.add(username);
        const prev = (u.id && byId.get(u.id)) || byName.get(username);
        let password;
        if (typeof u.password === 'string' && u.password !== '') password = await hashPassword(u.password);
        else if (prev && prev.password) password = prev.password;
        else throw new HttpError(400, `رمز عبور کاربر «${username}» الزامی است.`);
        return {
            id: isValidId(u.id) ? u.id : 'u_' + crypto.randomBytes(5).toString('hex'),
            firstName: strOrEmpty(u.firstName, 100),
            lastName: strOrEmpty(u.lastName, 100),
            username,
            password,
            role: ROLES.includes(u.role) ? u.role : 'referee',
            profilePic: strOrEmpty(u.profilePic, 2_000_000)
        };
    }));
}

// ---------------------------------------------------------------------------
// Health, readiness, request size and rate limits
// ---------------------------------------------------------------------------
// For uptime monitors / load balancers: 200 when the server and database work, otherwise 503.
app.get('/health', async (req, res) => {
    const started = Date.now();
    let db = { ok: false };
    try {
        await withTimeout(rawStore.getSetting('session_secret'), 3000, () => new Error('timeout'));
        db = { ok: true, latencyMs: Date.now() - started };
    } catch (e) {
        db = { ok: false, error: e.message === 'timeout' ? 'database did not answer within 3 s' : 'database error' };
    }
    const healthy = ready && db.ok;
    let sse = 0;
    for (const set of sseClients.values()) sse += set.size;
    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : (ready ? 'degraded' : 'starting'),
        db,
        adapter: adapterName,
        firebaseMode: adapterName === 'firebase' ? rawStore.info().mode : undefined,
        media: rawStore.info().media,
        cachedCamps: repo.size(),
        uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
        liveBoards: sse,
        startupError: ready ? undefined : (lastStartupError || undefined),
        warnings: configWarnings()
    });
});

const API_PREFIXES = ['/api', '/login', '/setup', '/superadmin'];
const isApiPath = p => API_PREFIXES.some(pre => p === pre || p.startsWith(pre + '/') || p.startsWith(pre + '?'));

// Until the database is reachable, API calls get a clear "starting" answer (static pages still load).
app.use((req, res, next) => {
    if (ready || !isApiPath(req.path)) return next();
    res.setHeader('Retry-After', '5');
    res.status(503).json({ success: false, error: 'سرور در حال راه‌اندازی است. چند لحظه بعد دوباره تلاش کنید.', message: 'سرور در حال راه‌اندازی است. چند لحظه بعد دوباره تلاش کنید.' });
});

// Per-IP rate limits (generous: a whole venue often shares one public IP).
const readLimiter = createRateLimiter({ max: RATE_READ_PER_MIN, windowMs: 60000 });
const writeLimiter = createRateLimiter({ max: RATE_WRITE_PER_MIN, windowMs: 60000 });
app.use((req, res, next) => {
    if (!isApiPath(req.path)) return next();
    const ip = clientIp(req);
    const ok = req.method === 'GET' ? readLimiter.check('r:' + ip) : writeLimiter.check('w:' + ip);
    if (ok) return next();
    res.setHeader('Retry-After', '60');
    res.status(429).json({ success: false, error: 'تعداد درخواست‌ها بیش از حد مجاز است. یک دقیقه بعد دوباره تلاش کنید.', message: 'تعداد درخواست‌ها بیش از حد مجاز است. یک دقیقه بعد دوباره تلاش کنید.' });
});

// Large bodies (images) only for the few routes that carry them, and only for signed-in users:
// an anonymous request is rejected before its body is read.
const LARGE_BODY_ROUTES = new Set(['/setup', '/api', '/api/settings', '/api/user/profile-pic', '/superadmin/import']);
const jsonSmall = express.json({ limit: BODY_LIMIT_SMALL });
const jsonLarge = express.json({ limit: BODY_LIMIT_LARGE });
const jsonImport = express.json({ limit: BODY_LIMIT_IMPORT });
app.use((req, res, next) => {
    if (req.method !== 'POST' || !LARGE_BODY_ROUTES.has(req.path)) return jsonSmall(req, res, next);
    if (!verifyToken(readToken(req), SESSION_SECRET)) {
        return res.status(401).json({ success: false, error: 'برای این عملیات باید وارد شوید.', message: 'برای این عملیات باید وارد شوید.' });
    }
    return (req.path === '/superadmin/import' ? jsonImport : jsonLarge)(req, res, next);
});

// ---------------------------------------------------------------------------
// Images (team pictures, logos, profile photos): stored once, cached by browsers for a year.
// ---------------------------------------------------------------------------
const mediaCache = new Map(); // name -> { data, type } (least recently used first)
let mediaCacheBytes = 0;
function rememberMedia(name, item) {
    if (item.data.length > MEDIA_CACHE_BYTES / 4) return;
    mediaCache.set(name, item);
    mediaCacheBytes += item.data.length;
    for (const [k, v] of mediaCache) {
        if (mediaCacheBytes <= MEDIA_CACHE_BYTES) break;
        mediaCache.delete(k);
        mediaCacheBytes -= v.data.length;
    }
}

app.get('/media/:name', route(async (req, res) => {
    const name = req.params.name;
    if (!MEDIA_NAME_RE.test(name)) throw new HttpError(404, 'تصویر یافت نشد.');
    let item = mediaCache.get(name);
    if (item) { mediaCache.delete(name); mediaCache.set(name, item); }
    else {
        if (!ready) throw new HttpError(503, 'سرور در حال راه‌اندازی است.');
        const found = await store.getMedia(name);
        if (!found) throw new HttpError(404, 'تصویر یافت نشد.');
        item = { data: Buffer.from(found.data), type: MEDIA_TYPES[name.split('.').pop()] };
        rememberMedia(name, item);
    }
    // The name is the hash of the content, so the file never changes.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', '"' + name + '"');
    // Uploaded SVGs must never run scripts when opened directly.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    if (req.get('If-None-Match') === '"' + name + '"') return res.status(304).end();
    res.type(item.type).send(item.data);
}));

// ---------------------------------------------------------------------------
// Global settings
// ---------------------------------------------------------------------------
// Read by every page load; cached briefly (another server instance may change it).
let systemLogoCache = { value: null, until: 0 };
app.get('/api/settings', route(async (req, res) => {
    if (systemLogoCache.until < Date.now()) {
        let value = await getSetting('systemLogo');
        if (typeof value === 'string' && value.startsWith('data:image/')) { // stored before images moved out
            value = await repo.externalize(value);
            await setSetting('systemLogo', value);
        }
        systemLogoCache = { value, until: Date.now() + 30000 };
    }
    res.json({ systemLogo: systemLogoCache.value });
}));

app.post('/api/settings', route(async (req, res) => {
    await requireSuperadmin(req);
    const { key, value } = req.body || {};
    if (key !== 'systemLogo') throw new HttpError(400, 'کلید تنظیمات مجاز نیست.');
    if (typeof value !== 'string' || value.length > 2_000_000) throw new HttpError(400, 'مقدار نامعتبر است.');
    const stored = await repo.externalize(value);
    await setSetting(key, stored);
    systemLogoCache = { value: stored, until: Date.now() + 30000 };
    res.json({ success: true, value: stored });
}));

// ---------------------------------------------------------------------------
// Superadmin
// ---------------------------------------------------------------------------
app.get('/', (req, res) => res.redirect('/superadmin.html'));

app.post('/superadmin/login', route(async (req, res) => {
    if (!loginLimiter.check('sa:' + clientIp(req))) throw new HttpError(429, 'تلاش‌های ناموفق زیاد بود. چند دقیقه دیگر دوباره امتحان کنید.');
    const password = req.body && req.body.password;
    let ok = await verifyPassword(password, superadminHash);
    // Changed on another server instance?
    if (!ok && await refreshSuperadminHash()) ok = await verifyPassword(password, superadminHash);
    if (!ok) {
        return res.json({ success: false, message: 'رمز عبور سوپرادمین اشتباه است!' });
    }
    loginLimiter.reset('sa:' + clientIp(req));
    res.json({ success: true, token: createToken({ t: 'sa', pv: fingerprint(superadminHash) }, SESSION_SECRET) });
}));

app.get('/superadmin/camps', route(async (req, res) => {
    await requireSuperadmin(req);
    const all = await store.listCamps(['orgName', 'title', 'locked', 'campType', 'archived', 'deletedAt']);
    purgeExpiredTrash(all).catch(e => console.error('[trash]', e.message));
    const camps = all.filter(c => !c.deletedAt).map(c => ({
        id: c.id, orgName: c.orgName, title: c.title, locked: isLocked(c), campType: c.campType, archived: !!c.archived
    }));
    res.json({ success: true, camps, trashCount: all.length - camps.length });
}));

app.get('/superadmin/camps/:id', route(async (req, res) => {
    await requireSuperadmin(req);
    const camp = await loadCamp(requireId(req.params.id));
    if (!camp) return res.json({ success: false, message: 'یافت نشد' });
    res.json({ success: true, camp: adminState(camp) });
}));

app.post('/superadmin/camps/:id/lock', route(async (req, res) => {
    await requireSuperadmin(req);
    const id = requireId(req.params.id);
    await mutateCamp(id, { allowLocked: true }, () => ({ changes: { locked: req.body && req.body.locked ? 1 : 0 } }));
    res.json({ success: true });
}));

app.post('/superadmin/camps/:id/archive', route(async (req, res) => {
    await requireSuperadmin(req);
    const id = requireId(req.params.id);
    await mutateCamp(id, { allowLocked: true }, () => ({ changes: { archived: !!(req.body && req.body.archived) } }));
    res.json({ success: true });
}));

app.post('/setup', route(async (req, res) => {
    await requireSuperadmin(req);
    const b = req.body || {};
    const base = {
        orgName: strOrEmpty(b.orgName, 200),
        title: strOrEmpty(b.title, 200),
        logo: strOrEmpty(b.logo, 2_000_000),
        stages: cleanStages(b.stages || []),
        numLang: b.numLang === 'en' ? 'en' : 'fa',
        dir: b.dir === 'ltr' ? 'ltr' : 'rtl',
        campType: ['simple', 'professional', 'tiered'].includes(b.campType) ? b.campType : 'simple',
        tieredPointsLadder: parseLadder(b.tieredPointsLadder),
        fieldJudgingMode: b.fieldJudgingMode === 'restricted' ? 'restricted' : 'free',
        fieldJudgingValues: cleanNumberList(b.fieldJudgingValues, DEFAULT_FIELD_JUDGING_VALUES),
        positiveTags: cleanStringList(b.positiveTags, DEFAULT_POSITIVE_TAGS),
        negativeTags: cleanStringList(b.negativeTags, DEFAULT_NEGATIVE_TAGS)
    };
    const teamDefs = cleanTeamDefs(b.teams || []);

    if (b.campId) {
        const id = requireId(b.campId);
        await mutateCamp(id, { allowLocked: true }, async camp => {
            const changes = {
                ...base,
                teams: mergeTeams(camp.teams, teamDefs),
                users: await cleanUsers(b.users, camp.users)
            };
            if (typeof b.password === 'string' && b.password !== '') changes.password = await hashPassword(b.password);
            return { changes };
        });
        return res.json({ success: true, campId: id });
    }

    if (typeof b.password !== 'string' || b.password === '') throw new HttpError(400, 'رمز عبور اپراتور الزامی است.');
    const id = requestedCampId(b.customId) || newRandomCampId();
    const camp = {
        id, ...base,
        password: await hashPassword(b.password),
        teams: mergeTeams([], teamDefs),
        users: await cleanUsers(b.users, []),
        locked: 0,
        archived: false,
        closedStages: {},
        stageTieredResults: {}
    };
    await createCampUnique(id, camp);
    res.json({ success: true, campId: id });
}));

// Superadmin form: live check of a custom camp link.
app.get('/superadmin/id_available', route(async (req, res) => {
    await requireSuperadmin(req);
    const id = String(req.query.id || '').trim();
    if (!CAMP_ID_RE.test(id)) return res.json({ success: true, available: false, reason: 'invalid', message: CAMP_ID_HELP });
    const existing = await store.getCampDoc(id);
    if (!existing) return res.json({ success: true, available: true, reason: null, message: '' });
    const inTrash = !!existing.doc.deletedAt;
    res.json({
        success: true, available: false, reason: inTrash ? 'trash' : 'taken',
        message: inTrash ? 'این لینک متعلق به مسابقه‌ای در سطل زباله است.' : 'این لینک قبلاً برای مسابقه دیگری استفاده شده است.'
    });
}));

// ---------------------------------------------------------------------------
// Camp login (operator / head referee / referee)
// ---------------------------------------------------------------------------
app.post('/login', route(async (req, res) => {
    const { id, password, username, token } = req.body || {};
    const fail = msg => res.json({ success: false, message: msg || 'نام کاربری یا رمز عبور اشتباه است یا مسابقه یافت نشد!' });
    if (!isValidId(id)) return fail();

    if (token) {
        // Restore a session after a page reload without storing the password in the browser.
        const camp = await loadCamp(id);
        if (!camp) return fail();
        req.headers['x-auth-token'] = token;
        let user;
        try { user = requireCampUser(req, camp); } catch (e) { return fail('نشست منقضی شده است. لطفاً دوباره وارد شوید.'); }
        return res.json({ success: true, token, ...publicState(camp), user: publicUser(user) });
    }

    if (!username) return fail('نام کاربری الزامی است!');
    const limiterKey = `camp:${id}:${clientIp(req)}`;
    if (!loginLimiter.check(limiterKey)) throw new HttpError(429, 'تلاش‌های ناموفق زیاد بود. چند دقیقه دیگر دوباره امتحان کنید.');

    const camp = await loadCamp(id);
    if (!camp) return fail();
    const found = findCampUser(camp, username);
    if (!found || !await verifyPassword(password, found.secret)) return fail();
    let result = { camp, user: found.user, secret: found.secret };
    // Upgrade legacy plain-text passwords to hashes on first successful login.
    if (!isHashed(found.secret)) {
        const secret = await hashPassword(password);
        result = await mutateCamp(id, { allowLocked: true }, c => {
            const user = c.users.find(u => u.username === username);
            if (user) { user.password = secret; return { user, secret, changes: { users: c.users } }; }
            return { user: found.user, secret, changes: { password: secret } };
        });
    }
    loginLimiter.reset(limiterKey);
    res.json({
        success: true,
        token: campTokenFor(result.camp, result.user.username, result.secret),
        ...publicState(result.camp),
        user: publicUser(result.user)
    });
}));

app.post('/api/user/profile-pic', route(async (req, res) => {
    const { campId, profilePic } = req.body || {};
    const id = requireId(campId, 'شناسه مسابقه');
    if (typeof profilePic === 'string' && profilePic.length > 500_000) throw new HttpError(413, 'حجم عکس پروفایل بیش از حد مجاز است.');
    const pic = typeof profilePic === 'string' ? await repo.externalize(profilePic) : '';
    await mutateCamp(id, { allowLocked: true }, camp => {
        const me = requireCampUser(req, camp);
        const user = camp.users.find(u => u.username === me.username);
        if (!user) return { changes: { adminProfilePic: pic } }; // built-in "admin" operator
        user.profilePic = pic;
        return { changes: { users: camp.users } };
    });
    res.json({ success: true, profilePic: pic });
}));

// ---------------------------------------------------------------------------
// Public read endpoints (live board, login page)
// ---------------------------------------------------------------------------
app.get('/api', route(async (req, res) => {
    const { id, action } = req.query;
    if (action === 'info') {
        const camp = isValidId(id) ? await loadCamp(id) : null;
        if (!camp) return res.json({ success: false });
        return res.json({ success: true, orgName: camp.orgName || '', title: camp.title || '', logo: camp.logo || '', campType: camp.campType });
    }
    if (action === 'poll') {
        const entry = await loadEntry(requireId(id, 'شناسه مسابقه'));
        if (!entry) throw new HttpError(404, 'مسابقه یافت نشد.');
        // Prepared once per change; unchanged data costs a "304 Not Modified" without a body.
        const { json, etag } = repo.jsonOf(entry);
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('ETag', etag);
        if (req.get('If-None-Match') === etag) return res.status(304).end();
        return res.type('application/json').send(json);
    }
    if (action === 'stream') {
        requireId(id, 'شناسه مسابقه');
        // Caps on open live-board connections (one per screen) protect memory and sockets.
        const ip = clientIp(req);
        let total = 0;
        for (const set of sseClients.values()) total += set.size;
        if (total >= SSE_MAX_TOTAL) throw new HttpError(503, 'ظرفیت تابلوهای زنده سرور پر است. کمی بعد دوباره تلاش کنید.');
        if ((sseByIp.get(ip) || 0) >= SSE_MAX_PER_IP) throw new HttpError(429, 'تعداد تابلوهای باز از این شبکه بیش از حد مجاز است.');
        const entry = await loadEntry(id);
        if (!entry) throw new HttpError(404, 'مسابقه یافت نشد.');
        sseByIp.set(ip, (sseByIp.get(ip) || 0) + 1);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        if (!sseClients.has(id)) sseClients.set(id, new Set());
        const clients = sseClients.get(id);
        clients.add(res);
        res.write(`data: ${repo.jsonOf(entry).json}\n\n`);
        req.on('close', () => {
            const n = (sseByIp.get(ip) || 1) - 1;
            if (n > 0) sseByIp.set(ip, n); else sseByIp.delete(ip);
            clients.delete(res);
            if (clients.size === 0) sseClients.delete(id);
        });
        return;
    }
    throw new HttpError(400, 'Invalid action');
}));

// ---------------------------------------------------------------------------
// Camp settings (operator / head referee). Scores are never taken from this payload.
// ---------------------------------------------------------------------------
app.post('/api', route(async (req, res) => {
    const id = requireId(req.query.id, 'شناسه مسابقه');
    const b = req.body || {};
    await mutateCamp(id, {}, camp => {
        const user = requireCampUser(req, camp, MANAGER_ROLES);
        const changes = {};
        if (b.teams !== undefined) changes.teams = mergeTeams(camp.teams, cleanTeamDefs(b.teams));
        if (b.stages !== undefined) changes.stages = cleanStages(b.stages);
        if (typeof b.orgName === 'string' && b.orgName) changes.orgName = strOrEmpty(b.orgName, 200);
        if (typeof b.title === 'string') changes.title = strOrEmpty(b.title, 200);
        if (typeof b.logo === 'string') changes.logo = strOrEmpty(b.logo, 2_000_000);
        if (b.numLang !== undefined) changes.numLang = b.numLang === 'en' ? 'en' : 'fa';
        if (b.dir !== undefined) changes.dir = b.dir === 'ltr' ? 'ltr' : 'rtl';
        if (b.fieldJudgingMode !== undefined) changes.fieldJudgingMode = b.fieldJudgingMode === 'restricted' ? 'restricted' : 'free';
        if (b.fieldJudgingValues !== undefined) changes.fieldJudgingValues = cleanNumberList(b.fieldJudgingValues, DEFAULT_FIELD_JUDGING_VALUES);
        if (b.positiveTags !== undefined) changes.positiveTags = cleanStringList(b.positiveTags, DEFAULT_POSITIVE_TAGS);
        if (b.negativeTags !== undefined) changes.negativeTags = cleanStringList(b.negativeTags, DEFAULT_NEGATIVE_TAGS);
        if (b.campType !== undefined) changes.campType = ['simple', 'professional', 'tiered'].includes(b.campType) ? b.campType : camp.campType;
        if (b.tieredPointsLadder !== undefined) changes.tieredPointsLadder = parseLadder(b.tieredPointsLadder);
        const details = {};
        if (changes.teams) {
            const before = new Set(camp.teams.map(t => t.id));
            const after = new Set(changes.teams.map(t => t.id));
            details.addedTeams = changes.teams.filter(t => !before.has(t.id)).map(t => t.name);
            details.removedTeams = camp.teams.filter(t => !after.has(t.id)).map(t => t.name);
        }
        return { changes, audit: { user, action: 'settings', details } };
    });
    res.json({ success: true, status: 'success' });
}));

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
app.post('/api/instant', route(async (req, res) => {
    const id = requireId(req.query.id, 'شناسه مسابقه');
    const { teamId, delta, tag, clientLogId } = req.body || {};
    requireId(teamId, 'شناسه تیم');
    const value = Number(delta);
    if (!Number.isFinite(value) || value === 0 || Math.abs(value) > 1_000_000) throw new HttpError(400, 'مقدار امتیاز نامعتبر است.');
    // Offline clients send their own id so a retried request is never counted twice.
    const logId = typeof clientLogId === 'string' && /^log_[A-Za-z0-9_-]{6,40}$/.test(clientLogId)
        ? clientLogId : 'log_' + crypto.randomBytes(6).toString('hex');

    const { team, duplicate } = await mutateCamp(id, {}, camp => {
        const user = requireCampUser(req, camp);
        const team = camp.teams.find(t => t.id === teamId);
        if (!team) throw new HttpError(404, 'تیم یافت نشد.');
        if (camp.teams.some(t => t.scoreLogs.some(l => l && l.id === logId))) return { team, duplicate: true };
        const now = Date.now();
        team.scoreLogs.push({
            id: logId, type: 'instant', value: round2(value), timestamp: now, createdAt: now,
            user: publicUser(user), tag: strOrEmpty(tag, 100)
        });
        recomputeTeamScore(team);
        // Only the new log is written (the camp document is not touched); live boards get the splash from the cache.
        return { team, changes: { teams: camp.teams } };
    });
    if (duplicate) return res.json({ success: true, logId, duplicate: true });
    res.json({ success: true, logId, score: team.score });
}));

app.post('/api/undo_instant', route(async (req, res) => {
    const id = requireId(req.query.id, 'شناسه مسابقه');
    const logId = requireId((req.body || {}).logId, 'شناسه امتیاز');
    await mutateCamp(id, {}, camp => {
        const user = requireCampUser(req, camp);
        for (const team of camp.teams) {
            const log = team.scoreLogs.find(l => l && l.id === logId && l.type === 'instant');
            if (!log) continue;
            if (user.role === 'referee' && (!log.user || log.user.username !== user.username)) {
                throw new HttpError(403, 'فقط امتیازهای ثبت‌شده توسط خودتان را می‌توانید لغو کنید.');
            }
            log.type = 'cancelled';
            log.timestamp = Date.now();
            recomputeTeamScore(team);
            return { changes: { teams: camp.teams } };
        }
        throw new HttpError(404, 'امتیاز مورد نظر یافت نشد یا قبلاً لغو شده است.');
    });
    res.json({ success: true });
}));

function stageName(camp, stageId) {
    const st = camp.stages.find(s => s.id === stageId);
    return st ? st.name : stageId;
}

function judgeEntryFor(user, rawVal, dnfFlag, judgeKey) {
    const isDnf = isDnfValue(rawVal) || !!dnfFlag;
    return {
        judgeKey,
        judgeName: displayName(user),
        judgeRole: user.role,
        judgePhoto: user.profilePic || '',
        score: isDnf ? '-' : round2(num(rawVal)),
        dnf: isDnf,
        timestamp: Date.now()
    };
}

app.post('/api/judge_stage_score', route(async (req, res) => {
    const id = requireId(req.query.id, 'شناسه مسابقه');
    const { stageId, scores, singleScore, action, targetJudgeKey } = req.body || {};
    requireId(stageId, 'شناسه مرحله');

    const { camp } = await mutateCamp(id, {}, camp => {
        const user = requireCampUser(req, camp);
        const isManager = MANAGER_ROLES.includes(user.role);
        if (!camp.stages.some(s => s.id === stageId)) throw new HttpError(404, 'مرحله یافت نشد.');
        if (camp.closedStages[stageId]) throw new HttpError(409, 'این مرحله بسته شده است. برای ثبت نمره ابتدا آن را بازگشایی کنید.');
        const isTiered = camp.campType === 'tiered';

        if (action === 'delete') {
            if (!isManager) throw new HttpError(403, 'فقط اپراتور یا سرداور می‌تواند نمره داوران را حذف کند.');
            if (!isSafeKey(targetJudgeKey)) throw new HttpError(400, 'شناسه داور نامعتبر است.');
            const onlyTeam = singleScore && singleScore.teamId;
            const affected = [];
            for (const team of camp.teams) {
                if (onlyTeam && team.id !== onlyTeam) continue;
                const map = team.judgeStageScores[stageId];
                if (!map || !map[targetJudgeKey]) continue;
                delete map[targetJudgeKey];
                affected.push(team.name);
                if (!isTiered) { applyJudgesToStage(team, stageId, true); recomputeTeamScore(team); }
            }
            return { changes: { teams: camp.teams }, audit: { user, action: 'judge_score_delete', details: { stage: stageName(camp, stageId), judge: targetJudgeKey, teams: affected } } };
        }

        // Referees always score as themselves; managers may record on behalf of another judge key.
        const judgeKey = isManager && isSafeKey(targetJudgeKey) ? targetJudgeKey : user.username;
        const scoreMap = isPlainObject(scores) ? scores : (singleScore && singleScore.teamId ? { [singleScore.teamId]: singleScore.score } : {});
        const dnfTeam = singleScore && singleScore.dnf ? singleScore.teamId : null;
        for (const team of camp.teams) {
            if (scoreMap[team.id] === undefined) continue;
            if (!isPlainObject(team.judgeStageScores[stageId])) team.judgeStageScores[stageId] = {};
            team.judgeStageScores[stageId][judgeKey] = judgeEntryFor(user, scoreMap[team.id], dnfTeam === team.id, judgeKey);
            // Tiered mode: totals change only when the stage is closed.
            if (!isTiered) { applyJudgesToStage(team, stageId); recomputeTeamScore(team); }
        }
        return { changes: { teams: camp.teams } };
    });
    res.json({ success: true, teams: publicState(camp).teams });
}));

// Operator / head referee manual correction of a stage value (score modal).
app.post('/api/stage_scores', route(async (req, res) => {
    const id = requireId(req.query.id, 'شناسه مسابقه');
    const { stageId, scores } = req.body || {};
    requireId(stageId, 'شناسه مرحله');
    if (!isPlainObject(scores)) throw new HttpError(400, 'نمرات نامعتبر است.');
    const { camp } = await mutateCamp(id, {}, camp => {
        const user = requireCampUser(req, camp, MANAGER_ROLES);
        if (!camp.stages.some(s => s.id === stageId)) throw new HttpError(404, 'مرحله یافت نشد.');
        if (camp.closedStages[stageId]) throw new HttpError(409, 'این مرحله بسته شده است. برای تغییر ابتدا آن را بازگشایی کنید.');
        const isTiered = camp.campType === 'tiered';
        for (const team of camp.teams) {
            if (scores[team.id] === undefined) continue;
            if (!isPlainObject(team.judgeStageScores[stageId])) team.judgeStageScores[stageId] = {};
            const entry = judgeEntryFor(user, scores[team.id], false, OVERRIDE_KEY);
            entry.judgeName = `${displayName(user)} (اصلاح دستی)`;
            entry.override = true;
            team.judgeStageScores[stageId][OVERRIDE_KEY] = entry;
            if (!isTiered) { applyJudgesToStage(team, stageId); recomputeTeamScore(team); }
        }
        const changed = camp.teams.filter(t => scores[t.id] !== undefined).map(t => ({ team: t.name, value: scores[t.id] }));
        return { changes: { teams: camp.teams }, audit: { user, action: 'stage_scores', details: { stage: stageName(camp, stageId), changed } } };
    });
    res.json({ success: true, teams: publicState(camp).teams });
}));

// Operator / head referee edits of one team's history (logs modal).
app.post('/api/team_logs', route(async (req, res) => {
    const id = requireId(req.query.id, 'شناسه مسابقه');
    const { teamId, values, removed, stageValues, removedStages } = req.body || {};
    requireId(teamId, 'شناسه تیم');
    const { camp } = await mutateCamp(id, {}, camp => {
        const user = requireCampUser(req, camp, MANAGER_ROLES);
        const team = camp.teams.find(t => t.id === teamId);
        if (!team) throw new HttpError(404, 'تیم یافت نشد.');
        const scoreBefore = team.score;
        const removedSet = new Set(Array.isArray(removed) ? removed : []);
        team.scoreLogs = team.scoreLogs.filter(l => !(l && removedSet.has(l.id)));
        if (isPlainObject(values)) {
            for (const log of team.scoreLogs) {
                if (log && values[log.id] !== undefined) log.value = round2(num(values[log.id]));
            }
        }
        if (isPlainObject(stageValues)) {
            for (const [sId, v] of Object.entries(stageValues)) {
                if (isValidId(sId)) team.stageScores[sId] = isDnfValue(v) ? '-' : round2(num(v));
            }
        }
        if (Array.isArray(removedStages)) {
            for (const sId of removedStages) delete team.stageScores[sId];
        }
        recomputeTeamScore(team);
        return { changes: { teams: camp.teams }, audit: { user, action: 'team_logs', details: { team: team.name, scoreBefore, scoreAfter: team.score } } };
    });
    res.json({ success: true, teams: publicState(camp).teams });
}));

// Closing a stage and computing tiered points (قواعد امتیازات پلکانی)
app.post('/api/stage/close_tiered', route(async (req, res) => {
    const { id, stageId, reopen, customLadder, customMultiplier } = req.body || {};
    requireId(id, 'شناسه مسابقه');
    requireId(stageId, 'شناسه مرحله');

    const { camp, payload } = await mutateCamp(id, {}, camp => {
        const user = requireCampUser(req, camp, MANAGER_ROLES);
        const stage = camp.stages.find(s => s.id === stageId);
        if (!stage) throw new HttpError(404, 'مرحله یافت نشد.');
        const closedStages = { ...camp.closedStages };
        const stageTieredResults = { ...camp.stageTieredResults };

        if (reopen) {
            delete closedStages[stageId];
            delete stageTieredResults[stageId];
            camp.teams.forEach(t => { delete t.stageScores[stageId]; recomputeTeamScore(t); });
            return {
                changes: { teams: camp.teams, closedStages, stageTieredResults },
                payload: { success: true, reopened: true, closedStages },
                audit: { user, action: 'stage_reopen', details: { stage: stage.name } }
            };
        }

        const ladder = parseLadder(customLadder !== undefined && customLadder !== null ? customLadder : camp.tieredPointsLadder);
        const cm = parseFloat(customMultiplier);
        if (Number.isFinite(cm) && cm > 0) stage.multiplier = cm;
        const sm = parseFloat(stage.multiplier);
        const multiplier = Number.isFinite(sm) && sm > 0 ? sm : 1;

        const results = computeTieredResults(camp.teams, stage, ladder, multiplier);
        const assigned = new Map(results.map(r => [r.teamId, r.assignedScore]));
        camp.teams.forEach(t => {
            t.stageScores[stageId] = assigned.get(t.id) || 0;
            recomputeTeamScore(t);
        });
        closedStages[stageId] = true;
        stageTieredResults[stageId] = { closedAt: Date.now(), ladder, multiplier, results };
        return {
            changes: { teams: camp.teams, stages: camp.stages, closedStages, stageTieredResults },
            payload: { success: true, closed: true, stageId, ladder, multiplier, results, stages: camp.stages, closedStages },
            audit: { user, action: 'stage_close', details: { stage: stage.name, multiplier } }
        };
    });
    res.json({ ...payload, teams: publicState(camp).teams });
}));

// ---------------------------------------------------------------------------
// Camp management (superadmin)
// ---------------------------------------------------------------------------
function requireNewPassword(pw) {
    if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) throw new HttpError(400, `رمز عبور جدید باید حداقل ${MIN_PASSWORD} کاراکتر باشد.`);
    return pw;
}

function resetTeamScores(team) {
    team.scoreLogs = [];
    team.stageScores = {};
    team.judgeStageScores = {};
    team.score = 0;
}

// Deleting moves the camp to the trash; it can be restored for TRASH_DAYS days.
app.post('/superadmin/camps/:id/delete', route(async (req, res) => {
    await requireSuperadmin(req);
    const id = requireId(req.params.id);
    await mutateCamp(id, { allowLocked: true }, () => ({ changes: { deletedAt: Date.now() } }));
    res.json({ success: true, trashDays: TRASH_DAYS });
}));

app.get('/superadmin/trash', route(async (req, res) => {
    await requireSuperadmin(req);
    const all = await store.listCamps(['orgName', 'title', 'campType', 'deletedAt']);
    await purgeExpiredTrash(all);
    const limit = Date.now() - TRASH_DAYS * 86400000;
    const camps = all.filter(c => c.deletedAt && c.deletedAt >= limit)
        .map(c => ({ id: c.id, orgName: c.orgName || '', title: c.title || '', campType: c.campType, deletedAt: c.deletedAt, purgeAt: c.deletedAt + TRASH_DAYS * 86400000 }))
        .sort((a, b) => b.deletedAt - a.deletedAt);
    res.json({ success: true, camps, trashDays: TRASH_DAYS });
}));

app.post('/superadmin/camps/:id/restore', route(async (req, res) => {
    await requireSuperadmin(req);
    const id = requireId(req.params.id);
    await mutateCamp(id, { allowLocked: true, allowDeleted: true }, camp => {
        if (!camp.deletedAt) throw new HttpError(400, 'این مسابقه در سطل زباله نیست.');
        return { changes: { deletedAt: null } };
    });
    res.json({ success: true });
}));

// Permanent removal (only from the trash).
app.post('/superadmin/camps/:id/purge', route(async (req, res) => {
    await requireSuperadmin(req);
    const id = requireId(req.params.id);
    await withLock(id, async () => {
        const d = await store.getCampDoc(id);
        if (!d) throw new HttpError(404, 'مسابقه یافت نشد.');
        if (!d.doc.deletedAt) throw new HttpError(400, 'فقط مسابقه‌های داخل سطل زباله را می‌توان برای همیشه حذف کرد.');
        await repo.purge(id);
    });
    res.json({ success: true });
}));

let lastTrashPurge = 0;
async function purgeExpiredTrash(list) {
    if (Date.now() - lastTrashPurge < 3600000) return;
    lastTrashPurge = Date.now();
    const limit = Date.now() - TRASH_DAYS * 86400000;
    for (const c of list || await store.listCamps(['deletedAt'])) {
        if (c.deletedAt && c.deletedAt < limit) {
            await repo.purge(c.id);
            console.log(`[trash] camp ${c.id} permanently deleted after ${TRASH_DAYS} days in the trash`);
        }
    }
}
setInterval(() => { if (ready) purgeExpiredTrash().catch(e => console.error('[trash]', e.message)); }, 6 * 3600000).unref();

// ---------------------------------------------------------------------------
// Backups: one camp or everything, as a JSON file that both editions (Node / PHP) can import.
// ---------------------------------------------------------------------------
function sendBackup(res, backup, name) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/json').send(JSON.stringify(backup));
}

app.get('/superadmin/camps/:id/export', route(async (req, res) => {
    await requireSuperadmin(req);
    const id = requireId(req.params.id);
    const backup = await buildBackup(store, [id]);
    if (!backup.camps.length) throw new HttpError(404, 'مسابقه یافت نشد.');
    sendBackup(res, backup, `sim-camp-${id}`);
}));

app.get('/superadmin/backup', route(async (req, res) => {
    await requireSuperadmin(req);
    sendBackup(res, await buildBackup(store, await allCampIds(store), { includeSettings: true }), 'sim-camp-backup');
}));

// Restores camps from a backup file. Existing camps are never overwritten: a camp whose link is
// taken is imported under a new link.
app.post('/superadmin/import', route(async (req, res) => {
    await requireSuperadmin(req);
    const b = req.body || {};
    if (b.format !== BACKUP_FORMAT || !Array.isArray(b.camps)) throw new HttpError(400, 'این فایل، فایل پشتیبان سیم‌کمپ نیست.');
    // Images first, so the camps can refer to them.
    let mediaCount = 0;
    for (const [name, data] of Object.entries(isPlainObject(b.media) ? b.media : {})) {
        if (!MEDIA_NAME_RE.test(name) || typeof data !== 'string') continue;
        const buf = Buffer.from(data, 'base64');
        if (mediaNameFor(buf, name.split('.').pop()) !== name) continue; // corrupted
        await store.putMedia(name, buf, MEDIA_TYPES[name.split('.').pop()]);
        mediaCount++;
    }
    const imported = [];
    let foreignPasswords = false;
    for (const raw of b.camps) {
        if (!isPlainObject(raw) || !Array.isArray(raw.teams)) continue;
        const camp = parseCamp({ ...raw });
        delete camp.deletedAt;
        delete camp.rev;
        // Password hashes of the PHP edition (bcrypt) cannot be checked here and vice versa.
        const secrets = [camp.password, ...camp.users.map(u => u.password)].filter(Boolean);
        if (secrets.some(h => /^\$2[aby]\$/.test(h))) foreignPasswords = true;
        let id = CAMP_ID_RE.test(String(raw.id || '')) ? raw.id : newRandomCampId();
        for (let i = 0; ; i++) {
            try {
                await repo.create(id, { ...camp, id });
                break;
            } catch (e) {
                if (e instanceof TooLargeError) throw tooLarge();
                if (!(e instanceof ExistsError) || i > 5) throw e;
                id = `${String(raw.id || 'camp').slice(0, 50)}-${crypto.randomBytes(3).toString('hex')}`;
            }
        }
        imported.push({ id, originalId: raw.id || null, title: camp.title || '' });
    }
    if (isPlainObject(b.settings) && typeof b.settings.systemLogo === 'string' && b.settings.systemLogo && !(await getSetting('systemLogo'))) {
        const stored = await repo.externalize(b.settings.systemLogo);
        await setSetting('systemLogo', stored);
        systemLogoCache = { value: stored, until: Date.now() + 30000 };
    }
    res.json({ success: true, imported, media: mediaCount, foreignPasswords });
}));

app.post('/superadmin/camps/:id/duplicate', route(async (req, res) => {
    await requireSuperadmin(req);
    const src = await loadCampOr404(requireId(req.params.id));
    const newId = requestedCampId((req.body || {}).customId) || newRandomCampId();
    const title = typeof (req.body || {}).title === 'string' && req.body.title.trim() ? strOrEmpty(req.body.title.trim(), 200) : `${src.title || ''} (کپی)`;
    const teams = src.teams.map(t => {
        const copy = { ...t };
        resetTeamScores(copy);
        return copy;
    });
    const camp = {
        id: newId, orgName: src.orgName || '', title, logo: src.logo || '', password: src.password || '',
        teams, stages: src.stages, users: src.users, numLang: src.numLang, dir: src.dir, campType: src.campType,
        tieredPointsLadder: src.tieredPointsLadder, fieldJudgingMode: src.fieldJudgingMode, fieldJudgingValues: src.fieldJudgingValues,
        positiveTags: src.positiveTags, negativeTags: src.negativeTags,
        locked: 0, archived: false, closedStages: {}, stageTieredResults: {}, auditLog: [], announcement: null, activeStageId: null
    };
    await createCampUnique(newId, camp);
    res.json({ success: true, campId: newId });
}));

app.post('/superadmin/password', route(async (req, res) => {
    await requireSuperadmin(req);
    const { currentPassword, newPassword } = req.body || {};
    if (!await verifyPassword(currentPassword, superadminHash)) throw new HttpError(400, 'رمز عبور فعلی اشتباه است.');
    superadminHash = await hashPassword(requireNewPassword(newPassword));
    await setSetting('superadmin_password_custom', superadminHash);
    // The fingerprint changed, so hand back a fresh token for this browser.
    res.json({ success: true, token: createToken({ t: 'sa', pv: fingerprint(superadminHash) }, SESSION_SECRET) });
}));

// ---------------------------------------------------------------------------
// Passwords of camp users
// ---------------------------------------------------------------------------
app.post('/api/user/password', route(async (req, res) => {
    const { campId, currentPassword, newPassword } = req.body || {};
    const id = requireId(campId, 'شناسه مسابقه');
    requireNewPassword(newPassword);
    const { username, secret } = await mutateCamp(id, { allowLocked: true }, async camp => {
        const me = requireCampUser(req, camp);
        const found = findCampUser(camp, me.username);
        if (!await verifyPassword(currentPassword, found.secret)) throw new HttpError(400, 'رمز عبور فعلی اشتباه است.');
        const hash = await hashPassword(newPassword);
        const user = camp.users.find(u => u.username === me.username);
        if (user) {
            user.password = hash;
            return { username: me.username, secret: hash, changes: { users: camp.users }, audit: { user: me, action: 'password_change', details: {} } };
        }
        return { username: me.username, secret: hash, changes: { password: hash }, audit: { user: me, action: 'password_change', details: {} } };
    });
    res.json({ success: true, token: createToken({ t: 'camp', campId: id, username, pv: fingerprint(secret) }, SESSION_SECRET) });
}));

// Operators may reset head referees' and referees' passwords; head referees may reset referees'.
app.post('/api/users/reset_password', route(async (req, res) => {
    const id = requireId(req.query.id, 'شناسه مسابقه');
    const { username, newPassword } = req.body || {};
    requireNewPassword(newPassword);
    const newHash = await hashPassword(newPassword); // outside the camp lock
    await mutateCamp(id, { allowLocked: true }, camp => {
        const me = requireCampUser(req, camp, MANAGER_ROLES);
        const target = camp.users.find(u => u.username === username);
        if (!target) throw new HttpError(404, 'کاربر یافت نشد.');
        const allowed = me.role === 'operator' ? ['head_referee', 'referee'] : ['referee'];
        if (!allowed.includes(target.role)) throw new HttpError(403, 'شما اجازه تغییر رمز این کاربر را ندارید.');
        target.password = newHash;
        return { changes: { users: camp.users }, audit: { user: me, action: 'password_reset', details: { target: displayName(target) } } };
    });
    res.json({ success: true });
}));

// Users a manager may manage (no credentials).
app.get('/api/users', route(async (req, res) => {
    const camp = await loadCampOr404(requireId(req.query.id, 'شناسه مسابقه'));
    const me = requireCampUser(req, camp, MANAGER_ROLES);
    const allowed = me.role === 'operator' ? ['head_referee', 'referee'] : ['referee'];
    res.json({ success: true, users: camp.users.map(publicUser).map(u => ({ ...u, canReset: allowed.includes(u.role) })) });
}));

// ---------------------------------------------------------------------------
// Resets, live board control and audit log
// ---------------------------------------------------------------------------
app.post('/api/stage/reset', route(async (req, res) => {
    const id = requireId(req.query.id, 'شناسه مسابقه');
    const stageId = requireId((req.body || {}).stageId, 'شناسه مرحله');
    const { camp } = await mutateCamp(id, {}, camp => {
        const user = requireCampUser(req, camp, MANAGER_ROLES);
        if (!camp.stages.some(s => s.id === stageId)) throw new HttpError(404, 'مرحله یافت نشد.');
        const closedStages = { ...camp.closedStages };
        const stageTieredResults = { ...camp.stageTieredResults };
        delete closedStages[stageId];
        delete stageTieredResults[stageId];
        camp.teams.forEach(t => {
            delete t.judgeStageScores[stageId];
            delete t.stageScores[stageId];
            recomputeTeamScore(t);
        });
        return {
            changes: { teams: camp.teams, closedStages, stageTieredResults },
            audit: { user, action: 'stage_reset', details: { stage: stageName(camp, stageId) } }
        };
    });
    res.json({ success: true, teams: publicState(camp).teams });
}));

app.post('/api/scores/reset', route(async (req, res) => {
    const id = requireId(req.query.id, 'شناسه مسابقه');
    if ((req.body || {}).confirm !== 'RESET') throw new HttpError(400, 'تأیید بازنشانی دریافت نشد.');
    const { camp } = await mutateCamp(id, {}, camp => {
        const user = requireCampUser(req, camp, ['operator']);
        camp.teams.forEach(resetTeamScores);
        return {
            changes: { teams: camp.teams, closedStages: {}, stageTieredResults: {}, announcement: null },
            audit: { user, action: 'scores_reset', details: {} }
        };
    });
    res.json({ success: true, teams: publicState(camp).teams });
}));

// Which stage is running now, and the final-results announcement on the live board.
app.post('/api/board', route(async (req, res) => {
    const id = requireId(req.query.id, 'شناسه مسابقه');
    const b = req.body || {};
    await mutateCamp(id, { allowLocked: true }, camp => {
        const user = requireCampUser(req, camp, MANAGER_ROLES);
        const changes = {};
        if (b.activeStageId !== undefined) {
            if (b.activeStageId !== null && !camp.stages.some(s => s.id === b.activeStageId)) throw new HttpError(404, 'مرحله یافت نشد.');
            changes.activeStageId = b.activeStageId;
        }
        if (b.announcement === 'show') changes.announcement = { active: true, at: Date.now() };
        if (b.announcement === 'hide') changes.announcement = null;
        return { changes, audit: { user, action: 'board', details: { activeStage: changes.activeStageId !== undefined ? (changes.activeStageId ? stageName(camp, changes.activeStageId) : null) : undefined, announcement: b.announcement } } };
    });
    res.json({ success: true });
}));

// Ends the competition: locks scoring and (optionally) starts the results announcement.
app.post('/api/finish', route(async (req, res) => {
    const id = requireId(req.query.id, 'شناسه مسابقه');
    await mutateCamp(id, {}, camp => {
        const user = requireCampUser(req, camp, MANAGER_ROLES);
        const changes = { locked: 1 };
        if ((req.body || {}).announce) changes.announcement = { active: true, at: Date.now() };
        return { changes, audit: { user, action: 'finish', details: {} } };
    });
    res.json({ success: true });
}));

app.get('/api/audit', route(async (req, res) => {
    const camp = await loadCampOr404(requireId(req.query.id, 'شناسه مسابقه'));
    requireCampUser(req, camp, MANAGER_ROLES);
    res.json({ success: true, entries: [...camp.auditLog].reverse() });
}));

// Body parser errors (too large / invalid JSON) as JSON instead of an HTML error page.
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.too.large') {
        return res.status(413).json({ success: false, error: 'حجم اطلاعات ارسالی بیش از حد مجاز است. تصاویر کوچک‌تر انتخاب کنید.', message: 'حجم اطلاعات ارسالی بیش از حد مجاز است. تصاویر کوچک‌تر انتخاب کنید.' });
    }
    if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({ success: false, error: 'اطلاعات ارسالی معتبر نیست.', message: 'اطلاعات ارسالی معتبر نیست.' });
    }
    console.error(err);
    res.status(500).json({ success: false, error: 'خطای داخلی سرور', message: 'خطای داخلی سرور' });
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// An unexpected exception leaves the process in an unknown state: log it and exit so the
// process manager (pm2 / systemd / Cloud Run) starts a clean instance.
process.on('uncaughtException', err => {
    console.error('Uncaught exception, exiting:', err);
    process.exit(1);
});

// Keeps retrying until the database answers, instead of crashing at boot.
async function startWithRetry() {
    let delay = 2000;
    for (;;) {
        try {
            await initSecurity();
            lastStartupError = null;
            console.log('✅ Ready');
            return;
        } catch (e) {
            lastStartupError = e.message;
            console.error(`Startup: database not reachable (${e.message}); retrying in ${delay / 1000} s`);
            await new Promise(r => setTimeout(r, delay));
            delay = Math.min(delay * 2, 30000);
        }
    }
}

export { app, initSecurity };

if (process.env.NODE_ENV !== 'test') {
    const configErrors = validateConfig();
    if (configErrors.length) {
        console.error('❌ Configuration error:\n - ' + configErrors.join('\n - '));
        process.exit(1);
    }
    configWarnings().forEach(w => console.warn('⚠️  ' + w));
    const server = app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
    startWithRetry();

    // Graceful shutdown: stop accepting requests, close live boards (they reconnect), then exit.
    let stopping = false;
    const shutdown = signal => {
        if (stopping) return;
        stopping = true;
        console.log(`${signal} received, shutting down…`);
        server.close(() => process.exit(0));
        for (const set of sseClients.values()) for (const res of set) { try { res.end(); } catch (e) { /* ignore */ } }
        setTimeout(() => process.exit(0), 10000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}
