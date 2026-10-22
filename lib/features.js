// Display switches, optional features and the sanitising of their settings.
// Mirrored in cpanel_export/api.php — keep both in sync.
//
// Principle: everything that is only *shown* is on by default (each item can be hidden per camp);
// features that ask referees for extra input are off until a camp turns them on, so the referee
// screen stays as simple as it is.
import crypto from 'crypto';
import { isPlainObject, isValidId, num, round2 } from './campLogic.js';

// Visible elements (default: shown).
export const DISPLAY_KEYS = [
    // live board
    'confetti', 'splash', 'moodImages', 'sound', 'ranks', 'trendChart', 'badges', 'ticker', 'timer', 'schedule',
    'individual', 'roles', 'budget', 'varBanner', 'chanceCards', 'decisions', 'brand', 'divisions', 'bracket',
    // referee screen
    'judgeTimer', 'judgeRemaining', 'judgeMessages', 'notes',
    // team page
    'teamPage', 'teamHistory', 'teamSkills'
];

// Optional features (default: off).
export const FEATURE_KEYS = [
    'assignments', 'rubric', 'individual', 'scoreCap', 'appeals', 'divisions', 'bracket', 'roles',
    'budget', 'decisions', 'secretCards', 'peerReview', 'chanceCards', 'calibration', 'registration'
];

export const DISPLAY_PRESETS = {
    full: {},
    formal: { confetti: false, moodImages: false, sound: false, splash: true, badges: false }
};

export const DEFAULT_SKILLS = [
    { id: 'leadership', name: 'رهبری' },
    { id: 'communication', name: 'ارتباط' },
    { id: 'decision', name: 'تصمیم‌گیری' },
    { id: 'teamwork', name: 'کار تیمی' },
    { id: 'creativity', name: 'خلاقیت' },
    { id: 'discipline', name: 'نظم و مدیریت زمان' }
];

// Default link between the built-in tags and skills (only used when a camp has no mapping yet).
export const DEFAULT_TAG_SKILLS = {
    'نظم': ['discipline'], 'خلاقیت': ['creativity'], 'کار تیمی': ['teamwork'], 'اخلاق ورزشی': ['teamwork'],
    'بی‌نظمی': ['discipline'], 'تاخیر': ['discipline'], 'نقض قوانین': ['discipline'], 'رفتار نامناسب': ['teamwork'],
    'ابتکار عمل': ['leadership'], 'هدایت تیم': ['leadership'], 'گوش دادن فعال': ['communication'],
    'ارتباط مؤثر': ['communication'], 'تصمیم سریع و درست': ['decision'], 'تحلیل داده': ['decision'],
    'تقسیم کار': ['teamwork'], 'حمایت از هم‌تیمی': ['teamwork'], 'ایده نو': ['creativity'],
    'بی‌توجهی به هم‌تیمی': ['communication'], 'تصمیم شتاب‌زده': ['decision'], 'کار تک‌نفره': ['teamwork']
};

// Tag packs offered in the setup form (added to the camp's tags).
export const TAG_PACKS = {
    sport: { name: 'ورزشی', positive: ['نظم', 'خلاقیت', 'کار تیمی', 'اخلاق ورزشی'], negative: ['بی‌نظمی', 'تاخیر', 'نقض قوانین', 'رفتار نامناسب'] },
    team: {
        name: 'مهارت‌های تیمی',
        positive: ['ابتکار عمل', 'هدایت تیم', 'گوش دادن فعال', 'ارتباط مؤثر', 'تصمیم سریع و درست', 'تحلیل داده', 'تقسیم کار', 'حمایت از هم‌تیمی', 'ایده نو'],
        negative: ['بی‌توجهی به هم‌تیمی', 'تصمیم شتاب‌زده', 'کار تک‌نفره', 'تاخیر']
    }
};

export const LIMITS = {
    moments: 300, appeals: 200, budgetNote: 200, registrations: 200, text: 300, members: 30, cards: 50,
    rounds: 50, options: 8, criteria: 12, calibrationCases: 30, channels: 5
};

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bool = v => v === true || v === 1 || v === '1' || v === 'true';
const newId = prefix => prefix + '_' + crypto.randomBytes(5).toString('hex');
const idOr = (v, prefix) => (isValidId(v) ? v : newId(prefix));

export function effectiveDisplay(d) {
    const out = {};
    for (const k of DISPLAY_KEYS) out[k] = !(isPlainObject(d) && d[k] === false);
    return out;
}

