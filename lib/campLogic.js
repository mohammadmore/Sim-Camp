// Pure scoring / data helpers shared by the Node server (and mirrored in cpanel_export/api.php).
// Everything here is side-effect free so it can be unit-tested without a database.

export const DEFAULT_POSITIVE_TAGS = ['نظم', 'خلاقیت', 'کار تیمی', 'اخلاق ورزشی'];
export const DEFAULT_NEGATIVE_TAGS = ['بی‌نظمی', 'تاخیر', 'نقض قوانین', 'رفتار نامناسب'];
export const DEFAULT_FIELD_JUDGING_VALUES = [5, 10, 15, 20];
export const DEFAULT_LADDER = [500, 400, 300, 200, 100];

// Judge key used when an operator / head referee manually corrects a stage value.
// When present it replaces the judges' values for that team & stage.
export const OVERRIDE_KEY = '__override__';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export function isValidId(id) {
    return typeof id === 'string' && ID_RE.test(id);
}

export function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function parseMaybeJson(v, fallback) {
    if (v === undefined || v === null || v === '') return fallback;
    if (typeof v === 'string') {
        try { return JSON.parse(v); } catch (e) { return fallback; }
    }
    return v;
}

export function isDnfValue(v) {
    return v === '-' || (typeof v === 'string' && v.toLowerCase() === 'dnf');
}

