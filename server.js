import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import * as rawDb from './db/index.js';
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
const MAX_CAMP_BYTES = (process.env.DB_ADAPTER || 'firebase') === 'firebase' ? 950 * 1024 : 15 * 1024 * 1024;
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
const STARTED_AT = Date.now();

function withTimeout(promise, ms, makeError) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(makeError()), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Every database call gets a deadline, so a hanging connection can never freeze the server.
const dbTimeoutError = name => () => new HttpError(503, `پایگاه داده پاسخ نمی‌دهد (${name}). چند لحظه بعد دوباره تلاش کنید.`);
const timed = (fn, name) => (...args) => withTimeout(Promise.resolve().then(() => fn(...args)), DB_TIMEOUT_MS, dbTimeoutError(name));
const getCamp = timed(rawDb.getCamp, 'getCamp');
const updateCamp = timed(rawDb.updateCamp, 'updateCamp');
const getSetting = timed(rawDb.getSetting, 'getSetting');
const setSetting = timed(rawDb.setSetting, 'setSetting');
const getAllCamps = timed(rawDb.getAllCamps, 'getAllCamps');
const deleteCamp = timed(rawDb.deleteCamp, 'deleteCamp');

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

// Writes a new camp, refusing to overwrite an existing one with the same id.
async function createCampUnique(id, camp) {
    await withLock(id, async () => {
        if (await getCamp(id)) throw new HttpError(409, `لینک «${id}» قبلاً برای مسابقه دیگری استفاده شده است. لینک دیگری انتخاب کنید.`);
        await updateCamp(id, camp);
    });
}

function strOrEmpty(v, max = 500) {
    return typeof v === 'string' ? v.slice(0, max) : '';
}

function assertSize(camp) {
    if (JSON.stringify(camp).length > MAX_CAMP_BYTES) {
        throw new HttpError(413, 'حجم اطلاعات مسابقه (به‌ویژه تصاویر) بیش از حد مجاز است. لطفاً تصاویر کوچک‌تر یا لینک تصویر استفاده کنید.');
    }
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
    camp.teams.forEach(normalizeTeam);
    return camp;
}

async function loadCamp(id) {
    return parseCamp(await getCamp(id));
}

