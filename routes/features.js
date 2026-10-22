// Endpoints of the optional features (operator controls, appeals, chance cards, budgets,
// decision rounds, knockout bracket, peer review, undo, team page, referee calibration,
// online registration and the analysis room). Mirrored in cpanel_export/api.php.
import crypto from 'crypto';
import {
    isPlainObject, isValidId, num, round2, recomputeTeamScore, publicUser, displayName, teamBudget
} from '../lib/campLogic.js';
import {
    LIMITS, cleanDisplay, cleanFeatures, cleanSkills, cleanTagSkills, cleanNamedList, cleanRoles, cleanMembers,
    cleanSecretCards, cleanCriteria, cleanAssignments, cleanScoreCap, cleanChanceCards, cleanRounds,
    cleanCalibrationCases, cleanBrand, cleanSchedule, effectiveFeatures, ensurePins, newPin, str
} from '../lib/features.js';
import { applyUndo } from '../lib/undo.js';
import { createRateLimiter } from '../lib/auth.js';

const rid = prefix => prefix + '_' + crypto.randomBytes(5).toString('hex');
const safeEqual = (a, b) => {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function registerFeatureRoutes(app, ctx) {
    const {
        route, HttpError, requireId, mutateCamp, loadCamp, loadCampOr404, requireCampUser, requireAdmin, assertCampAccess,
        MANAGER_ROLES, clientIp, notify, verifyClientKey
    } = ctx;
    const features = camp => effectiveFeatures(camp.features);
    const need = (camp, key, label) => { if (!features(camp)[key]) throw new HttpError(409, `امکان «${label}» برای این مسابقه فعال نیست.`); };
    const findTeam = (camp, teamId) => {
        const t = camp.teams.find(x => x.id === teamId);
        if (!t) throw new HttpError(404, 'تیم یافت نشد.');
        return t;
    };
    const pushCapped = (list, item, max) => [...list, item].slice(-max);
    const instantLog = (user, value, tag, extra = {}) => {
        const now = Date.now();
        return { id: rid('log'), type: 'instant', value: round2(value), timestamp: now, createdAt: now, user: publicUser(user), tag, ...extra };
    };
    const budgetRecord = (user, value, note, extra = {}) => ({
        id: rid('bud'), kind: 'budget', value: round2(value), note: str(note, LIMITS.budgetNote), createdAt: Date.now(),
        by: user ? publicUser(user).username : '', ...extra
    });

    // -----------------------------------------------------------------------
    // Manager view of the configuration (advanced settings tab)
    // -----------------------------------------------------------------------
    app.get('/api/manage', route(async (req, res) => {
        const camp = await loadCampOr404(requireId(req.query.id, 'شناسه مسابقه'));
        requireCampUser(req, camp, MANAGER_ROLES);
        res.json({
            success: true,
            display: camp.display, features: camp.features, skills: camp.skills, tagSkills: camp.tagSkills,
            divisions: camp.divisions, roles: camp.roles, assignments: camp.assignments, scoreCap: camp.scoreCap,
            chanceCards: camp.chanceCards, rounds: camp.rounds, decisions: camp.decisions, appeals: camp.appeals,
            registration: camp.registration, peerReview: camp.peerReview, bracket: camp.bracket, brand: camp.brand, uiLang: camp.uiLang,
            calibration: { cases: camp.calibration.cases, scores: camp.calibration.scores },
            teams: camp.teams.map(t => ({ id: t.id, name: t.name, color: t.color, pin: t.pin || '', members: t.members, division: t.division, secretCards: t.secretCards })),
            stages: camp.stages.map(s => ({ id: s.id, name: s.name, criteria: s.criteria || [], startAt: s.startAt || '', durationMin: s.durationMin || null })),
            users: camp.users.map(u => ({ username: u.username, name: displayName(u), role: u.role }))
        });
    }));

    // Applies the advanced settings shared by the operator panel and the superadmin form.
    function applyAdvanced(camp, b) {
        const changes = {};
        const teamIds = new Set(camp.teams.map(t => t.id));
        const stageIds = new Set(camp.stages.map(s => s.id));
        if (b.display !== undefined) changes.display = cleanDisplay(b.display);
        if (b.features !== undefined) changes.features = cleanFeatures(b.features);
        if (b.skills !== undefined) changes.skills = cleanSkills(b.skills);
        if (b.tagSkills !== undefined) changes.tagSkills = cleanTagSkills(b.tagSkills, changes.skills || camp.skills);
        if (b.divisions !== undefined) changes.divisions = cleanNamedList(b.divisions, 'dv', 20);
        if (b.roles !== undefined) changes.roles = cleanRoles(b.roles);
        if (b.assignments !== undefined) changes.assignments = cleanAssignments(b.assignments, teamIds, stageIds);
        if (b.scoreCap !== undefined) changes.scoreCap = cleanScoreCap(b.scoreCap);
        if (b.chanceCards !== undefined) changes.chanceCards = cleanChanceCards(b.chanceCards);
        if (b.rounds !== undefined) changes.rounds = cleanRounds(b.rounds, camp.rounds);
        if (b.brand !== undefined) changes.brand = cleanBrand(b.brand);
        if (b.uiLang !== undefined) changes.uiLang = b.uiLang === 'en' ? 'en' : 'fa';
        if (b.calibrationCases !== undefined) changes.calibration = { ...camp.calibration, cases: cleanCalibrationCases(b.calibrationCases, camp.calibration.cases) };
        if (b.registrationOpen !== undefined) changes.registration = { ...camp.registration, open: !!b.registrationOpen };
        if (isPlainObject(b.teamsExtra) || Array.isArray(b.regeneratePins)) {
            const extra = isPlainObject(b.teamsExtra) ? b.teamsExtra : {};
            const regen = new Set(Array.isArray(b.regeneratePins) ? b.regeneratePins : []);
            camp.teams.forEach(t => {
                const e = extra[t.id];
                if (isPlainObject(e)) {
                    if (e.members !== undefined) t.members = cleanMembers(e.members);
                    if (e.division !== undefined) t.division = str(e.division, 64);
                    if (e.secretCards !== undefined) t.secretCards = cleanSecretCards(e.secretCards);
                }
                if (regen.has(t.id)) t.pin = newPin();
            });
            changes.teams = ensurePins(camp.teams);
        }
        if (isPlainObject(b.stagesExtra)) {
            camp.stages.forEach(s => {
                const e = b.stagesExtra[s.id];
                if (!isPlainObject(e)) return;
                if (e.criteria !== undefined) s.criteria = cleanCriteria(e.criteria);
                if (e.startAt !== undefined || e.durationMin !== undefined) Object.assign(s, cleanSchedule({ startAt: e.startAt ?? s.startAt, durationMin: e.durationMin ?? s.durationMin }));
            });
            changes.stages = camp.stages;
        }
        return changes;
    }
    ctx.applyAdvanced = applyAdvanced;

    app.post('/api/advanced', route(async (req, res) => {
        const id = requireId(req.query.id, 'شناسه مسابقه');
        const b = req.body || {};
        await mutateCamp(id, { allowLocked: true }, camp => {
            const user = requireCampUser(req, camp, MANAGER_ROLES);
            const changes = applyAdvanced(camp, b);
            return { changes, audit: { user, action: 'advanced', details: { keys: Object.keys(changes) } } };
        });
        res.json({ success: true });
    }));

    // -----------------------------------------------------------------------
    // Live controls: timer, news ticker, message to referees, hidden table, key moments, award ceremony
    // -----------------------------------------------------------------------
    app.post('/api/live', route(async (req, res) => {
        const id = requireId(req.query.id, 'شناسه مسابقه');
        const b = req.body || {};
        const { camp, payload, notice } = await mutateCamp(id, { allowLocked: true }, camp => {
            const user = requireCampUser(req, camp, MANAGER_ROLES);
            const now = Date.now();
            switch (b.action) {
                case 'timer': {
                    const t = camp.timer;
                    let timer = t;
                    if (b.op === 'start') {
                        const minutes = parseFloat(b.minutes);
                        if (!(minutes > 0 && minutes <= 1440)) throw new HttpError(400, 'مدت زمان نامعتبر است.');
                        const durationMs = Math.round(minutes * 60000);
                        timer = { label: str(b.label, 80), durationMs, endsAt: now + durationMs, remainingMs: null, running: true, startedAt: now };
                    } else if (b.op === 'pause' && t && t.running) timer = { ...t, running: false, remainingMs: Math.max(0, t.endsAt - now), endsAt: null };
                    else if (b.op === 'resume' && t && !t.running) timer = { ...t, running: true, endsAt: now + (t.remainingMs || 0), remainingMs: null };
                    else if (b.op === 'add' && t) {
                        const ms = Math.round(parseFloat(b.minutes) * 60000) || 0;
                        timer = t.running ? { ...t, endsAt: Math.max(now, t.endsAt + ms) } : { ...t, remainingMs: Math.max(0, (t.remainingMs || 0) + ms) };
                    } else if (b.op === 'stop') timer = null;
                    else throw new HttpError(400, 'عملیات تایمر نامعتبر است.');
                    return { changes: { timer }, payload: { timer } };
                }
                case 'ticker': {
                    const text = str(b.text, LIMITS.text);
                    const ticker = text ? { text, at: now } : null;
                    return { changes: { ticker }, payload: { ticker } };
                }
                case 'message': {
                    const text = str(b.text, LIMITS.text);
                    const judgeMessage = text ? { text, at: now, by: displayName(user) } : null;
                    return { changes: { judgeMessage }, payload: { judgeMessage } };
                }
                case 'freeze': {
                    if (!b.on) return { changes: { frozen: null }, payload: { frozen: null }, audit: { user, action: 'unfreeze', details: {} } };
                    if (camp.frozen) return { payload: { frozen: { at: camp.frozen.at } } };
                    const frozen = {
                        at: now,
                        teams: camp.teams.map(t => ({ id: t.id, score: t.score, stageScores: t.stageScores })),
                        closedStages: camp.closedStages, stageTieredResults: camp.stageTieredResults
                    };
                    return { changes: { frozen }, payload: { frozen: { at: now } }, audit: { user, action: 'freeze', details: {} } };
                }
                case 'moment': {
                    const teamId = b.teamId && camp.teams.some(t => t.id === b.teamId) ? b.teamId : null;
                    const m = { id: rid('mo'), at: now, kind: 'moment', text: str(b.text, LIMITS.text), teamId, stageId: camp.activeStageId || null, by: displayName(user) };
                    return { changes: { moments: pushCapped(camp.moments, m, LIMITS.moments) }, payload: { moment: m } };
                }
                case 'ceremony': {
                    const total = camp.teams.length;
                    const c = camp.ceremony;
                    let ceremony;
                    if (b.op === 'start') ceremony = { active: true, revealed: 0, total, at: now };
                    else if (b.op === 'next' && c) ceremony = { ...c, revealed: Math.min(total, c.revealed + 1), at: now };
                    else if (b.op === 'prev' && c) ceremony = { ...c, revealed: Math.max(0, c.revealed - 1), at: now };
                    else if (b.op === 'all' && c) ceremony = { ...c, revealed: total, at: now };
                    else if (b.op === 'end') ceremony = null;
                    else throw new HttpError(400, 'عملیات مراسم نامعتبر است.');
                    const done = ceremony && ceremony.revealed === total && (!c || c.revealed < total);
                    return {
                        changes: { ceremony }, payload: { ceremony },
                        audit: b.op === 'start' ? { user, action: 'ceremony', details: {} } : undefined,
                        notice: done ? 'ceremony' : null
                    };
                }
                default:
                    throw new HttpError(400, 'عملیات نامعتبر است.');
            }
        });
        if (notice === 'ceremony') notify(camp, 'ceremony');
        res.json({ success: true, ...(payload || {}) });
    }));

    // -----------------------------------------------------------------------
    // Appeals ("VAR"): any signed-in user files, a manager decides
    // -----------------------------------------------------------------------
    app.post('/api/appeal', route(async (req, res) => {
        const id = requireId(req.query.id, 'شناسه مسابقه');
        const b = req.body || {};
        const { appeal } = await mutateCamp(id, { allowLocked: true }, camp => {
            const user = requireCampUser(req, camp);
            need(camp, 'appeals', 'اعتراض و بازبینی');
            const team = findTeam(camp, b.teamId);
            const text = str(b.text, 1000);
            if (!text) throw new HttpError(400, 'متن اعتراض را بنویسید.');
            const appeal = {
                id: rid('ap'), at: Date.now(), by: { username: user.username, name: displayName(user), role: user.role },
                teamId: team.id, stageId: camp.stages.some(s => s.id === b.stageId) ? b.stageId : null,
                logId: isValidId(b.logId) ? b.logId : null, text, status: 'open'
            };
            if (camp.appeals.filter(a => a.status === 'open').length >= 50) throw new HttpError(429, 'تعداد اعتراض‌های باز زیاد است.');
            return { appeal, changes: { appeals: pushCapped(camp.appeals, appeal, LIMITS.appeals) } };
        });
        res.json({ success: true, appeal });
    }));

    app.post('/api/appeal/resolve', route(async (req, res) => {
        const id = requireId(req.query.id, 'شناسه مسابقه');
        const b = req.body || {};
        await mutateCamp(id, { allowLocked: true }, camp => {
            const user = requireCampUser(req, camp, MANAGER_ROLES);
            const a = camp.appeals.find(x => x.id === b.appealId);
            if (!a) throw new HttpError(404, 'اعتراض یافت نشد.');
            if (!['accepted', 'rejected', 'open'].includes(b.status)) throw new HttpError(400, 'وضعیت نامعتبر است.');
            Object.assign(a, { status: b.status, resolution: str(b.resolution, 1000), resolvedAt: Date.now(), resolvedBy: displayName(user) });
            const team = camp.teams.find(t => t.id === a.teamId);
            return { changes: { appeals: camp.appeals }, audit: { user, action: 'appeal', details: { team: team ? team.name : '', status: b.status } } };
        });
        res.json({ success: true });
    }));

    // -----------------------------------------------------------------------
    // Chance cards: a surprise event shown on the board, optionally with points / budget
    // -----------------------------------------------------------------------
    app.post('/api/chance', route(async (req, res) => {
        const id = requireId(req.query.id, 'شناسه مسابقه');
        const b = req.body || {};
        const { camp, card } = await mutateCamp(id, {}, camp => {
            const user = requireCampUser(req, camp, MANAGER_ROLES);
            need(camp, 'chanceCards', 'کارت شانس');
            const card = camp.chanceCards.find(c => c.id === b.cardId);
            if (!card) throw new HttpError(404, 'کارت یافت نشد.');
            const ids = Array.isArray(b.teamIds) && b.teamIds.length ? b.teamIds.filter(t => camp.teams.some(x => x.id === t)) : camp.teams.map(t => t.id);
            const now = Date.now();
            for (const t of camp.teams) {
                if (!ids.includes(t.id)) continue;
                if (card.points) { t.scoreLogs.push(instantLog(user, card.points, 'کارت شانس: ' + card.title, { chance: card.id })); recomputeTeamScore(t); }
                if (card.budget) t.records.push(budgetRecord(user, card.budget, 'کارت شانس: ' + card.title, { chance: card.id }));
            }
            const lastChance = { id: rid('ch'), cardId: card.id, title: card.title, text: card.text, points: card.points, budget: card.budget, teamIds: ids, at: now };
            const moment = { id: rid('mo'), at: now, kind: 'chance', text: card.title, teamId: ids.length === 1 ? ids[0] : null, stageId: camp.activeStageId || null, by: displayName(user) };
            return {
                card,
                changes: { teams: camp.teams, lastChance, moments: pushCapped(camp.moments, moment, LIMITS.moments) },
                audit: { user, action: 'chance', details: { card: card.title, teams: camp.teams.filter(t => ids.includes(t.id)).map(t => t.name) } }
            };
        });
        notify(camp, 'chance', card.title + (card.text ? ' — ' + card.text : ''));
        res.json({ success: true });
    }));

    // -----------------------------------------------------------------------
    // Team budgets (records of kind "budget"; never part of the score)
    // -----------------------------------------------------------------------
    app.post('/api/budget', route(async (req, res) => {
        const id = requireId(req.query.id, 'شناسه مسابقه');
        const b = req.body || {};
        const { camp } = await mutateCamp(id, {}, camp => {
            const user = requireCampUser(req, camp, MANAGER_ROLES);
            need(camp, 'budget', 'بودجه تیم‌ها');
            if (b.from || b.to) {
                const from = findTeam(camp, b.from), to = findTeam(camp, b.to);
                const amount = round2(num(b.amount));
                if (!(amount > 0) || from.id === to.id) throw new HttpError(400, 'مبلغ یا تیم‌ها نامعتبر است.');
                const note = str(b.note, LIMITS.budgetNote) || `انتقال ${from.name} ← ${to.name}`;
                const transfer = rid('tr');
                from.records.push(budgetRecord(user, -amount, note, { transfer }));
                to.records.push(budgetRecord(user, amount, note, { transfer }));
                return { changes: { teams: camp.teams }, audit: { user, action: 'budget', details: { team: `${from.name} ← ${to.name}`, amount } } };
            }
            const team = findTeam(camp, b.teamId);
            const delta = round2(num(b.delta));
            if (!delta || Math.abs(delta) > 1e9) throw new HttpError(400, 'مبلغ نامعتبر است.');
            team.records.push(budgetRecord(user, delta, b.note));
            return { changes: { teams: camp.teams }, audit: { user, action: 'budget', details: { team: team.name, amount: delta } } };
        });
        res.json({ success: true, budgets: Object.fromEntries(camp.teams.map(t => [t.id, teamBudget(t)])) });
    }));

    // -----------------------------------------------------------------------
    // Decision rounds ("choose your tactic"): teams decide on their team page
    // -----------------------------------------------------------------------
    app.post('/api/rounds', route(async (req, res) => {
        const id = requireId(req.query.id, 'شناسه مسابقه');
        const b = req.body || {};
        const { camp, revealed } = await mutateCamp(id, { allowLocked: b.op === 'reveal' || b.op === 'hide' }, camp => {
            const user = requireCampUser(req, camp, MANAGER_ROLES);
            need(camp, 'decisions', 'دور تصمیم‌گیری');
            const r = camp.rounds.find(x => x.id === b.roundId);
            if (!r) throw new HttpError(404, 'دور یافت نشد.');
            const changes = { rounds: camp.rounds };
            const decisions = { ...camp.decisions };
            if (b.op === 'open') r.status = 'open';
            else if (b.op === 'close') {
                if (r.status !== 'closed' && !r.applied) {
                    // Each team's choice takes effect once, when the round closes.
                    for (const t of camp.teams) {
                        const d = (decisions[r.id] || {})[t.id];
                        const o = d && r.options.find(x => x.id === d.optionId);
                        if (!o) continue;
                        if (o.points) { t.scoreLogs.push(instantLog(user, o.points, `تصمیم «${r.title}»: ${o.label}`, { round: r.id })); recomputeTeamScore(t); }
                        if (o.budget) t.records.push(budgetRecord(user, o.budget, `تصمیم «${r.title}»: ${o.label}`, { round: r.id }));
                    }
                    r.applied = true;
                    changes.teams = camp.teams;
                }
                r.status = 'closed';
            } else if (b.op === 'reveal') r.revealed = true;
            else if (b.op === 'hide') r.revealed = false;
            else if (b.op === 'reset') {
                delete decisions[r.id];
                Object.assign(r, { status: 'draft', revealed: false, applied: false });
                changes.decisions = decisions;
            } else throw new HttpError(400, 'عملیات نامعتبر است.');
            return { changes, revealed: b.op === 'reveal' ? r : null, audit: { user, action: 'round', details: { round: r.title, op: b.op } } };
        });
        if (revealed) {
            const counts = {};
            for (const d of Object.values(camp.decisions[revealed.id] || {})) counts[d.optionId] = (counts[d.optionId] || 0) + 1;
            notify(camp, 'round', `${revealed.title}: ` + revealed.options.map(o => `${o.label} (${counts[o.id] || 0})`).join('، '));
        }
        res.json({ success: true });
    }));

    // -----------------------------------------------------------------------
    // Knockout bracket
    // -----------------------------------------------------------------------
    app.post('/api/bracket', route(async (req, res) => {
        const id = requireId(req.query.id, 'شناسه مسابقه');
        const b = req.body || {};
        const { bracket } = await mutateCamp(id, { allowLocked: true }, camp => {
            const user = requireCampUser(req, camp, MANAGER_ROLES);
            need(camp, 'bracket', 'جدول حذفی');
            let bracket = camp.bracket ? structuredClone(camp.bracket) : null;
            if (b.op === 'generate') {
                let seeds = Array.isArray(b.teamIds) && b.teamIds.length
                    ? b.teamIds.filter(t => camp.teams.some(x => x.id === t))
                    : [...camp.teams].sort((x, y) => y.score - x.score).map(t => t.id);
                const size = [2, 4, 8, 16, 32].find(n => n >= Math.min(seeds.length, parseInt(b.size, 10) || seeds.length)) || 2;
                seeds = seeds.slice(0, size);
                if (seeds.length < 2) throw new HttpError(400, 'برای جدول حذفی دست‌کم دو تیم لازم است.');
                // Standard seeding: 1 v N, 2 v N-1, ... (missing teams are byes).
                const order = [1];
                while (order.length < size) { const n = order.length * 2 + 1; order.splice(0, order.length, ...order.flatMap(x => [x, n - x])); }
                const rounds = [];
                const first = [];
                for (let i = 0; i < size; i += 2) {
                    const a = seeds[order[i] - 1] || null, c = seeds[order[i + 1] - 1] || null;
                    first.push({ id: rid('m'), a, b: c, winner: a && !c ? a : (!a && c ? c : null) });
                }
                // Firestore cannot store arrays inside arrays: each round is an object with its matches.
                rounds.push({ matches: first });
                for (let n = size / 4; n >= 1; n /= 2) rounds.push({ matches: Array.from({ length: n }, () => ({ id: rid('m'), a: null, b: null, winner: null })) });
                bracket = { title: str(b.title, 80) || 'جدول حذفی', rounds };
                propagate(bracket);
            } else if (b.op === 'winner') {
                if (!bracket) throw new HttpError(404, 'جدول حذفی ساخته نشده است.');
                const m = bracket.rounds.flatMap(r => r.matches).find(x => x.id === b.matchId);
                if (!m) throw new HttpError(404, 'بازی یافت نشد.');
                if (b.teamId !== null && b.teamId !== m.a && b.teamId !== m.b) throw new HttpError(400, 'این تیم در این بازی نیست.');
                m.winner = b.teamId || null;
                propagate(bracket);
            } else if (b.op === 'clear') bracket = null;
            else throw new HttpError(400, 'عملیات نامعتبر است.');
            return { bracket, changes: { bracket }, audit: b.op === 'winner' ? undefined : { user, action: 'bracket', details: { op: b.op } } };
        });
        res.json({ success: true, bracket });
    }));

    // Winners move to the next round; a changed result clears what depended on it.
    function propagate(bracket) {
        for (let r = 0; r < bracket.rounds.length - 1; r++) {
            bracket.rounds[r].matches.forEach((m, i) => {
                const next = bracket.rounds[r + 1].matches[Math.floor(i / 2)];
                const slot = i % 2 === 0 ? 'a' : 'b';
                if (next[slot] !== m.winner) {
                    next[slot] = m.winner;
                    if (next.winner && next.winner !== next.a && next.winner !== next.b) next.winner = null;
                }
            });
        }
    }

    // -----------------------------------------------------------------------
    // Peer review / self-assessment window (answered on the team page)
    // -----------------------------------------------------------------------
    app.post('/api/peer', route(async (req, res) => {
        const id = requireId(req.query.id, 'شناسه مسابقه');
        const b = req.body || {};
        await mutateCamp(id, { allowLocked: true }, camp => {
            const user = requireCampUser(req, camp, MANAGER_ROLES);
            need(camp, 'peerReview', 'ارزیابی هم‌تیمی');
            const open = b.open === null || b.open === '' || b.open === undefined ? null
                : (b.open === 'general' || camp.stages.some(s => s.id === b.open) ? b.open : null);
            return { changes: { peerReview: { open, at: Date.now() } }, audit: { user, action: 'peer', details: { open } } };
        });
        res.json({ success: true });
    }));

    // -----------------------------------------------------------------------
    // Undo from the history
    // -----------------------------------------------------------------------
    app.post('/api/undo', route(async (req, res) => {
        const id = requireId(req.query.id, 'شناسه مسابقه');
        const auditId = (req.body || {}).auditId;
        await mutateCamp(id, { allowLocked: true }, camp => {
            const user = requireCampUser(req, camp, MANAGER_ROLES);
            const e = camp.auditLog.find(x => x.id === auditId);
            if (!e || !e.undo || e.undone) throw new HttpError(404, 'این تغییر قابل برگرداندن نیست.');
            const changes = applyUndo(camp, e.undo);
            if (!changes) throw new HttpError(409, 'پس از این تغییر، تغییرات دیگری روی همین بخش ثبت شده است؛ برگرداندن آن ممکن نیست.');
            if (changes.teams) changes.teams.forEach(recomputeTeamScore);
            e.undone = true;
            return { changes: { ...changes, auditLog: camp.auditLog }, noUndo: true, audit: { user, action: 'undo', details: { of: e.action } } };
        });
        res.json({ success: true });
    }));

    // -----------------------------------------------------------------------
    // Team page actions (team PIN): decisions, secret cards, peer review
    // -----------------------------------------------------------------------
    const pinLimiter = createRateLimiter({ max: 20, windowMs: 5 * 60 * 1000 });

    function teamAuth(camp, b, ip) {
        const key = `pin:${camp.id}:${ip}`;
        if (!pinLimiter.check(key)) throw new HttpError(429, 'تلاش‌های ناموفق زیاد بود. چند دقیقه دیگر دوباره امتحان کنید.');
        const team = camp.teams.find(t => t.id === b.teamId);
        if (!team || !team.pin || !safeEqual(String(b.pin || ''), team.pin)) throw new HttpError(401, 'کد تیم اشتباه است.');
        pinLimiter.reset(key);
        return team;
    }

    function teamPrivateView(camp, team) {
        const f = features(camp);
        const myFeedback = new Set(team.records.filter(r => r.kind === 'feedback' && r.stageId === (camp.peerReview && camp.peerReview.open)).map(r => r.from));
        return {
            team: { id: team.id, name: team.name, color: team.color, members: team.members, budget: teamBudget(team) },
            secretCards: f.secretCards ? team.secretCards : [],
            rounds: f.decisions ? camp.rounds.filter(r => r.status === 'open').map(r => ({
                id: r.id, title: r.title, question: r.question, options: r.options.map(o => ({ id: o.id, label: o.label })),
                choice: ((camp.decisions[r.id] || {})[team.id] || {}).optionId || null
            })) : [],
            peer: f.peerReview && camp.peerReview.open ? {
                stageId: camp.peerReview.open,
                stageName: (camp.stages.find(s => s.id === camp.peerReview.open) || {}).name || 'کل مسابقه',
                skills: camp.skills, done: [...myFeedback]
            } : null
        };
    }

    app.post('/api/team', route(async (req, res) => {
        const id = requireId(req.query.id, 'شناسه مسابقه');
        const b = req.body || {};
        const ip = clientIp(req);
        if (!b.op || b.op === 'view') {
            const camp = await loadCampOr404(id);
            return res.json({ success: true, ...teamPrivateView(camp, teamAuth(camp, b, ip)) });
        }
        const { view } = await mutateCamp(id, { allowLocked: b.op === 'feedback' }, camp => {
            const team = teamAuth(camp, b, ip);
            if (b.op === 'decide') {
                need(camp, 'decisions', 'دور تصمیم‌گیری');
                const r = camp.rounds.find(x => x.id === b.roundId && x.status === 'open');
                if (!r) throw new HttpError(409, 'این دور تصمیم‌گیری باز نیست.');
                if (!r.options.some(o => o.id === b.optionId)) throw new HttpError(400, 'گزینه نامعتبر است.');
                const decisions = { ...camp.decisions, [r.id]: { ...(camp.decisions[r.id] || {}), [team.id]: { optionId: b.optionId, at: Date.now() } } };
                camp.decisions = decisions;
                return { changes: { decisions }, view: teamPrivateView(camp, team) };
            }
            if (b.op === 'feedback') {
                need(camp, 'peerReview', 'ارزیابی هم‌تیمی');
                const stageId = camp.peerReview.open;
                if (!stageId) throw new HttpError(409, 'ارزیابی هم‌تیمی‌ها الان باز نیست.');
                const members = new Map(team.members.map(m => [m.id, m]));
                if (!members.has(b.from)) throw new HttpError(400, 'نام خودتان را از فهرست انتخاب کنید.');
                const skillIds = new Set(camp.skills.map(s => s.id));
                const ratings = {};
                for (const [mid, map] of Object.entries(isPlainObject(b.ratings) ? b.ratings : {})) {
                    if (!members.has(mid) || !isPlainObject(map)) continue;
                    const r = {};
                    for (const [sk, v] of Object.entries(map)) { const n = parseInt(v, 10); if (skillIds.has(sk) && n >= 1 && n <= 5) r[sk] = n; }
                    if (Object.keys(r).length) ratings[mid] = r;
                }
                if (!Object.keys(ratings).length) throw new HttpError(400, 'دست‌کم به یک نفر امتیاز بدهید.');
                const recId = `fb_${String(stageId).slice(0, 30)}_${b.from}`.slice(0, 64);
                team.records = team.records.filter(r => r.id !== recId);
                team.records.push({ id: recId, kind: 'feedback', stageId, from: b.from, ratings, mvp: members.has(b.mvp) && b.mvp !== b.from ? b.mvp : null, createdAt: Date.now() });
                return { changes: { teams: camp.teams }, view: teamPrivateView(camp, team) };
            }
            throw new HttpError(400, 'عملیات نامعتبر است.');
        });
        res.json({ success: true, ...view });
    }));

    // -----------------------------------------------------------------------
    // Referee calibration workshop
    // -----------------------------------------------------------------------
    app.post('/api/calibration', route(async (req, res) => {
        const id = requireId(req.query.id, 'شناسه مسابقه');
        const b = req.body || {};
        await mutateCamp(id, { allowLocked: true }, camp => {
            const user = requireCampUser(req, camp);
            need(camp, 'calibration', 'کارگاه هماهنگی داوران');
            const c = camp.calibration.cases.find(x => x.id === b.caseId);
            if (!c || !c.open) throw new HttpError(409, 'این نمونه برای نمره‌دادن باز نیست.');
            const v = parseFloat(b.score);
            if (!Number.isFinite(v)) throw new HttpError(400, 'نمره نامعتبر است.');
            const scores = { ...camp.calibration.scores, [c.id]: { ...(camp.calibration.scores[c.id] || {}), [user.username]: round2(v) } };
            return { changes: { calibration: { ...camp.calibration, scores } } };
        });
        res.json({ success: true });
    }));

    // -----------------------------------------------------------------------
    // Online team registration
    // -----------------------------------------------------------------------
    const registerLimiter = createRateLimiter({ max: 5, windowMs: 10 * 60 * 1000 });
    app.post('/api/register', route(async (req, res) => {
        const id = requireId(req.query.id, 'شناسه مسابقه');
        const b = req.body || {};
        if (!registerLimiter.check(`reg:${id}:${clientIp(req)}`)) throw new HttpError(429, 'تعداد ثبت‌نام‌ها از این دستگاه زیاد است. کمی بعد دوباره تلاش کنید.');
        await mutateCamp(id, {}, camp => {
            if (!features(camp).registration || !camp.registration.open) throw new HttpError(409, 'ثبت‌نام این مسابقه باز نیست.');
            const name = str(b.name, 100);
            if (!name) throw new HttpError(400, 'نام تیم را بنویسید.');
            if (camp.registration.requests.length >= LIMITS.registrations) throw new HttpError(409, 'ظرفیت ثبت‌نام پر شده است.');
            const color = /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : '';
            const members = (Array.isArray(b.members) ? b.members : []).map(m => str(m, 80)).filter(Boolean).slice(0, LIMITS.members);
            const request = { id: rid('rq'), at: Date.now(), name, color, members, contact: str(b.contact, 120) };
            return { changes: { registration: { ...camp.registration, requests: [...camp.registration.requests, request] } } };
        });
        res.json({ success: true, message: 'ثبت‌نام شما دریافت شد و پس از تأیید برگزارکننده در فهرست تیم‌ها قرار می‌گیرد.' });
    }));

    app.post('/api/register/review', route(async (req, res) => {
        const id = requireId(req.query.id, 'شناسه مسابقه');
        const b = req.body || {};
        await mutateCamp(id, { allowLocked: true }, camp => {
            const user = requireCampUser(req, camp, MANAGER_ROLES);
            const rq = camp.registration.requests.find(r => r.id === b.requestId);
            if (!rq) throw new HttpError(404, 'درخواست یافت نشد.');
            const registration = { ...camp.registration, requests: camp.registration.requests.filter(r => r.id !== rq.id) };
            if (!b.approve) return { changes: { registration } };
            const palette = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#84cc16'];
            const team = {
                id: rid('t'), name: rq.name, color: rq.color || palette[camp.teams.length % palette.length],
                image: '', happyImage: '', sadImage: '', members: rq.members.map(n => ({ id: rid('m'), name: n, role: '' })),
                division: '', scoreLogs: [], records: [], stageScores: {}, judgeStageScores: {}, secretCards: [], score: 0
            };
            const teams = ensurePins([...camp.teams, team]);
            return { changes: { registration, teams }, audit: { user, action: 'register_approve', details: { team: rq.name } } };
        });
        res.json({ success: true });
    }));

    // -----------------------------------------------------------------------
    // Analysis room data: managers, the superadmin / organizer, or the client report link
    // -----------------------------------------------------------------------
    app.get('/api/analysis', route(async (req, res) => {
        const id = requireId(req.query.id, 'شناسه مسابقه');
        const camp = await loadCampOr404(id);
        let access = null;
        if (req.query.key) { if (verifyClientKey(camp, String(req.query.key))) access = 'client'; }
        else {
            try { requireCampUser(req, camp, MANAGER_ROLES); access = 'manager'; }
            catch (e) { const admin = await requireAdmin(req).catch(() => null); if (admin) { assertCampAccess(admin, camp); access = 'admin'; } }
        }
        if (!access) throw new HttpError(401, 'برای دیدن آنالیز باید وارد شوید یا لینک گزارش معتبر داشته باشید.');
        res.json({ success: true, access, ...analysisData(camp) });
    }));

    function analysisData(camp) {
        const { password, users, auditLog, deletedAt, clientKey, ownerId, notify: _n, registration, ...rest } = camp;
        return {
            ...rest,
            teams: camp.teams.map(({ pin, secretCards, ...t }) => ({
                ...t, budget: teamBudget(t),
                scoreLogs: t.scoreLogs.map(l => (l && l.user ? { ...l, user: publicUser(l.user) } : l))
            })),
            users: camp.users.map(u => ({ username: u.username, name: displayName(u), role: u.role, profilePic: u.profilePic || '' })),
            audit: auditLog.map(({ undo, ...e }) => e)
        };
    }
    ctx.analysisData = analysisData;
}
