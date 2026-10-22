// In-memory camp cache on top of the store (db/index.js).
//
// - Each camp that is in use is kept in memory: reads (poll, live board, login) never touch the
//   database, and the public JSON + ETag are computed once per change instead of once per request.
// - The camp document holds the definition and stage scores; instant scores live in a separate
//   "logs" collection, so a score never rewrites (or grows) the camp document.
// - Images are stored once in the media store and referenced by URL (/media/<hash>.<ext>), so they
//   are no longer part of every poll / live-board update.
// - The store notifies us about changes made by other server instances (watchers), which keeps
//   every instance's cache current; writes use the document revision to detect conflicts.
import crypto from 'crypto';
import { ConflictError } from '../db/errors.js';

export const MEDIA_PREFIX = '/media/';
export const MEDIA_NAME_RE = /^[a-f0-9]{32}\.(png|jpg|gif|webp|svg)$/;
// Media references of both editions (Node: /media/<name>, PHP: media.php?f=<name>).
export const MEDIA_REF_RE = /^(?:\/media\/|media\.php\?f=)([a-f0-9]{32}\.(?:png|jpg|gif|webp|svg))$/;
export const MEDIA_TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
const DATA_URL_RE = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/i;
const EXT_OF = { png: 'png', jpeg: 'jpg', jpg: 'jpg', gif: 'gif', webp: 'webp', 'svg+xml': 'svg' };

export class TooLargeError extends Error {
    constructor() { super('camp document too large'); this.code = 'too_large'; }
}

// JSON with sorted keys, so equal values compare equal whatever order the database returned.
export function stableStringify(v) {
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
}

export function containsDataUrl(v) {
    if (typeof v === 'string') return DATA_URL_RE.test(v);
    if (Array.isArray(v)) return v.some(containsDataUrl);
    if (v && typeof v === 'object') return Object.values(v).some(containsDataUrl);
    return false;
}

// Calls fn for every string in a value and returns a copy with the strings fn returned.
export async function mapStrings(v, fn) {
    if (typeof v === 'string') return fn(v);
    if (Array.isArray(v)) return Promise.all(v.map(x => mapStrings(x, fn)));
    if (v && typeof v === 'object') {
        const out = {};
        for (const [k, x] of Object.entries(v)) out[k] = await mapStrings(x, fn);
        return out;
    }
    return v;
}

export function collectMediaNames(v, into = new Set()) {
    if (typeof v === 'string') { const m = MEDIA_REF_RE.exec(v); if (m) into.add(m[1]); }
    else if (Array.isArray(v)) v.forEach(x => collectMediaNames(x, into));
    else if (v && typeof v === 'object') Object.values(v).forEach(x => collectMediaNames(x, into));
    return into;
}

export function mediaNameFor(buf, ext) {
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32) + '.' + ext;
}

function sortLogs(list) {
    return list.sort((a, b) => ((a.createdAt ?? a.timestamp ?? 0) - (b.createdAt ?? b.timestamp ?? 0)) || String(a.id).localeCompare(String(b.id)));
}

function stripTeam(t) {
    const { scoreLogs, records, score, budget, ...rest } = t;
    return rest;
}

// Everything a team owns in the logs collection: scores (scoreLogs) and other records
// (budget changes, peer feedback; they carry a "kind" and never count as score).
function teamLogs(t) {
    const out = [];
    for (const l of t.scoreLogs || []) if (l && l.id) out.push({ ...l, teamId: t.id });
    for (const r of t.records || []) if (r && r.id && r.kind) out.push({ ...r, teamId: t.id });
    return out;
}

// Legacy documents kept every log inside its team. Give those logs a creation time that keeps
// their original order (a cancelled log's timestamp is the time it was cancelled).
function embeddedLogs(list) {
    const logs = list.filter(l => l && l.id).map(l => ({ ...l }));
    let next = Infinity;
    for (let i = logs.length - 1; i >= 0; i--) {
        const t = logs[i].createdAt ?? logs[i].timestamp ?? 0;
        logs[i].createdAt = Math.min(t, next);
        next = logs[i].createdAt;
    }
    return logs;
}