export function effectiveFeatures(f) {
    const out = {};
    for (const k of FEATURE_KEYS) out[k] = !!(isPlainObject(f) && f[k] === true);
    return out;
}

// Only known keys; the stored object keeps just the switches that differ from the default.
export function cleanDisplay(d) {
    const out = {};
    if (isPlainObject(d)) for (const k of DISPLAY_KEYS) if (k in d && !bool(d[k])) out[k] = false;
    return out;
}

export function cleanFeatures(f) {
    const out = {};
    if (isPlainObject(f)) for (const k of FEATURE_KEYS) if (k in f && bool(f[k])) out[k] = true;
    return out;
}

export function cleanSkills(list) {
    if (!Array.isArray(list)) return DEFAULT_SKILLS.map(s => ({ ...s }));
    const seen = new Set();
    return list.slice(0, 20).map(s => ({ id: idOr(s && s.id, 'sk'), name: str(s && s.name, 60) }))
        .filter(s => s.name && !seen.has(s.id) && seen.add(s.id));
}

export function cleanTagSkills(map, skills) {
    const ids = new Set((skills || []).map(s => s.id));
    const out = {};
    if (!isPlainObject(map)) return out;
    for (const [tag, list] of Object.entries(map).slice(0, 200)) {
        const t = str(tag, 100);
        if (!t || ['__proto__', 'constructor', 'prototype'].includes(t) || !Array.isArray(list)) continue;
        const v = list.filter(x => ids.has(x)).slice(0, 5);
        if (v.length) out[t] = v;
    }
    return out;
}

export function cleanNamedList(list, prefix, max = 30) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, max).map(x => ({ id: idOr(x && x.id, prefix), name: str(x && x.name, 80) })).filter(x => x.name);
}

export function cleanRoles(list) {
    if (!Array.isArray(list)) return ['کاپیتان'];
    return list.map(x => str(x, 40)).filter(Boolean).slice(0, 15);
}

export function cleanMembers(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list.slice(0, LIMITS.members).map(m => ({ id: idOr(m && m.id, 'm'), name: str(m && m.name, 80), role: str(m && m.role, 40) }))
        .filter(m => m.name && !seen.has(m.id) && seen.add(m.id));
}

export function cleanSecretCards(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 20).map(c => ({ id: idOr(c && c.id, 'sc'), title: str(c && c.title, 80), text: str(c && c.text, 1000) })).filter(c => c.title || c.text);
}

export function cleanCriteria(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, LIMITS.criteria).map(c => {
        const w = parseFloat(c && c.weight);
        return { id: idOr(c && c.id, 'cr'), name: str(c && c.name, 60), weight: Number.isFinite(w) && w > 0 && w <= 100 ? round2(w) : 1 };
    }).filter(c => c.name);
}

export function cleanAssignments(map, teamIds, stageIds) {
    const out = {};
    if (!isPlainObject(map)) return out;
    for (const [user, a] of Object.entries(map).slice(0, 200)) {
        if (!str(user, 100) || ['__proto__', 'constructor', 'prototype'].includes(user) || !isPlainObject(a)) continue;
        const teams = Array.isArray(a.teams) ? a.teams.filter(t => teamIds.has(t)) : [];
        const stages = Array.isArray(a.stages) ? a.stages.filter(s => stageIds.has(s)) : [];
        if (teams.length || stages.length) out[user] = { teams, stages };
    }
    return out;
}

export function cleanScoreCap(c) {
    const per = parseFloat(isPlainObject(c) ? c.perHour : NaN);
    return { perHour: Number.isFinite(per) && per > 0 ? round2(per) : null };
}

export function cleanChanceCards(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, LIMITS.cards).map(c => ({
        id: idOr(c && c.id, 'cc'), title: str(c && c.title, 80), text: str(c && c.text, 500),
        points: round2(num(c && c.points)), budget: round2(num(c && c.budget))
    })).filter(c => c.title);
}

export function cleanRounds(list, prev = []) {
    if (!Array.isArray(list)) return [];
    const old = new Map((prev || []).map(r => [r.id, r]));
    return list.slice(0, LIMITS.rounds).map(r => {
        const before = old.get(r && r.id) || {};
        return {
            id: idOr(r && r.id, 'rd'), title: str(r && r.title, 100), question: str(r && r.question, 500),
            options: (Array.isArray(r && r.options) ? r.options : []).slice(0, LIMITS.options).map(o => ({
                id: idOr(o && o.id, 'op'), label: str(o && o.label, 120), points: round2(num(o && o.points)), budget: round2(num(o && o.budget))
            })).filter(o => o.label),
            // Status changes only through the round actions.
            status: ['draft', 'open', 'closed'].includes(before.status) ? before.status : 'draft',
            revealed: !!before.revealed
        };
    }).filter(r => r.title && r.options.length >= 2);
}

