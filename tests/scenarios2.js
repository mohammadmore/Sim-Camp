// Scenarios of the optional features, run against both server.js and cpanel_export/api.php.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

export function registerFeatureScenarios(ctx) {
    const call = (...a) => ctx.call(...a);
    let sa, campId, op, head, ref1, ref2, pins;
    let hookServer, hookUrl;
    const hooks = [];

    before(async () => {
        hookServer = http.createServer((req, res) => {
            let body = '';
            req.on('data', d => { body += d; });
            req.on('end', () => { try { hooks.push(JSON.parse(body)); } catch (e) { hooks.push({ raw: body }); } res.end('ok'); });
        });
        await new Promise(r => hookServer.listen(0, '127.0.0.1', r));
        hookUrl = `http://127.0.0.1:${hookServer.address().port}/hook`;
    });
    after(() => hookServer && hookServer.close());

    const login = async (id, username, password) => {
        const r = await call('POST', '/login', { id, username, password });
        assert.equal(r.json.success, true, `login ${username}: ${r.text}`);
        return r.json.token;
    };
    const poll = (token) => call('GET', `/api?action=poll&id=${campId}`, undefined, token);
    const team = (state, id) => state.teams.find(t => t.id === id);
    const waitFor = async (fn, ms = 5000) => {
        const until = Date.now() + ms;
        for (;;) { const v = fn(); if (v) return v; if (Date.now() > until) return null; await new Promise(r => setTimeout(r, 100)); }
    };

    test('features: camp setup with members, criteria and schedule', async () => {
        sa = (await call('POST', '/superadmin/login', { password: ctx.saPassword })).json.token;
        const r = await call('POST', '/setup', {
            orgName: 'Org', title: 'Features', password: 'oppass', campType: 'simple',
            teams: [
                { id: 't_a', name: 'Alpha', color: '#ff0000', members: [{ id: 'm_a1', name: 'Ali', role: 'کاپیتان' }, { id: 'm_a2', name: 'Sara' }] },
                { id: 't_b', name: 'Beta', color: '#00ff00', members: [{ id: 'm_b1', name: 'Reza' }] },
                { id: 't_c', name: 'Gamma', color: '#0000ff' }
            ],
            stages: [{ id: 's_1', name: 'Bridge', unit: 'points', startAt: '10:30', durationMin: 45, criteria: [{ id: 'c_1', name: 'Idea', weight: 2 }, { id: 'c_2', name: 'Build', weight: 1 }] }],
            users: [
                { id: 'u_op', username: 'op', password: 'op1pass', role: 'operator' },
                { id: 'u_h', username: 'head', password: 'head1pass', role: 'head_referee' },
                { id: 'u_r1', username: 'ref1', password: 'ref1pass', role: 'referee' },
                { id: 'u_r2', username: 'ref2', password: 'ref2pass', role: 'referee' }
            ],
            notify: { channels: [{ type: 'webhook', url: hookUrl }] }
        }, sa);
        assert.equal(r.json.success, true, r.text);
        campId = r.json.campId;
        op = await login(campId, 'op', 'op1pass');
        head = await login(campId, 'head', 'head1pass');
        ref1 = await login(campId, 'ref1', 'ref1pass');
        ref2 = await login(campId, 'ref2', 'ref2pass');
        const p = (await poll()).json;
        assert.ok(Object.values(p.display).every(v => v === true), 'every element is shown by default');
        assert.ok(Object.values(p.features).every(v => v === false), 'optional features start switched off');
        assert.deepEqual(team(p, 't_a').members.map(m => m.name), ['Ali', 'Sara']);
        assert.equal(p.stages[0].startAt, '10:30');
        assert.equal(p.stages[0].criteria.length, 2);
        assert.ok(!('pin' in team(p, 't_a')) && !('records' in team(p, 't_a')) && !('notify' in p) && !('clientKey' in p));
        const admin = (await call('GET', `/superadmin/camps/${campId}`, undefined, sa)).json.camp;
        assert.match(admin.teams[0].pin, /^\d{6}$/);
        assert.equal(admin.notify.channels[0].url, hookUrl);
    });

    test('features: advanced settings are for managers only', async () => {
        const body = {
            features: { assignments: true, rubric: true, individual: true, scoreCap: true, appeals: true, chanceCards: true, budget: true, decisions: true, bracket: true, peerReview: true, secretCards: true, roles: true, divisions: true, calibration: true, registration: true },
            display: { confetti: false, sound: false },
            assignments: { ref1: { teams: ['t_a'], stages: [] } },
            scoreCap: { perHour: 20 },
            divisions: [{ id: 'dv_1', name: 'Juniors' }],
            teamsExtra: { t_a: { division: 'dv_1', secretCards: [{ title: 'Secret', text: 'Only for Alpha' }] } },
            chanceCards: [{ id: 'cc_1', title: 'Storm', text: 'Everyone loses time', points: -3, budget: 50 }],
            rounds: [{ id: 'rd_1', title: 'Market', question: 'Invest?', options: [{ id: 'op_y', label: 'Yes', points: 5, budget: -20 }, { id: 'op_n', label: 'No' }] }],
            calibrationCases: [{ id: 'cal_1', title: 'Sample video', description: 'Score this', open: true, expected: 7 }],
            registrationOpen: true
        };
        assert.equal((await call('POST', `/api/advanced?id=${campId}`, body, ref1)).status, 403);
        const r = await call('POST', `/api/advanced?id=${campId}`, body, op);
        assert.equal(r.json.success, true, r.text);
        const m = (await call('GET', `/api/manage?id=${campId}`, undefined, op)).json;
        pins = Object.fromEntries(m.teams.map(t => [t.id, t.pin]));
        assert.ok(Object.values(pins).every(p => /^\d{6}$/.test(p)));
        assert.equal(m.teams.find(t => t.id === 't_a').secretCards[0].text, 'Only for Alpha');
        assert.equal((await call('GET', `/api/manage?id=${campId}`, undefined, ref1)).status, 403);
        const p = (await poll()).json;
        assert.equal(p.display.confetti, false);
        assert.equal(p.display.ticker, true);
        assert.equal(p.features.budget, true);
        assert.equal(team(p, 't_a').division, 'dv_1');
        assert.ok(!JSON.stringify(p).includes('Only for Alpha'), 'secret cards stay secret');
        assert.ok(!('chanceCards' in p), 'chance cards are a surprise');
    });

    test('features: forms that do not know the new fields keep them', async () => {
        const admin = (await call('GET', `/superadmin/camps/${campId}`, undefined, sa)).json.camp;
        // The superadmin form sends teams and stages without members / criteria / schedule.
        const r = await call('POST', '/setup', {
            campId, orgName: admin.orgName, title: admin.title, campType: admin.campType,
            teams: admin.teams.map(t => ({ id: t.id, name: t.name, color: t.color })),
            stages: admin.stages.map(s => ({ id: s.id, name: s.name, unit: s.unit, multiplier: 1 })),
            users: admin.users.map(u => ({ id: u.id, username: u.username, role: u.role, firstName: u.firstName }))
        }, sa);
        assert.equal(r.json.success, true, r.text);
        const p = (await poll()).json;
        assert.equal(p.stages[0].criteria.length, 2);
        assert.equal(p.stages[0].startAt, '10:30');
        assert.deepEqual(team(p, 't_a').members.map(m => m.name), ['Ali', 'Sara']);
        assert.equal(team(p, 't_a').division, 'dv_1');
        const m = (await call('GET', `/api/manage?id=${campId}`, undefined, op)).json;
        assert.equal(m.teams.find(t => t.id === 't_a').pin, pins.t_a, 'PINs survive an edit');
    });

    test('features: certificate design', async () => {
        const r = await call('POST', `/api/advanced?id=${campId}`, { certificate: { heading: 'Certificate', body: '{team} — rank {rank}', signer: 'Dr. X', color: '#123abc', bad: 1 } }, op);
        assert.equal(r.json.success, true, r.text);
        const p = (await poll()).json;
        assert.equal(p.certificate.heading, 'Certificate');
        assert.equal(p.certificate.color, '#123abc');
        assert.ok(!('bad' in p.certificate));
        assert.equal((await call('GET', `/api/manage?id=${campId}`, undefined, op)).json.certificate.signer, 'Dr. X');
    });

    test('features: referees only score the teams assigned to them', async () => {
        assert.equal((await call('POST', `/api/instant?id=${campId}`, { teamId: 't_b', delta: 2 }, ref1)).status, 403);
        assert.equal((await call('POST', `/api/instant?id=${campId}`, { teamId: 't_a', delta: 2 }, ref1)).json.success, true);
        assert.equal((await call('POST', `/api/instant?id=${campId}`, { teamId: 't_b', delta: 2 }, op)).json.success, true, 'managers are not limited');
    });

    test('features: hourly cap on instant points per referee', async () => {
        assert.equal((await call('POST', `/api/instant?id=${campId}`, { teamId: 't_a', delta: 15 }, ref1)).json.success, true);
        const r = await call('POST', `/api/instant?id=${campId}`, { teamId: 't_a', delta: -5 }, ref1);
        assert.equal(r.status, 429);
        assert.match(r.json.message, /سقف/);
    });

    test('features: player, note and photo on an instant score', async () => {
        const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        assert.equal((await call('POST', `/api/instant?id=${campId}`, { teamId: 't_a', delta: 4, memberId: 'm_x' }, ref2)).status, 404);
        const r = await call('POST', `/api/instant?id=${campId}`, { teamId: 't_a', delta: 4, memberId: 'm_a2', note: 'Great pass', photo: PNG }, ref2);
        assert.equal(r.json.success, true, r.text);
        const log = team((await poll()).json, 't_a').scoreLogs.find(l => l.id === r.json.logId);
        assert.equal(log.memberId, 'm_a2');
        assert.equal(log.note, 'Great pass');
        assert.ok(log.photo && !log.photo.startsWith('data:'), 'photo stored as a media file');
    });

    test('features: multi-criteria stage scores', async () => {
        const r = await call('POST', `/api/judge_stage_score?id=${campId}`, { stageId: 's_1', breakdown: { t_a: { c_1: 3, c_2: 4 } }, scores: { t_a: 0 } }, ref2);
        assert.equal(r.json.success, true, r.text);
        const e = team(r.json, 't_a').judgeStageScores.s_1.ref2;
        assert.equal(e.score, 10);
        assert.deepEqual(e.criteria, { c_1: 3, c_2: 4 });
    });

    test('features: live timer, ticker, message to referees and key moments', async () => {
        let r = await call('POST', `/api/live?id=${campId}`, { action: 'timer', op: 'start', minutes: 10, label: 'Bridge' }, head);
        assert.equal(r.json.timer.running, true);
        assert.ok(r.json.timer.endsAt > Date.now() + 9 * 60000);
        r = await call('POST', `/api/live?id=${campId}`, { action: 'timer', op: 'pause' }, head);
        assert.equal(r.json.timer.running, false);
        assert.ok(r.json.timer.remainingMs > 9 * 60000);
        r = await call('POST', `/api/live?id=${campId}`, { action: 'timer', op: 'resume' }, head);
        assert.equal(r.json.timer.running, true);
        assert.equal((await call('POST', `/api/live?id=${campId}`, { action: 'timer', op: 'start', minutes: 5 }, ref1)).status, 403);
        await call('POST', `/api/live?id=${campId}`, { action: 'ticker', text: 'Lunch at 13:00' }, op);
        await call('POST', `/api/live?id=${campId}`, { action: 'message', text: 'Referees: meet at gate 2' }, op);
        await call('POST', `/api/live?id=${campId}`, { action: 'moment', text: 'Alpha saved the bridge', teamId: 't_a' }, op);
        const pub = (await poll()).json;
        assert.equal(pub.ticker.text, 'Lunch at 13:00');
        assert.ok(pub.timer && pub.timer.label === 'Bridge');
        assert.ok(!('judgeMessage' in pub) && !('moments' in pub), 'referee message and moments are not public');
        const mem = (await poll(ref1)).json;
        assert.equal(mem.judgeMessage.text, 'Referees: meet at gate 2');
        assert.deepEqual(mem.assignments.ref1.teams, ['t_a']);
        r = await call('POST', `/api/live?id=${campId}`, { action: 'timer', op: 'stop' }, op);
        assert.equal(r.json.timer, null);
    });

    test('features: hidden table keeps the public standings frozen', async () => {
        const before = team((await poll()).json, 't_b').score;
        await call('POST', `/api/live?id=${campId}`, { action: 'freeze', on: true }, op);
        await call('POST', `/api/instant?id=${campId}`, { teamId: 't_b', delta: 9 }, op);
        const pub = (await poll()).json;
        assert.ok(pub.frozen && pub.frozen.at);
        assert.equal(team(pub, 't_b').score, before, 'public sees the frozen score');
        assert.equal(team((await poll(op)).json, 't_b').score, before + 9, 'managers see the real score');
        await call('POST', `/api/live?id=${campId}`, { action: 'freeze', on: false }, op);
        const after = (await poll()).json;
        assert.equal(after.frozen, null);
        assert.equal(team(after, 't_b').score, before + 9);
    });

    test('features: award ceremony reveals the ranks step by step', async () => {
        let r = await call('POST', `/api/live?id=${campId}`, { action: 'ceremony', op: 'start' }, op);
        assert.deepEqual([r.json.ceremony.active, r.json.ceremony.revealed, r.json.ceremony.total], [true, 0, 3]);
        r = await call('POST', `/api/live?id=${campId}`, { action: 'ceremony', op: 'next' }, op);
        assert.equal(r.json.ceremony.revealed, 1);
        r = await call('POST', `/api/live?id=${campId}`, { action: 'ceremony', op: 'all' }, op);
        assert.equal(r.json.ceremony.revealed, 3);
        assert.equal((await poll()).json.ceremony.revealed, 3);
        r = await call('POST', `/api/live?id=${campId}`, { action: 'ceremony', op: 'end' }, op);
        assert.equal(r.json.ceremony, null);
    });

    test('features: appeals (VAR) filed by referees, decided by managers', async () => {
        const r = await call('POST', `/api/appeal?id=${campId}`, { teamId: 't_b', stageId: 's_1', text: 'Score looks wrong' }, ref2);
        assert.equal(r.json.success, true, r.text);
        assert.equal((await poll()).json.varOpen.length, 1);
        assert.equal((await call('POST', `/api/appeal/resolve?id=${campId}`, { appealId: r.json.appeal.id, status: 'accepted' }, ref2)).status, 403);
        await call('POST', `/api/appeal/resolve?id=${campId}`, { appealId: r.json.appeal.id, status: 'accepted', resolution: 'Fixed' }, head);
        assert.equal((await poll()).json.varOpen.length, 0);
        const m = (await call('GET', `/api/manage?id=${campId}`, undefined, op)).json;
        assert.equal(m.appeals[0].status, 'accepted');
    });

    test('features: chance cards and team budgets', async () => {
        const before = (await poll()).json;
        let r = await call('POST', `/api/chance?id=${campId}`, { cardId: 'cc_1', teamIds: ['t_a', 't_c'] }, op);
        assert.equal(r.json.success, true, r.text);
        let p = (await poll()).json;
        assert.equal(p.lastChance.title, 'Storm');
        assert.equal(team(p, 't_a').score, team(before, 't_a').score - 3);
        assert.equal(team(p, 't_b').score, team(before, 't_b').score);
        assert.equal(team(p, 't_c').budget, 50);
        r = await call('POST', `/api/budget?id=${campId}`, { teamId: 't_b', delta: 120, note: 'Start money' }, op);
        assert.equal(r.json.budgets.t_b, 120);
        r = await call('POST', `/api/budget?id=${campId}`, { from: 't_b', to: 't_c', amount: 20 }, op);
        assert.equal(r.json.budgets.t_b, 100);
        assert.equal(r.json.budgets.t_c, 70);
        p = (await poll()).json;
        assert.equal(team(p, 't_b').budget, 100);
        assert.equal(team(p, 't_b').score, team(before, 't_b').score, 'budget never changes the score');
        assert.equal((await call('POST', `/api/budget?id=${campId}`, { teamId: 't_b', delta: 5 }, ref1)).status, 403);
    });

    test('features: decision rounds from the team page', async () => {
        assert.equal((await call('POST', `/api/team?id=${campId}`, { teamId: 't_a', pin: '000000', op: 'view' })).status, 401);
        let v = (await call('POST', `/api/team?id=${campId}`, { teamId: 't_a', pin: pins.t_a, op: 'view' })).json;
        assert.equal(v.team.name, 'Alpha');
        assert.equal(v.secretCards[0].title, 'Secret');
        assert.equal(v.rounds.length, 0, 'round is not open yet');
        await call('POST', `/api/rounds?id=${campId}`, { roundId: 'rd_1', op: 'open' }, op);
        v = (await call('POST', `/api/team?id=${campId}`, { teamId: 't_a', pin: pins.t_a, op: 'view' })).json;
        assert.equal(v.rounds[0].id, 'rd_1');
        const d = await call('POST', `/api/team?id=${campId}`, { teamId: 't_a', pin: pins.t_a, op: 'decide', roundId: 'rd_1', optionId: 'op_y' });
        assert.equal(d.json.rounds[0].choice, 'op_y');
        await call('POST', `/api/team?id=${campId}`, { teamId: 't_b', pin: pins.t_b, op: 'decide', roundId: 'rd_1', optionId: 'op_n' });
        let p = (await poll()).json;
        assert.equal(p.rounds[0].submitted, 2);
        assert.equal(p.rounds[0].decisions, undefined, 'choices hidden until revealed');
        const scoreA = team(p, 't_a').score, budA = team(p, 't_a').budget;
        await call('POST', `/api/rounds?id=${campId}`, { roundId: 'rd_1', op: 'close' }, op);
        await call('POST', `/api/rounds?id=${campId}`, { roundId: 'rd_1', op: 'close' }, op); // effects apply once
        await call('POST', `/api/rounds?id=${campId}`, { roundId: 'rd_1', op: 'reveal' }, op);
        p = (await poll()).json;
        assert.equal(team(p, 't_a').score, scoreA + 5);
        assert.equal(team(p, 't_a').budget, budA - 20);
        assert.deepEqual(p.rounds[0].decisions, { t_a: 'op_y', t_b: 'op_n' });
        assert.equal((await call('POST', `/api/team?id=${campId}`, { teamId: 't_a', pin: pins.t_a, op: 'decide', roundId: 'rd_1', optionId: 'op_n' })).status, 409);
    });

    test('features: knockout bracket', async () => {
        let r = await call('POST', `/api/bracket?id=${campId}`, { op: 'generate', size: 4, teamIds: ['t_a', 't_b', 't_c'] }, op);
        assert.equal(r.json.success, true, r.text);
        let b = r.json.bracket;
        assert.deepEqual(b.rounds.map(x => x.matches.length), [2, 1]);
        const first = b.rounds[0].matches;
        const bye = first.find(m => !m.b || !m.a);
        assert.ok(bye && bye.winner, 'a missing opponent is a bye');
        const real = first.find(m => m.a && m.b);
        r = await call('POST', `/api/bracket?id=${campId}`, { op: 'winner', matchId: real.id, teamId: real.b }, op);
        b = r.json.bracket;
        const final = b.rounds[1].matches[0];
        assert.ok([final.a, final.b].includes(real.b) && [final.a, final.b].includes(bye.winner));
        r = await call('POST', `/api/bracket?id=${campId}`, { op: 'winner', matchId: final.id, teamId: real.b }, op);
        assert.equal(r.json.bracket.rounds[1].matches[0].winner, real.b);
        // Changing an earlier result clears the final.
        r = await call('POST', `/api/bracket?id=${campId}`, { op: 'winner', matchId: real.id, teamId: real.a }, op);
        assert.equal(r.json.bracket.rounds[1].matches[0].winner, null);
        assert.ok((await poll()).json.bracket.rounds);
    });

    test('features: peer review on the team page', async () => {
        let v = (await call('POST', `/api/team?id=${campId}`, { teamId: 't_a', pin: pins.t_a, op: 'view' })).json;
        assert.equal(v.peer, null);
        await call('POST', `/api/peer?id=${campId}`, { open: 'general' }, op);
        v = (await call('POST', `/api/team?id=${campId}`, { teamId: 't_a', pin: pins.t_a, op: 'view' })).json;
        assert.equal(v.peer.stageId, 'general');
        assert.ok(v.peer.skills.length >= 3);
        const sk = v.peer.skills[0].id;
        assert.equal((await call('POST', `/api/team?id=${campId}`, { teamId: 't_a', pin: pins.t_a, op: 'feedback', from: 'm_b1', ratings: { m_a1: { [sk]: 4 } } })).status, 400);
        const r = await call('POST', `/api/team?id=${campId}`, { teamId: 't_a', pin: pins.t_a, op: 'feedback', from: 'm_a2', ratings: { m_a1: { [sk]: 5 }, m_a2: { [sk]: 3 } }, mvp: 'm_a1' });
        assert.equal(r.json.success, true, r.text);
        assert.deepEqual(r.json.peer.done, ['m_a2']);
        const p = (await poll()).json;
        assert.ok(!JSON.stringify(p).includes('"feedback"'), 'answers are not public');
    });

    test('features: undo from the history', async () => {
        await call('POST', `/api/stage_scores?id=${campId}`, { stageId: 's_1', scores: { t_c: 40 } }, op);
        const scoreC = team((await poll(op)).json, 't_c').score;
        let audit = (await call('GET', `/api/audit?id=${campId}`, undefined, op)).json.entries;
        const e = audit.find(x => x.action === 'stage_scores');
        assert.ok(e.canUndo && e.id);
        assert.ok(!('undo' in e));
        assert.equal((await call('POST', `/api/undo?id=${campId}`, { auditId: e.id }, ref1)).status, 403);
        const r = await call('POST', `/api/undo?id=${campId}`, { auditId: e.id }, op);
        assert.equal(r.json.success, true, r.text);
        assert.equal(team((await poll(op)).json, 't_c').score, scoreC - 40);
        assert.equal((await call('POST', `/api/undo?id=${campId}`, { auditId: e.id }, op)).status, 404, 'only once');
        // A later change of the same data blocks the undo.
        await call('POST', `/api/stage_scores?id=${campId}`, { stageId: 's_1', scores: { t_c: 10 } }, op);
        audit = (await call('GET', `/api/audit?id=${campId}`, undefined, op)).json.entries;
        const first = audit.find(x => x.action === 'stage_scores' && x.canUndo);
        await call('POST', `/api/stage_scores?id=${campId}`, { stageId: 's_1', scores: { t_c: 12 } }, op);
        assert.equal((await call('POST', `/api/undo?id=${campId}`, { auditId: first.id }, op)).status, 409);
        // The budget transfer can be undone too.
        const tr = audit.find(x => x.action === 'budget');
        const r2 = await call('POST', `/api/undo?id=${campId}`, { auditId: tr.id }, op);
        assert.equal(r2.json.success, true, r2.text);
        assert.equal(team((await poll()).json, 't_b').budget, 120);
    });

    test('features: referee calibration workshop', async () => {
        const mem = (await poll(ref1)).json;
        assert.equal(mem.calibration.cases[0].id, 'cal_1');
        assert.ok(!('expected' in mem.calibration.cases[0]), 'the expected score is not shown to referees');
        assert.equal((await call('POST', `/api/calibration?id=${campId}`, { caseId: 'cal_1', score: 6 }, ref1)).json.success, true);
        assert.equal((await call('POST', `/api/calibration?id=${campId}`, { caseId: 'cal_1', score: 9 }, ref2)).json.success, true);
        assert.equal((await call('POST', `/api/calibration?id=${campId}`, { caseId: 'nope', score: 9 }, ref2)).status, 409);
        const m = (await call('GET', `/api/manage?id=${campId}`, undefined, op)).json;
        assert.deepEqual(m.calibration.scores.cal_1, { ref1: 6, ref2: 9 });
    });

    test('features: online team registration', async () => {
        const r = await call('POST', `/api/register?id=${campId}`, { name: 'Delta', color: '#123456', members: ['Nima', 'Lili'], contact: '0912' });
        assert.equal(r.json.success, true, r.text);
        assert.equal((await call('POST', `/api/register?id=${campId}`, { name: '' })).status, 400);
        let m = (await call('GET', `/api/manage?id=${campId}`, undefined, op)).json;
        const rq = m.registration.requests.find(x => x.name === 'Delta');
        assert.ok(rq && rq.contact === '0912');
        assert.ok(!JSON.stringify((await poll()).json).includes('0912'), 'contact details are private');
        await call('POST', `/api/register/review?id=${campId}`, { requestId: rq.id, approve: true }, op);
        const p = (await poll()).json;
        const delta = p.teams.find(t => t.name === 'Delta');
        assert.ok(delta);
        assert.deepEqual(delta.members.map(x => x.name), ['Nima', 'Lili']);
        m = (await call('GET', `/api/manage?id=${campId}`, undefined, op)).json;
        assert.match(m.teams.find(t => t.name === 'Delta').pin, /^\d{6}$/);
        assert.equal(m.registration.requests.length, 0);
    });

    test('features: analysis data for managers, admins and the client report link', async () => {
        assert.equal((await call('GET', `/api/analysis?id=${campId}`)).status, 401);
        assert.equal((await call('GET', `/api/analysis?id=${campId}`, undefined, ref1)).status, 401);
        const a = (await call('GET', `/api/analysis?id=${campId}`, undefined, op)).json;
        assert.equal(a.access, 'manager');
        assert.ok(a.moments.length >= 1);
        assert.ok(a.audit.length > 3 && !a.audit.some(e => 'undo' in e));
        assert.ok(team(a, 't_a').records.some(r => r.kind === 'feedback'));
        assert.ok(a.users.some(u => u.username === 'ref1'));
        const text = JSON.stringify(a);
        assert.ok(!text.includes('scrypt$') && !text.includes('$2y$') && !text.includes(pins.t_a) && !text.includes(hookUrl), 'no secrets');
        assert.equal((await call('GET', `/api/analysis?id=${campId}`, undefined, sa)).json.access, 'admin');
        const k = await call('POST', `/superadmin/camps/${campId}/client_key`, {}, sa);
        assert.ok(k.json.key.length >= 20);
        assert.equal((await call('GET', `/api/analysis?id=${campId}&key=${k.json.key}`)).json.access, 'client');
        assert.equal((await call('GET', `/api/analysis?id=${campId}&key=wrong`)).status, 401);
        await call('POST', `/superadmin/camps/${campId}/client_key`, { op: 'revoke' }, sa);
        assert.equal((await call('GET', `/api/analysis?id=${campId}&key=${k.json.key}`)).status, 401);
    });

    test('features: notifications reach the camp webhook, in the camp language', async () => {
        // The competition language: fa, en or ar; anything else falls back to Persian.
        await call('POST', `/api/advanced?id=${campId}`, { uiLang: 'xx' }, op);
        assert.equal((await poll()).json.uiLang, 'fa');
        await call('POST', `/api/advanced?id=${campId}`, { uiLang: 'ar' }, op);
        assert.equal((await poll()).json.uiLang, 'ar');
        hooks.length = 0;
        await call('POST', `/api/finish?id=${campId}`, { announce: true }, op);
        const got = await waitFor(() => hooks.find(h => h.event === 'finish'));
        assert.ok(got, 'webhook received the final results');
        assert.equal(got.campId, campId);
        assert.match(got.text, /Alpha|Beta|Gamma/);
        assert.match(got.text, /النتائج النهائية/);
    });

    test('features: superadmin defaults, templates and duplicate keep the settings', async () => {
        const s = (await call('GET', '/superadmin/settings', undefined, sa)).json;
        assert.equal(s.displayDefaults.confetti, true);
        assert.ok(s.featureKeys.includes('budget') && s.displayKeys.includes('confetti'));
        await call('POST', '/superadmin/settings', { displayDefaults: { ...s.displayDefaults, moodImages: false } }, sa);
        const c = await call('POST', '/setup', { orgName: 'o', title: 'Defaults', password: 'oppass', teams: [{ id: 't_1', name: 'A' }], stages: [{ id: 's_1', name: 'S' }], users: [] }, sa);
        assert.equal((await call('GET', `/api?action=poll&id=${c.json.campId}`)).json.display.moodImages, false);
        await call('POST', '/superadmin/settings', { displayDefaults: {} }, sa);
        let t = await call('POST', '/superadmin/templates', { op: 'save', campId, name: 'My event' }, sa);
        assert.equal(t.json.success, true, t.text);
        const list = (await call('GET', '/superadmin/templates', undefined, sa)).json.templates;
        assert.ok(list.some(x => x.builtin));
        const mine = list.find(x => x.name === 'My event');
        assert.equal(mine.data.features.budget, true);
        assert.ok(!JSON.stringify(mine).includes('scoreLogs'));
        t = await call('POST', '/superadmin/templates', { op: 'delete', id: mine.id }, sa);
        assert.ok(!(await call('GET', '/superadmin/templates', undefined, sa)).json.templates.some(x => x.id === mine.id));
        const d = await call('POST', `/superadmin/camps/${campId}/duplicate`, { title: 'Copy' }, sa);
        const copy = (await call('GET', `/api?action=poll&id=${d.json.campId}`)).json;
        assert.equal(copy.features.budget, true);
        assert.equal(copy.display.confetti, false);
        assert.ok(copy.teams.every(t => t.score === 0 && t.budget === 0));
        assert.equal(copy.rounds[0].status, 'draft');
    });

    test('features: organizers only see and manage their own camps', async () => {
        const r = await call('POST', '/superadmin/organizers', { op: 'save', username: 'org.one', name: 'Org One', password: 'orgpass1' }, sa);
        assert.equal(r.json.success, true, r.text);
        assert.equal((await call('POST', '/superadmin/login', { username: 'org.one', password: 'bad' })).json.success, false);
        const l = await call('POST', '/superadmin/login', { username: 'org.one', password: 'orgpass1' });
        assert.equal(l.json.success, true);
        assert.equal(l.json.role, 'organizer');
        const org = l.json.token;
        assert.equal((await call('GET', '/superadmin/me', undefined, org)).json.role, 'organizer');
        assert.equal((await call('GET', '/superadmin/camps', undefined, org)).json.camps.length, 0);
        const c = await call('POST', '/setup', { orgName: 'o', title: 'Org camp', password: 'oppass', teams: [{ id: 't_1', name: 'A' }], stages: [{ id: 's_1', name: 'S' }], users: [] }, org);
        assert.equal(c.json.success, true, c.text);
        assert.deepEqual((await call('GET', '/superadmin/camps', undefined, org)).json.camps.map(x => x.id), [c.json.campId]);
        assert.equal((await call('GET', `/superadmin/camps/${campId}`, undefined, org)).json.success, false);
        assert.equal((await call('POST', `/superadmin/camps/${campId}/lock`, { locked: true }, org)).status, 404);
        assert.equal((await call('POST', '/superadmin/settings', { displayDefaults: {} }, org)).status, 401);
        assert.equal((await call('GET', '/superadmin/organizers', undefined, org)).status, 401);
        const all = (await call('GET', '/superadmin/camps', undefined, sa)).json.camps;
        assert.equal(all.find(x => x.id === c.json.campId).owner, 'Org One');
        const pw = await call('POST', '/superadmin/org_password', { currentPassword: 'orgpass1', newPassword: 'orgpass2' }, org);
        assert.equal(pw.json.success, true);
        assert.equal((await call('GET', '/superadmin/camps', undefined, org)).status, 401, 'old session ends');
        const list = (await call('GET', '/superadmin/organizers', undefined, sa)).json.organizers;
        await call('POST', '/superadmin/organizers', { op: 'save', id: list[0].id, username: 'org.one', name: 'Org One', disabled: true }, sa);
        assert.equal((await call('POST', '/superadmin/login', { username: 'org.one', password: 'orgpass2' })).json.success, false);
    });

    test('features: league standings across camps', async () => {
        const mk = async (title, scores) => {
            const c = await call('POST', '/setup', { orgName: 'o', title, password: 'oppass', teams: [{ id: 't_1', name: 'Lions' }, { id: 't_2', name: 'Tigers' }], stages: [{ id: 's_1', name: 'S' }], users: [] }, sa);
            const o = await login(c.json.campId, 'admin', 'oppass');
            for (const [tid, v] of Object.entries(scores)) await call('POST', `/api/instant?id=${c.json.campId}`, { teamId: tid, delta: v }, o);
            return c.json.campId;
        };
        const c1 = await mk('Round 1', { t_1: 10, t_2: 5 });
        const c2 = await mk('Round 2', { t_1: 1, t_2: 7 });
        const r = await call('POST', '/superadmin/leagues', { leagues: [{ id: 'lg_1', name: 'Season', campIds: [c1, c2, 'missing'], mode: 'rank', rankPoints: [3, 1] }] }, sa);
        assert.equal(r.json.success, true, r.text);
        const g = (await call('GET', '/api/league?id=lg_1')).json;
        assert.equal(g.camps.length, 2);
        assert.deepEqual(g.rows.map(x => [x.name, x.total]), [['Lions', 4], ['Tigers', 4]]);
        await call('POST', '/superadmin/leagues', { leagues: [{ id: 'lg_1', name: 'Season', campIds: [c1, c2], mode: 'score' }] }, sa);
        const g2 = (await call('GET', '/api/league?id=lg_1')).json;
        assert.deepEqual(g2.rows.map(x => [x.name, x.total]), [['Lions', 11], ['Tigers', 12]].reverse());
        assert.equal((await call('GET', '/api/league?id=nope')).status, 404);
    });

    test('features: scores reset clears what happened, keeps the settings', async () => {
        const c = await call('POST', `/superadmin/camps/${campId}/lock`, { locked: false }, sa);
        assert.equal(c.json.success, true);
        await call('POST', `/api/scores/reset?id=${campId}`, { confirm: 'RESET' }, op);
        const p = (await poll()).json;
        assert.ok(p.teams.every(t => t.score === 0 && t.budget === 0));
        assert.equal(p.rounds[0].status, 'draft');
        assert.equal(p.bracket, null);
        assert.equal(p.features.budget, true);
        const a = (await call('GET', `/api/analysis?id=${campId}`, undefined, op)).json;
        assert.ok(a.teams.every(t => t.records.length === 0));
    });

    test('features: team draw (قرعه‌کشی) fills the teams with members', async () => {
        const draw = (body, token = op) => call('POST', `/api/draw?id=${campId}`, body, token);
        const manage = async () => (await call('GET', `/api/manage?id=${campId}`, undefined, op)).json;
        const members = (m, tid) => m.teams.find(t => t.id === tid).members;
        const people = [
            { name: '  Ali   Reza ', seed: 1, row: 2 }, { name: 'Bita', seed: 1 }, { name: 'Cyrus', seed: '1' }, { name: 'Dara', seed: 1 },
            { name: 'Elham', seed: 2 }, { name: 'Farid', seed: 2 }, { name: 'Golnar', seed: 2 }, { name: 'Zed Unplaced', seed: 2 },
            { name: 'Hamid', seed: 3 }, { name: 'Iran', seed: 3 },
            { name: '   ', seed: 1 }, { name: 'Bad seed', seed: 'x' }, { name: 'Negative', seed: -1 }, { name: 'Big', seed: 1000 }
        ];
        // The feature is off by default.
        let r = await draw({ op: 'setup', people });
        assert.equal(r.status, 409);
        assert.equal(r.json.success, false);
        let m = await manage();
        assert.equal(m.draw, null);
        await call('POST', `/api/advanced?id=${campId}`, { features: { ...m.features, draw: true } }, op);
        assert.equal((await poll()).json.features.draw, true);
        const teamIds = (await poll()).json.teams.map(t => t.id);
        assert.equal(teamIds.length, 4);
        const before = Object.fromEntries(m.teams.map(t => [t.id, t.members]));

        // Setup: validation and cleaning.
        assert.equal((await draw({ op: 'setup', people }, ref1)).status, 403, 'referees cannot run the draw');
        r = await draw({ op: 'setup', people: Array.from({ length: 3001 }, (_, i) => ({ name: 'P' + i, seed: 1 })) });
        assert.equal(r.status, 400);
        assert.equal((await draw({ op: 'setup', people: [{ name: '', seed: 1 }] })).status, 400);
        r = await draw({ op: 'setup', people, title: 'Opening draw', potNames: { 2: 'Pot B' }, fileName: 'list.xlsx' });
        assert.equal(r.json.success, true, r.text);
        let d = r.json.draw;
        assert.equal(d.status, 'setup');
        assert.equal(d.live, false);
        assert.equal(d.title, 'Opening draw');
        assert.equal(d.people.length, 10, 'empty names and bad seeds are dropped');
        assert.equal(d.people[0].name, 'Ali Reza');
        assert.equal(d.people[0].row, 2);
        assert.equal(d.people[2].seed, 1);
        assert.equal(new Set(d.people.map(p => p.id)).size, 10);
        assert.deepEqual(d.potNames, { 1: 'گلدان ۱', 2: 'Pot B', 3: 'گلدان ۳' });
        assert.equal(d.curPot, 1);
        assert.deepEqual(d.placed, []);
        const pid = Object.fromEntries(d.people.map(p => [p.name, p.id]));

        // Settings: capacity at or below the automatic one is "automatic"; hold time is clamped.
        r = await draw({ op: 'settings', capacity: 2, holdMs: 99999, auto: true });
        assert.equal(r.json.draw.capacity, null);
        assert.equal(r.json.draw.settings.holdMs, 8000);
        assert.equal(r.json.draw.settings.auto, true);
        r = await draw({ op: 'settings', capacity: 5 });
        assert.equal(r.json.draw.capacity, 5);
        r = await draw({ op: 'settings', capacity: null, holdMs: 2000, potNames: { 1: 'Pot A' } });
        assert.equal(r.json.draw.capacity, null);
        assert.equal(r.json.draw.potNames['1'], 'Pot A');

        r = await draw({ op: 'start' });
        assert.equal(r.json.draw.status, 'running');
        assert.ok(!('draw' in (await poll()).json), 'not public while the draw is not live');
        assert.equal((await manage()).draw.status, 'running');

        // Placing (capacity = ceil(10 / 4) = 3).
        r = await draw({ op: 'place', pid: pid['Ali Reza'], team: 't_c' });
        assert.equal(r.json.success, true, r.text);
        assert.deepEqual([r.json.placement.team, r.json.placement.s, r.json.placement.o], ['t_c', 0, 1]);
        assert.equal((await draw({ op: 'place', pid: pid['Ali Reza'], team: 't_a' })).status, 409, 'no duplicates');
        assert.equal((await draw({ op: 'place', pid: pid.Bita, team: 'nope' })).status, 404);
        assert.equal((await draw({ op: 'place', pid: 999, team: 't_a' })).status, 404);
        await draw({ op: 'place', pid: pid.Bita, team: 't_c' });
        r = await draw({ op: 'place', pid: pid.Cyrus, team: 't_c' });
        assert.equal(r.json.placement.s, 2);
        assert.equal((await draw({ op: 'place', pid: pid.Dara, team: 't_c' })).status, 409, 'team is full');
        r = await draw({ op: 'place', pid: pid.Dara, team: 't_a' });
        assert.equal(r.json.draw.curPot, 2, 'empty pot moves on to the next one');
        m = await manage();
        assert.deepEqual(members(m, 't_c').map(x => x.id), [`dm_${pid['Ali Reza']}`, `dm_${pid.Bita}`, `dm_${pid.Cyrus}`]);
        assert.deepEqual(members(m, 't_c')[0], { id: `dm_${pid['Ali Reza']}`, name: 'Ali Reza', seed: 1, source: 'draw' });
        assert.deepEqual(members(m, 't_a').slice(0, before.t_a.length), before.t_a, 'manual members are untouched');
        assert.equal(members(m, 't_a').at(-1).id, `dm_${pid.Dara}`);

        // Auto: the team with the fewest placements (earlier team on a tie).
        r = await draw({ op: 'auto', pid: pid.Elham });
        assert.equal(r.json.placement.team, 't_b');
        assert.ok(members(await manage(), 't_b').some(x => x.id === `dm_${pid.Elham}`));

        // Remove and undo take the member out again.
        r = await draw({ op: 'remove', pid: pid.Elham });
        assert.equal(r.json.draw.curPot, 2);
        assert.ok(!members(await manage(), 't_b').some(x => x.id === `dm_${pid.Elham}`));
        assert.deepEqual(members(await manage(), 't_b'), before.t_b);
        r = await draw({ op: 'undo' });
        assert.ok(!r.json.draw.placed.some(x => x.pid === pid.Dara));
        assert.equal(r.json.draw.curPot, 1);
        assert.deepEqual(members(await manage(), 't_a'), before.t_a);

        // Rename also renames the member.
        r = await draw({ op: 'rename', pid: pid['Ali Reza'], name: 'Ali R.' });
        assert.equal(r.json.draw.people.find(p => p.id === pid['Ali Reza']).name, 'Ali R.');
        assert.equal(members(await manage(), 't_c')[0].name, 'Ali R.');
        r = await draw({ op: 'pot', seed: 3 });
        assert.equal(r.json.draw.curPot, 3);
        assert.equal((await draw({ op: 'pot', seed: 9 })).status, 404);
        r = await draw({ op: 'add', name: 'New One', seed: 7 });
        assert.equal(r.json.draw.people.length, 11);
        assert.equal(r.json.draw.potNames['7'], 'گلدان ۷');

        // Live: the public state carries a summary without the names still in the pots.
        r = await draw({ op: 'live', on: true });
        assert.equal(r.json.draw.live, true);
        const pub = (await poll()).json;
        assert.deepEqual(Object.keys(pub.draw).sort(), ['cap', 'holdMs', 'live', 'placed', 'placedCount', 'pot', 'title', 'total'].sort());
        assert.deepEqual([pub.draw.live, pub.draw.title, pub.draw.cap, pub.draw.total, pub.draw.placedCount, pub.draw.pot, pub.draw.holdMs],
            [true, 'Opening draw', 3, 11, 3, 'گلدان ۳', 2000]);
        assert.deepEqual(pub.draw.placed.map(x => [x.team, x.s, x.name]), [['t_c', 0, 'Ali R.'], ['t_c', 1, 'Bita'], ['t_c', 2, 'Cyrus']]);
        assert.ok(!JSON.stringify(pub).includes('Zed Unplaced'), 'unplaced names stay private');
        assert.equal((await poll(ref1)).json.draw.placedCount, 3);

        // Finish keeps the members; a finished draw takes no more placements until it is reopened.
        r = await draw({ op: 'finish' });
        assert.deepEqual([r.json.draw.status, r.json.draw.live], ['done', false]);
        assert.ok(!('draw' in (await poll()).json));
        assert.equal(members(await manage(), 't_c').length, 3);
        assert.equal((await draw({ op: 'place', pid: pid.Farid, team: 't_b' })).status, 409);
        assert.equal((await draw({ op: 'start' })).json.draw.status, 'running');
        assert.equal((await draw({ op: 'setup', people })).status, 409, 'a draw with results is reset first');

        // Reset removes the draw's members only.
        r = await draw({ op: 'reset' });
        assert.deepEqual([r.json.draw.placed.length, r.json.draw.order, r.json.draw.curPot, r.json.draw.status], [0, 0, 1, 'running']);
        m = await manage();
        for (const t of m.teams) assert.deepEqual(t.members, before[t.id]);

        // Clear deletes the draw; the members stay, and a new draw never reuses their ids.
        await draw({ op: 'place', pid: pid.Bita, team: 't_a' });
        // A placement can also be undone from the history (draw and members together).
        const entry = (await call('GET', `/api/audit?id=${campId}`, undefined, op)).json.entries.find(e => e.action === 'draw');
        assert.ok(entry.canUndo);
        assert.equal((await call('POST', `/api/undo?id=${campId}`, { auditId: entry.id }, op)).json.success, true);
        m = await manage();
        assert.equal(m.draw.placed.length, 0);
        assert.deepEqual(m.draw.potNames, { 1: 'Pot A', 2: 'Pot B', 3: 'گلدان ۳', 7: 'گلدان ۷' });
        assert.deepEqual(members(m, 't_a'), before.t_a);
        await draw({ op: 'place', pid: pid.Bita, team: 't_a' });
        r = await draw({ op: 'clear' });
        assert.equal(r.json.draw, null);
        m = await manage();
        assert.equal(m.draw, null);
        assert.equal(members(m, 't_a').at(-1).id, `dm_${pid.Bita}`);
        r = await draw({ op: 'setup', people: people.slice(0, 3) });
        assert.ok(r.json.draw.people.every(p => p.id > pid.Bita));
        assert.equal((await draw({ op: 'place', pid: r.json.draw.people[0].id, team: 't_b' }, ref1)).status, 403);
        await draw({ op: 'clear' });
    });
}
