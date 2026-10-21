import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import { getCamp, updateCamp, getSetting, setSetting, getAllCamps } from './db/index.js';
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
const MANAGER_ROLES = ['operator', 'head_referee'];

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
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
    const { password, users, ...rest } = camp;
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
        sendToClients(id, ':\n\n');
    }
}, 15000).unref();

// Per-camp mutex so concurrent requests never overwrite each other's changes.
const campLocks = new Map();
async function withLock(id, fn) {
    const prev = campLocks.get(id) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    const tail = prev.then(() => current);
    campLocks.set(id, tail);
    await prev;
    try {
        return await fn();
    } finally {
        release();
        if (campLocks.get(id) === tail) campLocks.delete(id);
    }
}

// Load → mutate → save → broadcast, all under the camp lock.
async function mutateCamp(id, { allowLocked = false } = {}, mutate) {
    return withLock(id, async () => {
        const camp = await loadCampOr404(id);
        if (!allowLocked && isLocked(camp)) throw new HttpError(403, 'این مسابقه قفل شده است.');
        const result = await mutate(camp);
        const changes = result && result.changes;
        if (changes) {
            Object.assign(camp, changes);
            assertSize(camp);
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
    if (process.env.SUPERADMIN_PASS) {
        if (process.env.SUPERADMIN_PASS === 'admin123') {
            console.warn('⚠️  SUPERADMIN_PASS is the well-known default "admin123". Please change it.');
        }
        superadminHash = hashPassword(process.env.SUPERADMIN_PASS);
    } else {
        superadminHash = await getSetting('superadmin_password_hash');
        if (!superadminHash) {
            const generated = randomPassword(14);
            superadminHash = hashPassword(generated);
            await setSetting('superadmin_password_hash', superadminHash);
            console.log('==============================================================');
            console.log(`🔐 Generated superadmin password: ${generated}`);
            console.log('   Set SUPERADMIN_PASS to choose your own.');
            console.log('==============================================================');
        }
    }
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
function cleanUsers(users, existingUsers = []) {
    if (!Array.isArray(users)) return [];
    const byName = new Map(existingUsers.map(u => [u.username, u]));
    const byId = new Map(existingUsers.filter(u => u.id).map(u => [u.id, u]));
    const seen = new Set();
    return users.map(u => {
        const username = strOrEmpty(u && u.username, 100).trim();
        if (!username) throw new HttpError(400, 'نام کاربری خالی است.');
        if (seen.has(username)) throw new HttpError(400, `نام کاربری «${username}» تکراری است.`);
        seen.add(username);
        const prev = (u.id && byId.get(u.id)) || byName.get(username);
        let password;
        if (typeof u.password === 'string' && u.password !== '') password = hashPassword(u.password);
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
    });
}

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
    if (!verifyPassword(password, superadminHash)) {
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
        await mutateCamp(id, { allowLocked: true }, camp => {
            const changes = {
                ...base,
                teams: mergeTeams(camp.teams, teamDefs),
                users: cleanUsers(b.users, camp.users)
            };
            if (typeof b.password === 'string' && b.password !== '') changes.password = hashPassword(b.password);
            return { changes };
        });
        return res.json({ success: true, campId: id });
    }

    if (typeof b.password !== 'string' || b.password === '') throw new HttpError(400, 'رمز عبور اپراتور الزامی است.');
    const id = 'camp_' + crypto.randomBytes(6).toString('hex');
    const camp = {
        id, ...base,
        password: hashPassword(b.password),
        teams: mergeTeams([], teamDefs),
        users: cleanUsers(b.users, []),
        locked: 0,
        archived: false,
        closedStages: {},
        stageTieredResults: {}
    };
    assertSize(camp);
    await updateCamp(id, camp);
    res.json({ success: true, campId: id });
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
        if (!found || !verifyPassword(password, found.secret)) return null;
        let secret = found.secret;
        // Upgrade legacy plain-text passwords to hashes on first successful login.
        if (!isHashed(secret)) {
            secret = hashPassword(password);
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
        const camp = await loadCampOr404(id);
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
        requireCampUser(req, camp, MANAGER_ROLES);
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
        return { changes };
    });
    res.json({ success: true, status: 'success' });
}));

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
app.post('/api/instant', route(async (req, res) => {
    const id = requireId(req.query.id, 'شناسه مسابقه');
    const { teamId, delta, tag } = req.body || {};
    requireId(teamId, 'شناسه تیم');
    const value = Number(delta);
    if (!Number.isFinite(value) || value === 0 || Math.abs(value) > 1_000_000) throw new HttpError(400, 'مقدار امتیاز نامعتبر است.');
    const logId = 'log_' + crypto.randomBytes(6).toString('hex');

    const { team } = await mutateCamp(id, {}, camp => {
        const user = requireCampUser(req, camp);
        const team = camp.teams.find(t => t.id === teamId);
        if (!team) throw new HttpError(404, 'تیم یافت نشد.');
        team.scoreLogs.push({
            id: logId, type: 'instant', value: round2(value), timestamp: Date.now(),
            user: publicUser(user), tag: strOrEmpty(tag, 100)
        });
        recomputeTeamScore(team);
        return { team, changes: { teams: camp.teams } };
    });

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
            for (const team of camp.teams) {
                if (onlyTeam && team.id !== onlyTeam) continue;
                const map = team.judgeStageScores[stageId];
                if (!map || !map[targetJudgeKey]) continue;
                delete map[targetJudgeKey];
                if (!isTiered) { applyJudgesToStage(team, stageId, true); recomputeTeamScore(team); }
            }
            return { changes: { teams: camp.teams } };
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
        return { changes: { teams: camp.teams } };
    });
    res.json({ success: true, teams: publicState(camp).teams });
}));

// Operator / head referee edits of one team's history (logs modal).
app.post('/api/team_logs', route(async (req, res) => {
    const id = requireId(req.query.id, 'شناسه مسابقه');
    const { teamId, values, removed, stageValues, removedStages } = req.body || {};
    requireId(teamId, 'شناسه تیم');
    const { camp } = await mutateCamp(id, {}, camp => {
        requireCampUser(req, camp, MANAGER_ROLES);
        const team = camp.teams.find(t => t.id === teamId);
        if (!team) throw new HttpError(404, 'تیم یافت نشد.');
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
        return { changes: { teams: camp.teams } };
    });
    res.json({ success: true, teams: publicState(camp).teams });
}));

// Closing a stage and computing tiered points (قواعد امتیازات پلکانی)
app.post('/api/stage/close_tiered', route(async (req, res) => {
    const { id, stageId, reopen, customLadder, customMultiplier } = req.body || {};
    requireId(id, 'شناسه مسابقه');
    requireId(stageId, 'شناسه مرحله');

    const { camp, payload } = await mutateCamp(id, {}, camp => {
        requireCampUser(req, camp, MANAGER_ROLES);
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
                payload: { success: true, reopened: true, closedStages }
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
            payload: { success: true, closed: true, stageId, ladder, multiplier, results, stages: camp.stages, closedStages }
        };
    });
    res.json({ ...payload, teams: publicState(camp).teams });
}));

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

export { app, initSecurity };

if (process.env.NODE_ENV !== 'test') {
    await initSecurity();
    app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
}