// Camp in the classic shape: teams carry their scoreLogs.
function assemble(entry) {
    const byTeam = new Map();
    for (const l of entry.logs.values()) {
        if (!byTeam.has(l.teamId)) byTeam.set(l.teamId, []);
        byTeam.get(l.teamId).push(l);
    }
    const teams = (Array.isArray(entry.doc.teams) ? entry.doc.teams : []).map(t => {
        const mine = sortLogs(byTeam.get(t.id) || []).map(({ teamId, ...l }) => l);
        const own = Array.isArray(t.scoreLogs) ? embeddedLogs(t.scoreLogs) : mine.filter(l => !l.kind);
        return { ...t, scoreLogs: own, records: mine.filter(l => l.kind) };
    });
    return { ...entry.doc, id: entry.id, teams };
}


// Camp as stored (scores inside the teams), read straight from the database: for backups.
export async function readCampForBackup(store, id) {
    const d = await store.getCampDoc(id);
    if (!d) return null;
    const logs = await store.getCampLogs(id);
    return assemble({ id, doc: d.doc, logs: new Map(logs.map(l => [l.id, l])) });
}

export function createCampRepo(store, {
    parse,                       // raw camp object -> normalised camp
    publicView,                  // camp -> what the public may see
    maxDocBytes = Infinity,
    idleMs = 10 * 60 * 1000,
    isInUse = () => false,       // id -> true while live boards are connected
    onChange = () => {},         // (id, entry|null) after any change (local or from another instance)
    onInstant = () => {}         // (id, entry, log) for each new instant score
} = {}) {
    const cache = new Map();     // id -> entry
    const loading = new Map();   // id -> Promise<entry|null>
    const missing = new Map();   // id -> time until which "not found" is remembered
    const knownMedia = new Set();

    // ---- media -----------------------------------------------------------
    async function storeDataUrl(s) {
        const m = DATA_URL_RE.exec(s);
        if (!m) return s;
        const ext = EXT_OF[m[1].toLowerCase()];
        const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
        const name = mediaNameFor(buf, ext);
        if (!knownMedia.has(name)) {
            await store.putMedia(name, buf, MEDIA_TYPES[ext]);
            knownMedia.add(name);
        }
        return MEDIA_PREFIX + name;
    }
    // Replaces embedded images (data: URLs) with media URLs; PHP-style media links become Node links.
    const externalize = v => mapStrings(v, s => {
        if (s.startsWith('data:image/')) return storeDataUrl(s);
        const m = MEDIA_REF_RE.exec(s);
        return m ? MEDIA_PREFIX + m[1] : s;
    });

    // ---- entries -----------------------------------------------------------
    function invalidate(entry) {
        entry.camp = null;
        entry.views = {};
    }

    function campOf(entry) {
        if (!entry.camp) entry.camp = parse(structuredClone(assemble(entry)));
        return entry.camp;
    }

    // Prepared JSON (+ ETag) per view: 'public' (live board, anyone) or 'member' (signed-in users).
    function jsonOf(entry, view = 'public') {
        if (!entry.views) entry.views = {};
        if (!entry.views[view]) {
            // Sorted keys: every server instance produces the same text (and ETag) for the same data.
            const json = stableStringify(publicView(campOf(entry), view));
            entry.views[view] = { json, etag: '"' + crypto.createHash('sha1').update(view + json).digest('base64url') + '"' };
        }
        return entry.views[view];
    }

    function applyLogChanges(entry, changes, fromWatcher) {
        const fresh = [];
        for (const { type, log } of changes) {
            if (type === 'removed') { entry.logs.delete(log.id); continue; }
            const isNew = !entry.logs.has(log.id);
            entry.logs.set(log.id, log);
            // Only scores recorded just now (not the initial snapshot of an old camp) trigger a splash.
            if (isNew && log.type === 'instant' && (!fromWatcher || Date.now() - (log.timestamp || 0) < 30000)) fresh.push(log);
        }
        return fresh;
    }

    function changed(entry, freshLogs = []) {
        invalidate(entry);
        onChange(entry.id, entry);
        for (const log of freshLogs) onInstant(entry.id, entry, log);
    }

    function evict(id, notify = false) {
        const entry = cache.get(id);
        cache.delete(id);
        if (entry && entry.unwatch) entry.unwatch();
        if (notify) onChange(id, null);
    }

    function handleWatch(entry, ev) {
        if (!entry.ready) { entry.buffer.push(ev); return; }
        if (ev.kind === 'doc') {
            if (!ev.doc) { evict(entry.id, true); return; }
            if (ev.rev > entry.rev) {
                entry.doc = ev.doc;
                entry.rev = ev.rev;
                changed(entry);
            }
        } else {
            const fresh = applyLogChanges(entry, ev.changes, true);
            if (ev.changes.length) changed(entry, fresh);
        }
    }

    async function loadEntry(id) {
        const entry = { id, doc: null, rev: 0, logs: new Map(), camp: null, views: {}, ready: false, buffer: [], lastUsed: Date.now() };
        entry.unwatch = store.watchCamp(id, {
            onDoc: (doc, rev) => handleWatch(entry, { kind: 'doc', doc, rev }),
            onLogs: changes => handleWatch(entry, { kind: 'logs', changes }),
            onError: () => { if (cache.get(id) === entry) evict(id); } // reloaded (and re-watched) on next use
        });
        try {
            const [d, logs] = await Promise.all([store.getCampDoc(id), store.getCampLogs(id)]);
            if (!d) { entry.unwatch(); return null; }
            entry.doc = d.doc;
            entry.rev = d.rev;
            for (const l of logs) entry.logs.set(l.id, l);
            entry.ready = true;
            for (const ev of entry.buffer.splice(0)) {
                if (ev.kind === 'doc') { if (ev.doc && ev.rev > entry.rev) { entry.doc = ev.doc; entry.rev = ev.rev; } }
                else applyLogChanges(entry, ev.changes, false);
            }
            return entry;
        } catch (e) {
            entry.unwatch();
            throw e;
        }
    }

    // Old documents: logs inside the teams and/or images inside the document.
    function needsMigration(entry) {
        const teams = Array.isArray(entry.doc.teams) ? entry.doc.teams : [];
        return typeof entry.doc.teams === 'string' || teams.some(t => t && (Array.isArray(t.scoreLogs) || 'score' in t)) || containsDataUrl(entry.doc);
    }

    async function migrate(entry) {
        const camp = campOf(entry);
        const changes = { teams: camp.teams };
        for (const k of Object.keys(entry.doc)) if (k !== 'teams' && containsDataUrl(entry.doc[k])) changes[k] = entry.doc[k];
        // String-encoded JSON fields (very old data) are rewritten as real values.
        for (const k of ['stages', 'users', 'closedStages', 'stageTieredResults', 'auditLog']) if (typeof entry.doc[k] === 'string') changes[k] = camp[k];
        await commit(entry, changes, { force: true, silent: true });
        console.log(`[migrate] camp ${entry.id}: moved ${entry.logs.size} scores to the logs collection and images to the media store`);
    }

    async function get(id, { fresh = false } = {}) {
        if (!fresh) {
            const hit = cache.get(id);
            if (hit) { hit.lastUsed = Date.now(); return hit; }
            if ((missing.get(id) || 0) > Date.now()) return null;
        }
        if (loading.has(id)) return loading.get(id);
        const p = (async () => {
            if (fresh) evict(id);
            for (let attempt = 0; ; attempt++) {
                const entry = await loadEntry(id);
                if (!entry) { missing.set(id, Date.now() + 3000); return null; }
                if (needsMigration(entry)) {
                    try { await migrate(entry); } catch (e) {
                        entry.unwatch();
                        if (e instanceof ConflictError && attempt < 3) continue;
                        throw e;
                    }
                }
                missing.delete(id);
                cache.set(id, entry);
                return entry;
            }
        })();
        loading.set(id, p);
        try { return await p; } finally { loading.delete(id); }
    }

    // A private copy of the camp to change, plus the logs it was built from.
    function snapshot(entry) {
        return { camp: structuredClone(campOf(entry)), baseLogs: new Map(entry.logs) };
    }

    // Writes changes made to a copy of the camp. `changes` holds top-level fields; teams may carry
    // scoreLogs, which are diffed against the logs the copy was made from (baseLogs), so a score
    // that another server instance recorded meanwhile is neither deleted nor overwritten.
    // Throws ConflictError when another instance changed the camp document in the meantime.
    async function commit(entry, changes, { force = false, silent = false, baseLogs = entry.logs } = {}) {
        let docChanges = {};
        let logSet = [], logDelete = [];
        for (const [k, v] of Object.entries(changes)) {
            if (v === undefined || k === 'id') continue;
            if (k === 'teams') {
                const next = new Map();
                for (const t of v) for (const l of teamLogs(t)) next.set(l.id, l);
                for (const [lid, l] of next) {
                    const old = baseLogs.get(lid);
                    if (!old || stableStringify(old) !== stableStringify(l)) logSet.push(l);
                }
                for (const lid of baseLogs.keys()) if (!next.has(lid) && entry.logs.has(lid)) logDelete.push(lid);
                docChanges.teams = v.map(stripTeam);
            } else {
                docChanges[k] = v;
            }
        }
        docChanges = await externalize(docChanges);
        logSet = await externalize(logSet);
        if (!force) for (const k of Object.keys(docChanges)) if (stableStringify(docChanges[k]) === stableStringify(entry.doc[k])) delete docChanges[k];
        const hasDoc = Object.keys(docChanges).length > 0;
        if (!hasDoc && !logSet.length && !logDelete.length) return entry;
        if (hasDoc && JSON.stringify({ ...entry.doc, ...docChanges }).length > maxDocBytes) throw new TooLargeError();

        const rev = await store.commit(entry.id, { expectedRev: entry.rev, docChanges: hasDoc ? docChanges : {}, logSet, logDelete });
        if (hasDoc && rev > entry.rev) {
            entry.doc = { ...entry.doc, ...docChanges };
            entry.rev = rev;
        }
        const fresh = applyLogChanges(entry, [...logSet.map(log => ({ type: 'set', log })), ...logDelete.map(id => ({ type: 'removed', log: { id } }))], false);
        if (silent) invalidate(entry); else changed(entry, fresh);
        return entry;
    }

    // New camp (classic shape, teams may carry scoreLogs). Throws ExistsError when the id is taken.
    async function create(id, camp) {
        // Teams are stored in normalised form, so the first score does not rewrite the document.
        const teams = parse(structuredClone({ ...camp, id, teams: camp.teams || [] })).teams;
        const logs = [];
        for (const t of teams) logs.push(...teamLogs(t));
        const { id: _ignored, ...rest } = camp;
        const doc = await externalize({ ...rest, teams: teams.map(stripTeam) });
        if (JSON.stringify(doc).length > maxDocBytes) throw new TooLargeError();
        await store.createCamp(id, doc, await externalize(logs));
        missing.delete(id);
    }

    // Removes the camp and its scores from the database for good.
    async function purge(id) {
        await store.deleteCamp(id);
        evict(id, true);
        missing.delete(id);
    }

    // Idle camps without live boards leave the cache (and stop their watchers).
    setInterval(() => {
        const limit = Date.now() - idleMs;
        for (const [id, entry] of cache) if (entry.lastUsed < limit && !isInUse(id)) evict(id);
        for (const [id, until] of missing) if (until < Date.now()) missing.delete(id);
    }, Math.min(idleMs, 60000)).unref();

    return {
        get, snapshot, commit, create, purge, externalize, campOf, jsonOf,
        evict: id => evict(id),
        forget: id => missing.delete(id),
        size: () => cache.size
    };
}