async function loadCampOr404(id) {
    const camp = await loadCamp(id);
    if (!camp) throw new HttpError(404, 'مسابقه یافت نشد.');
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
    const { password, users, auditLog, ...rest } = camp;
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

function broadcastState(id, camp) {
    if (sseClients.get(id)?.size) sendToClients(id, `data: ${JSON.stringify(publicState(camp))}\n\n`);
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

// Load → mutate → save → broadcast, all under the camp lock.
async function mutateCamp(id, { allowLocked = false } = {}, mutate) {
    return withLock(id, async lease => {
        const camp = await loadCampOr404(id);
        if (!allowLocked && isLocked(camp)) throw new HttpError(403, 'این مسابقه قفل شده است.');
        const result = await mutate(camp);
        let changes = result && result.changes;
        if (changes && result.audit) {
            const { user, action, details } = result.audit;
            const entry = { ts: Date.now(), by: { username: user.username, name: displayName(user), role: user.role }, action, details: details || {} };
            changes = { ...changes, auditLog: [...camp.auditLog, entry].slice(-AUDIT_LIMIT) };
        }
        if (changes) {
            Object.assign(camp, changes);
            assertSize(camp);
            // A timed-out operation must not write after the lock has passed to the next request.
            if (lease.expired) throw new HttpError(503, 'انجام عملیات بیش از حد طول کشید و لغو شد.');
            await updateCamp(id, changes);
            broadcastState(id, camp);
        }
        return { camp, ...(result || {}) };
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
        SESSION_SECRET = await getSetting('session_secret');
        if (!SESSION_SECRET) {
            SESSION_SECRET = randomSecret();
            await setSetting('session_secret', SESSION_SECRET);
        }
    }
    // A password changed from the panel wins over the environment variable,
    // unless SUPERADMIN_PASS_RESET=1 is set (recovery when the password is forgotten).
    const custom = process.env.SUPERADMIN_PASS_RESET === '1' ? null : await getSetting('superadmin_password_custom');
    if (custom) {
        superadminHash = custom;
    } else if (process.env.SUPERADMIN_PASS) {
        if (process.env.SUPERADMIN_PASS === 'admin123') {
            console.warn('⚠️  SUPERADMIN_PASS is the well-known default "admin123". Please change it.');
        }
        superadminHash = await hashPassword(process.env.SUPERADMIN_PASS);
    } else {
        superadminHash = await getSetting('superadmin_password_hash');
        if (!superadminHash) {
            const generated = randomPassword(14);
            superadminHash = await hashPassword(generated);
            await setSetting('superadmin_password_hash', superadminHash);
            console.log('==============================================================');
            console.log(`🔐 Generated superadmin password: ${generated}`);
            console.log('   Set SUPERADMIN_PASS to choose your own.');
            console.log('==============================================================');
        }
    }
    ready = true;
}

// Configuration problems that do not stop the server but are reported by /health.
function configWarnings() {
    const w = [];
    const info = typeof rawDb.adapterInfo === 'function' ? rawDb.adapterInfo() : {};
    if (info.mode === 'web') w.push('FIREBASE_SERVICE_ACCOUNT is not set: using the Firebase Web SDK, which needs open (insecure) Firestore rules.');
    if (process.env.SUPERADMIN_PASS === 'admin123') w.push('SUPERADMIN_PASS is the well-known default "admin123".');
    if ((process.env.DB_ADAPTER || 'firebase') === 'memory') w.push('DB_ADAPTER=memory: data is lost when the server restarts.');
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

function requireSuperadmin(req) {
    const p = verifyToken(readToken(req), SESSION_SECRET);
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
        await withTimeout(rawDb.getSetting('session_secret'), 3000, () => new Error('timeout'));
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
        adapter: process.env.DB_ADAPTER || 'firebase',
        firebaseMode: typeof rawDb.adapterInfo === 'function' ? rawDb.adapterInfo().mode : undefined,
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
const LARGE_BODY_ROUTES = new Set(['/setup', '/api', '/api/settings', '/api/user/profile-pic']);
const jsonSmall = express.json({ limit: BODY_LIMIT_SMALL });
const jsonLarge = express.json({ limit: BODY_LIMIT_LARGE });
app.use((req, res, next) => {
    if (req.method !== 'POST' || !LARGE_BODY_ROUTES.has(req.path)) return jsonSmall(req, res, next);
    if (!verifyToken(readToken(req), SESSION_SECRET)) {
        return res.status(401).json({ success: false, error: 'برای این عملیات باید وارد شوید.', message: 'برای این عملیات باید وارد شوید.' });
    }
    return jsonLarge(req, res, next);
});

// ---------------------------------------------------------------------------
// Global settings
// ---------------------------------------------------------------------------
app.get('/api/settings', route(async (req, res) => {
    res.json({ systemLogo: await getSetting('systemLogo') });
}));

app.post('/api/settings', route(async (req, res) => {
    requireSuperadmin(req);
    const { key, value } = req.body || {};
    if (key !== 'systemLogo') throw new HttpError(400, 'کلید تنظیمات مجاز نیست.');
    if (typeof value !== 'string' || value.length > 2_000_000) throw new HttpError(400, 'مقدار نامعتبر است.');
    await setSetting(key, value);
    res.json({ success: true });
}));

// ---------------------------------------------------------------------------
// Superadmin
// ---------------------------------------------------------------------------
app.get('/', (req, res) => res.redirect('/superadmin.html'));

app.post('/superadmin/login', route(async (req, res) => {
    if (!loginLimiter.check('sa:' + clientIp(req))) throw new HttpError(429, 'تلاش‌های ناموفق زیاد بود. چند دقیقه دیگر دوباره امتحان کنید.');
    const password = req.body && req.body.password;
    if (!await verifyPassword(password, superadminHash)) {
        return res.json({ success: false, message: 'رمز عبور سوپرادمین اشتباه است!' });
    }
    loginLimiter.reset('sa:' + clientIp(req));
    res.json({ success: true, token: createToken({ t: 'sa', pv: fingerprint(superadminHash) }, SESSION_SECRET) });
}));

app.get('/superadmin/camps', route(async (req, res) => {
    requireSuperadmin(req);
    const camps = (await getAllCamps()).map(c => ({
        id: c.id, orgName: c.orgName, title: c.title, locked: isLocked(c), campType: c.campType, archived: !!c.archived
    }));
    res.json({ success: true, camps });
}));

app.get('/superadmin/camps/:id', route(async (req, res) => {
    requireSuperadmin(req);
    const camp = await loadCamp(requireId(req.params.id));
    if (!camp) return res.json({ success: false, message: 'یافت نشد' });
    res.json({ success: true, camp: adminState(camp) });
}));

app.post('/superadmin/camps/:id/lock', route(async (req, res) => {
    requireSuperadmin(req);
    const id = requireId(req.params.id);
    await mutateCamp(id, { allowLocked: true }, () => ({ changes: { locked: req.body && req.body.locked ? 1 : 0 } }));
    res.json({ success: true });
}));

app.post('/superadmin/camps/:id/archive', route(async (req, res) => {
    requireSuperadmin(req);
    const id = requireId(req.params.id);
    await mutateCamp(id, { allowLocked: true }, () => ({ changes: { archived: !!(req.body && req.body.archived) } }));
    res.json({ success: true });
}));

app.post('/setup', route(async (req, res) => {
    requireSuperadmin(req);
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
    assertSize(camp);
    await createCampUnique(id, camp);
    res.json({ success: true, campId: id });
}));

// Superadmin form: live check of a custom camp link.
app.get('/superadmin/id_available', route(async (req, res) => {
    requireSuperadmin(req);
    const id = String(req.query.id || '').trim();
    if (!CAMP_ID_RE.test(id)) return res.json({ success: true, available: false, reason: 'invalid', message: CAMP_ID_HELP });
    const taken = !!(await getCamp(id));
    res.json({ success: true, available: !taken, reason: taken ? 'taken' : null, message: taken ? 'این لینک قبلاً برای مسابقه دیگری استفاده شده است.' : '' });
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

    const result = await withLock(id, async () => {
        const camp = await loadCamp(id);
        if (!camp) return null;
        const found = findCampUser(camp, username);
        if (!found || !await verifyPassword(password, found.secret)) return null;
        let secret = found.secret;
        // Upgrade legacy plain-text passwords to hashes on first successful login.
        if (!isHashed(secret)) {
            secret = await hashPassword(password);
            if (!camp.users.includes(found.user)) {
                await updateCamp(id, { password: secret });
            } else {
                found.user.password = secret;
                await updateCamp(id, { users: camp.users });
            }
        }
        return { camp, user: found.user, secret };
    });
    if (!result) return fail();
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
    const pic = typeof profilePic === 'string' ? profilePic : '';
    if (pic.length > 500_000) throw new HttpError(413, 'حجم عکس پروفایل بیش از حد مجاز است.');
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
        const camp = await loadCampOr404(requireId(id, 'شناسه مسابقه'));
        return res.json(publicState(camp));
    }
    if (action === 'stream') {
        requireId(id, 'شناسه مسابقه');
        // Caps on open live-board connections (one per screen) protect memory and sockets.
        const ip = clientIp(req);
        let total = 0;
        for (const set of sseClients.values()) total += set.size;
        if (total >= SSE_MAX_TOTAL) throw new HttpError(503, 'ظرفیت تابلوهای زنده سرور پر است. کمی بعد دوباره تلاش کنید.');
        if ((sseByIp.get(ip) || 0) >= SSE_MAX_PER_IP) throw new HttpError(429, 'تعداد تابلوهای باز از این شبکه بیش از حد مجاز است.');
        const camp = await loadCampOr404(id);
        sseByIp.set(ip, (sseByIp.get(ip) || 0) + 1);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        if (!sseClients.has(id)) sseClients.set(id, new Set());
        const clients = sseClients.get(id);
        clients.add(res);
        res.write(`data: ${JSON.stringify(publicState(camp))}\n\n`);
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
        team.scoreLogs.push({
            id: logId, type: 'instant', value: round2(value), timestamp: Date.now(),
            user: publicUser(user), tag: strOrEmpty(tag, 100)
        });
        recomputeTeamScore(team);
        return { team, changes: { teams: camp.teams } };
    });
    if (duplicate) return res.json({ success: true, logId, duplicate: true });

    sendToClients(id, `event: splash\ndata: ${JSON.stringify({
        teamId, delta: round2(value), teamName: team.name, score: team.score,
        user: publicUser(team.scoreLogs[team.scoreLogs.length - 1].user), tag: strOrEmpty(tag, 100), logId,
        image: team.image || '', happyImage: team.happyImage || '', sadImage: team.sadImage || '',
        teamColor: team.color || '#3b82f6'
    })}\n\n`);
    res.json({ success: true, logId });
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

app.post('/superadmin/camps/:id/delete', route(async (req, res) => {
    requireSuperadmin(req);
    const id = requireId(req.params.id);
    await withLock(id, async () => {
        await loadCampOr404(id);
        await deleteCamp(id);
    });
    sendToClients(id, `event: deleted\ndata: {}\n\n`);
    res.json({ success: true });
}));

app.post('/superadmin/camps/:id/duplicate', route(async (req, res) => {
    requireSuperadmin(req);
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
    assertSize(camp);
    await createCampUnique(newId, camp);
    res.json({ success: true, campId: newId });
}));

app.post('/superadmin/password', route(async (req, res) => {
    requireSuperadmin(req);
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