// Numeric value of a score; DNF / garbage counts as 0. Decimals are kept.
export function num(v) {
    if (isDnfValue(v)) return 0;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

export function round2(n) {
    return Math.round(n * 100) / 100;
}

export function parseLadder(l, fallback = DEFAULT_LADDER) {
    if (typeof l === 'string') {
        const s = l.trim();
        if (s.startsWith('[')) l = parseMaybeJson(s, null);
        else l = s.split(',').map(x => parseInt(x.trim(), 10));
    }
    if (!Array.isArray(l)) return [...fallback];
    const clean = l.map(x => parseInt(x, 10)).filter(x => Number.isFinite(x));
    return clean.length > 0 ? clean : [...fallback];
}

export function normalizeTeam(team) {
    if (!Array.isArray(team.scoreLogs)) team.scoreLogs = [];
    if (!isPlainObject(team.stageScores)) team.stageScores = {};
    if (!isPlainObject(team.judgeStageScores)) team.judgeStageScores = {};
    for (const sId of Object.keys(team.judgeStageScores)) {
        if (!isPlainObject(team.judgeStageScores[sId])) team.judgeStageScores[sId] = {};
    }
    // Legacy data: stage scores that were stored as logs are moved back into stageScores.
    if (team.scoreLogs.some(l => l && l.type === 'stage')) {
        const kept = [];
        for (const log of team.scoreLogs) {
            if (log && log.type === 'stage' && log.stageId) {
                team.stageScores[log.stageId] = round2(num(team.stageScores[log.stageId]) + num(log.value));
            } else {
                kept.push(log);
            }
        }
        team.scoreLogs = kept;
    }
    return team;
}

export function recomputeTeamScore(team) {
    let stageSum = 0;
    for (const sId in team.stageScores) stageSum += num(team.stageScores[sId]);
    let logsSum = 0;
    for (const l of team.scoreLogs) {
        if (l && l.type !== 'cancelled') logsSum += num(l.value);
    }
    team.score = round2(stageSum + logsSum);
    return team.score;
}

function entryIsDnf(e) {
    return !!(e && (e.dnf || isDnfValue(e.score)));
}

// Judge entries for a team & stage, ordered by the time they were recorded.
export function judgeEntries(team, stageId) {
    const map = (team.judgeStageScores && team.judgeStageScores[stageId]) || {};
    return Object.keys(map)
        .map(k => (isPlainObject(map[k]) ? { judgeKey: k, ...map[k] } : { judgeKey: k, score: map[k], timestamp: 0 }))
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

// Non-tiered stage value derived from the judges, or undefined when nobody has recorded anything.
export function stageValueFromJudges(team, stageId) {
    const entries = judgeEntries(team, stageId);
    if (entries.length === 0) return undefined;
    const override = entries.find(e => e.judgeKey === OVERRIDE_KEY);
    if (override) return entryIsDnf(override) ? 0 : round2(num(override.score));
    return round2(entries.reduce((sum, e) => sum + (entryIsDnf(e) ? 0 : num(e.score)), 0));
}

// Re-derive team.stageScores[stageId] from the judges (simple / professional mode).
// A stage value entered before any judge existed is only dropped when a judge entry was just removed.
export function applyJudgesToStage(team, stageId, entryRemoved = false) {
    const v = stageValueFromJudges(team, stageId);
    if (v !== undefined) team.stageScores[stageId] = v;
    else if (entryRemoved) delete team.stageScores[stageId];
}

export function stageIsTime(stage) {
    const unit = (stage && stage.unit) || 'points';
    return unit === 'time' || unit === 'time_asc' || unit === 'time_desc';
}

export function stageTimeOrder(stage) {
    const unit = (stage && stage.unit) || 'points';
    return (stage && stage.timeOrder) || (unit === 'time_desc' ? 'desc' : 'asc');
}

// Raw (pre-ladder) result of one team in a tiered stage.
export function tieredRawResult(team, stage) {
    const entries = judgeEntries(team, stage.id);
    const isTime = stageIsTime(stage);
    const override = entries.find(e => e.judgeKey === OVERRIDE_KEY);
    const relevant = override ? [override] : entries;

    if (relevant.length === 0) return { isDnf: isTime, hasRecord: false, rawValue: 0 };
    if (relevant.some(entryIsDnf)) return { isDnf: true, hasRecord: false, rawValue: 0 };

    const numeric = relevant.filter(e => Number.isFinite(parseFloat(e.score)));
    if (numeric.length === 0) return { isDnf: isTime, hasRecord: false, rawValue: 0 };
    if (isTime) {
        // Rule 1: the first referee (by record time) who registered a valid time is authoritative.
        return { isDnf: false, hasRecord: true, rawValue: parseFloat(numeric[0].score) };
    }
    return { isDnf: false, hasRecord: true, rawValue: round2(numeric.reduce((s, e) => s + parseFloat(e.score), 0)) };
}

// Ranks the teams of a tiered stage (dense ranking, DNF = 0 points) and returns the result rows.
export function computeTieredResults(teams, stage, ladder, multiplier) {
    const isTime = stageIsTime(stage);
    const asc = isTime && stageTimeOrder(stage) === 'asc';
    const rows = teams.map(t => {
        const r = tieredRawResult(t, stage);
        return { teamId: t.id, teamName: t.name, teamColor: t.color, ...r, rank: null, assignedScore: 0 };
    });
    const completed = rows.filter(r => !r.isDnf && r.hasRecord);
    const dnf = rows.filter(r => r.isDnf || !r.hasRecord);
    completed.sort((a, b) => (asc ? a.rawValue - b.rawValue : b.rawValue - a.rawValue));

    let denseRank = 0;
    completed.forEach((r, i) => {
        if (i === 0 || r.rawValue !== completed[i - 1].rawValue) denseRank++;
        r.rank = denseRank;
        const base = denseRank - 1 < ladder.length ? (parseInt(ladder[denseRank - 1], 10) || 0) : 0;
        r.baseScore = base;
        r.multiplier = multiplier;
        r.assignedScore = Math.round(base * multiplier);
    });
    dnf.forEach(r => {
        r.rank = '-';
        r.baseScore = 0;
        r.multiplier = multiplier;
        r.assignedScore = 0;
    });
    return [...completed, ...dnf];
}

// Fields of a team that only the scoring endpoints may change.
const SCORE_FIELDS = ['score', 'scoreLogs', 'stageScores', 'judgeStageScores'];

// Merge team definitions coming from a client (settings / setup forms) with the
// authoritative scores on the server, so a stale form never wipes live scores.
export function mergeTeams(serverTeams, clientTeams) {
    const byId = new Map((serverTeams || []).map(t => [t.id, t]));
    return clientTeams.map(ct => {
        const merged = { ...ct };
        const st = byId.get(ct.id);
        for (const f of SCORE_FIELDS) delete merged[f];
        if (st) {
            for (const f of SCORE_FIELDS) if (st[f] !== undefined) merged[f] = st[f];
        }
        normalizeTeam(merged);
        recomputeTeamScore(merged);
        return merged;
    });
}

// Only what is needed to show who did something - never credentials.
export function publicUser(u) {
    if (!u || typeof u !== 'object') return null;
    return {
        id: u.id || '',
        username: u.username || '',
        firstName: u.firstName || '',
        lastName: u.lastName || '',
        role: u.role || 'referee',
        profilePic: u.profilePic || ''
    };
}

export function displayName(u) {
    if (!u) return 'داور';
    const full = `${u.firstName || ''} ${u.lastName || ''}`.trim();
    return full || u.username || 'داور';
}
