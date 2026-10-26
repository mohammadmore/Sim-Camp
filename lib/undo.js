// Undo for audited changes (history in the management panel).
//
// When a change is recorded in the audit log we keep what it replaced: top-level fields, the
// stored part of each changed team, removed/changed scores and the ids of added scores.
// A fingerprint of the state right after the change lets "undo" refuse when something else
// has changed the same data since — nothing is ever silently overwritten.
import crypto from 'crypto';
import { stableStringify } from './campRepo.js';

export const UNDO_MAX_BYTES = 30000; // larger changes (e.g. resetting everything) are not undoable
export const UNDO_KEEP = 30;         // only the newest entries keep their undo data

const TEAM_RUNTIME = ['scoreLogs', 'records', 'score', 'budget'];
const strip = t => { const o = { ...t }; for (const k of TEAM_RUNTIME) delete o[k]; return o; };

function logsOf(teams) {
    const m = new Map();
    for (const t of teams || []) {
        for (const l of t.scoreLogs || []) if (l && l.id) m.set(l.id, { ...l, teamId: t.id });
        for (const r of t.records || []) if (r && r.id) m.set(r.id, { ...r, teamId: t.id });
    }
    return m;
}

function probe(camp, u) {
    const teams = new Map((camp.teams || []).map(t => [t.id, t]));
    const logs = logsOf(camp.teams);
    return crypto.createHash('sha1').update(stableStringify({
        f: Object.keys(u.fields).map(k => [k, camp[k] === undefined ? null : camp[k]]),
        t: Object.keys(u.teams).map(id => [id, teams.has(id) ? strip(teams.get(id)) : null]),
        o: u.order ? (camp.teams || []).map(t => t.id) : null,
        l: [...u.restore.map(l => l.id), ...u.remove].map(id => [id, logs.get(id) || null])
    })).digest('base64url');
}

// before: the camp before the change; changes: the top-level fields that were written.
export function buildUndo(before, changes) {
    const u = { fields: {}, teams: {}, order: null, removedTeams: [], restore: [], remove: [] };
    for (const [k, v] of Object.entries(changes)) {
        if (k === 'teams' || k === 'auditLog' || v === undefined) continue;
        u.fields[k] = before[k] === undefined ? null : before[k];
    }
    if (changes.teams) {
        const prev = new Map(before.teams.map(t => [t.id, t]));
        const next = new Map(changes.teams.map(t => [t.id, t]));
        const beforeIds = before.teams.map(t => t.id);
        if (stableStringify(beforeIds) !== stableStringify(changes.teams.map(t => t.id))) {
            u.order = beforeIds;
            for (const t of before.teams) if (!next.has(t.id)) u.removedTeams.push(strip(t));
        }
        for (const [id, t] of next) {
            const p = prev.get(id);
            if (p && stableStringify(strip(p)) !== stableStringify(strip(t))) u.teams[id] = strip(p);
        }
        const a = logsOf(before.teams), b = logsOf(changes.teams);
        for (const [id, l] of a) if (!b.has(id) || stableStringify(b.get(id)) !== stableStringify(l)) u.restore.push(l);
        for (const id of b.keys()) if (!a.has(id)) u.remove.push(id);
    }
    if (!Object.keys(u.fields).length && !Object.keys(u.teams).length && !u.order && !u.restore.length && !u.remove.length) return null;
    u.check = probe({ ...before, ...changes, teams: changes.teams || before.teams }, u);
    return JSON.stringify(u).length <= UNDO_MAX_BYTES ? u : null;
}

// Changes that restore the state before the audited change, or null when the data has changed since.
export function applyUndo(camp, u) {
    if (probe(camp, u) !== u.check) return null;
    const changes = {};
    for (const [k, v] of Object.entries(u.fields)) changes[k] = v;
    const touchesTeams = u.order || Object.keys(u.teams).length || u.restore.length || u.remove.length;
    if (!touchesTeams) return changes;
    let teams = camp.teams.map(t => ({ ...t, scoreLogs: [...(t.scoreLogs || [])], records: [...(t.records || [])] }));
    if (u.order) {
        const byId = new Map(teams.map(t => [t.id, t]));
        for (const t of u.removedTeams) byId.set(t.id, { ...t, scoreLogs: [], records: [] });
        teams = u.order.map(id => byId.get(id)).filter(Boolean);
    }
    const byId = new Map(teams.map(t => [t.id, t]));
    for (const [id, prev] of Object.entries(u.teams)) {
        const t = byId.get(id);
        if (t) Object.assign(t, prev, { scoreLogs: t.scoreLogs, records: t.records });
    }
    const drop = new Set([...u.remove, ...u.restore.map(l => l.id)]);
    for (const t of teams) {
        t.scoreLogs = t.scoreLogs.filter(l => !drop.has(l.id));
        t.records = t.records.filter(r => !drop.has(r.id));
    }
    for (const { teamId, ...l } of u.restore) {
        const t = byId.get(teamId);
        if (!t) continue;
        (l.kind ? t.records : t.scoreLogs).push(l);
    }
    for (const t of teams) t.scoreLogs.sort((a, b) => ((a.createdAt ?? a.timestamp ?? 0) - (b.createdAt ?? b.timestamp ?? 0)));
    changes.teams = teams;
    return changes;
}