export function cleanCalibrationCases(list, prev = []) {
    if (!Array.isArray(list)) return [];
    const old = new Map((prev || []).map(c => [c.id, c]));
    return list.slice(0, LIMITS.calibrationCases).map(c => ({
        id: idOr(c && c.id, 'cal'), title: str(c && c.title, 100), description: str(c && c.description, 2000),
        media: str(c && c.media, 2_000_000), open: c && 'open' in c ? bool(c.open) : !!(old.get(c && c.id) || {}).open,
        expected: c && c.expected !== undefined && c.expected !== '' && Number.isFinite(parseFloat(c.expected)) ? round2(parseFloat(c.expected)) : null
    })).filter(c => c.title);
}

export function cleanBrand(b) {
    if (!isPlainObject(b)) return {};
    const accent = str(b.accent, 20);
    return {
        clientLogo: str(b.clientLogo, 2_000_000),
        accent: /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : '',
        background: str(b.background, 2_000_000),
        sponsor: str(b.sponsor, 120)
    };
}

const CHANNEL_TYPES = ['telegram', 'bale', 'eitaa', 'webhook'];
// Notification channels. An empty token keeps the stored one (the form never receives secrets).
export function cleanNotify(n, prev) {
    const old = new Map(((prev && prev.channels) || []).map(c => [c.id, c]));
    const channels = (isPlainObject(n) && Array.isArray(n.channels) ? n.channels : []).slice(0, LIMITS.channels).map(c => {
        const before = old.get(c && c.id) || {};
        const type = CHANNEL_TYPES.includes(c && c.type) ? c.type : 'webhook';
        const url = str(c && c.url, 500);
        return {
            id: idOr(c && c.id, 'ch'), type,
            token: str(c && c.token, 200) || (before.type === type ? before.token || '' : ''),
            chatId: str(c && c.chatId, 100),
            url: /^https?:\/\//i.test(url) ? url : ''
        };
    }).filter(c => (c.type === 'webhook' ? c.url : c.token && c.chatId));
    const ev = isPlainObject(n) && isPlainObject(n.events) ? n.events : {};
    const events = {};
    for (const k of ['stage_close', 'finish', 'ceremony', 'chance', 'round']) events[k] = ev[k] === undefined ? true : bool(ev[k]);
    return { channels, events };
}

// What the superadmin form sees of the channels (no tokens).
export function maskNotify(n) {
    if (!isPlainObject(n)) return { channels: [], events: {} };
    return { channels: (n.channels || []).map(c => ({ ...c, token: '', hasToken: !!c.token })), events: n.events || {} };
}

export function cleanSchedule(stage) {
    const t = str(stage && stage.startAt, 5);
    const d = parseInt(stage && stage.durationMin, 10);
    return { startAt: /^([01]?\d|2[0-3]):[0-5]\d$/.test(t) ? t : '', durationMin: Number.isFinite(d) && d > 0 && d <= 1440 ? d : null };
}

export function newPin() {
    return String(crypto.randomInt(100000, 1000000));
}

export function newKey() {
    return crypto.randomBytes(18).toString('base64url');
}

export { newId, str, bool };

// Defaults for the feature fields of a camp (in place; used by parseCamp).
export function parseExtras(c) {
    const obj = (v, d) => (isPlainObject(v) ? v : d);
    const arr = v => (Array.isArray(v) ? v : []);
    c.display = obj(c.display, {});
    c.features = obj(c.features, {});
    c.skills = Array.isArray(c.skills) && c.skills.length ? c.skills : DEFAULT_SKILLS.map(s => ({ ...s }));
    c.tagSkills = obj(c.tagSkills, { ...DEFAULT_TAG_SKILLS });
    for (const k of ['divisions', 'chanceCards', 'rounds', 'appeals', 'moments']) c[k] = arr(c[k]);
    c.roles = Array.isArray(c.roles) ? c.roles : ['کاپیتان'];
    c.assignments = obj(c.assignments, {});
    c.decisions = obj(c.decisions, {});
    c.scoreCap = obj(c.scoreCap, { perHour: null });
    c.peerReview = obj(c.peerReview, { open: null });
    c.calibration = obj(c.calibration, { cases: [], scores: {} });
    c.calibration.cases = arr(c.calibration.cases);
    c.calibration.scores = obj(c.calibration.scores, {});
    c.registration = obj(c.registration, { open: false, requests: [] });
    c.registration.requests = arr(c.registration.requests);
    c.notify = obj(c.notify, { channels: [], events: {} });
    c.brand = obj(c.brand, {});
    for (const k of ['timer', 'ticker', 'judgeMessage', 'ceremony', 'frozen', 'lastChance', 'bracket', 'certificate']) c[k] = obj(c[k], null);
    c.uiLang = c.uiLang === 'en' ? 'en' : 'fa';
    for (const t of c.teams || []) {
        t.members = arr(t.members);
        t.division = typeof t.division === 'string' ? t.division : '';
        t.secretCards = arr(t.secretCards);
    }
    return c;
}

// Teams without a PIN (team page actions) get one.
export function ensurePins(teams) {
    for (const t of teams) if (!/^\d{6}$/.test(String(t.pin || ''))) t.pin = newPin();
    return teams;
}

// Fields a camp template carries (definition and settings, never scores or users).
export const TEMPLATE_KEYS = [
    'campType', 'tieredPointsLadder', 'fieldJudgingMode', 'fieldJudgingValues', 'positiveTags', 'negativeTags', 'stages',
    'display', 'features', 'skills', 'tagSkills', 'divisions', 'roles', 'chanceCards', 'rounds', 'scoreCap', 'brand', 'uiLang', 'numLang', 'dir'
];

export const BUILTIN_TEMPLATES = [
    {
        id: 'builtin_sport', builtin: true, name: 'مسابقه ورزشی (پیش‌فرض)',
        data: { campType: 'simple', positiveTags: TAG_PACKS.sport.positive, negativeTags: TAG_PACKS.sport.negative, features: {} }
    },
    {
        id: 'builtin_team', builtin: true, name: 'شبیه‌سازی تیمی (مهارت‌ها، کاپیتان، بودجه، تصمیم‌گیری)',
        data: {
            campType: 'simple', positiveTags: TAG_PACKS.team.positive, negativeTags: TAG_PACKS.team.negative,
            features: { roles: true, budget: true, decisions: true, peerReview: true, chanceCards: true, appeals: true },
            roles: ['کاپیتان', 'زمان‌نگه‌دار', 'مستندساز', 'سخنگو'],
            chanceCards: [
                { title: 'تغییر قوانین بازی', text: 'از این لحظه هر تیم فقط ۲ دقیقه برای تصمیم دارد.', points: 0, budget: 0 },
                { title: 'بودجه اضطراری', text: 'به همه تیم‌ها بودجه اضافه رسید.', points: 0, budget: 100 }
            ]
        }
    },
    {
        id: 'builtin_assessment', builtin: true, name: 'کانون ارزیابی (چندمعیاره، امتیاز فردی، هماهنگی داوران)',
        data: {
            campType: 'professional', positiveTags: TAG_PACKS.team.positive, negativeTags: TAG_PACKS.team.negative,
            features: { rubric: true, individual: true, calibration: true, assignments: true, peerReview: true, roles: true },
            roles: ['کاپیتان', 'تحلیل‌گر', 'هماهنگ‌کننده']
        }
    }
];

const SKILL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export function templateFromCamp(camp) {
    const data = {};
    for (const k of TEMPLATE_KEYS) if (camp[k] !== undefined) data[k] = camp[k];
    data.teams = (camp.teams || []).map(t => ({ id: t.id, name: t.name, color: t.color, image: t.image || '', members: t.members || [], division: t.division || '' }));
    if (Array.isArray(data.rounds)) data.rounds = data.rounds.map(r => ({ ...r, status: 'draft', revealed: false, applied: false }));
    void SKILL_ID_RE;
    return data;
}

export function cleanLeagues(list, campIds) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 50).map(l => {
        const pts = Array.isArray(l && l.rankPoints) ? l.rankPoints.map(x => parseInt(x, 10)).filter(x => Number.isFinite(x) && x >= 0).slice(0, 50) : [];
        return {
            id: idOr(l && l.id, 'lg'), name: str(l && l.name, 100),
            campIds: (Array.isArray(l && l.campIds) ? l.campIds : []).filter(id => campIds.has(id)).slice(0, 100),
            mode: l && l.mode === 'score' ? 'score' : 'rank',
            rankPoints: pts.length ? pts : [10, 8, 6, 5, 4, 3, 2, 1]
        };
    }).filter(l => l.name);
}
