// Backend-independent API scenarios, run against both server.js and cpanel_export/api.php.
import { test } from 'node:test';
import assert from 'node:assert/strict';

export function registerScenarios(ctx) {
    // ctx.call(method, path, body, token) uses Node-style paths; ctx.saPassword is the superadmin password.
    const call = (...a) => ctx.call(...a);
    let saToken, campId;

    async function login(username, password) {
        const r = await call('POST', '/login', { id: campId, username, password });
        assert.equal(r.json.success, true, `login ${username}`);
        return r.json.token;
    }

    test('superadmin endpoints require a valid session', async () => {
        assert.equal((await call('GET', '/superadmin/camps')).status, 401);
        assert.equal((await call('POST', '/setup', { orgName: 'x' })).status, 401);
        assert.equal((await call('POST', '/api/settings', { key: 'systemLogo', value: 'x' })).status, 401);
        const bad = await call('POST', '/superadmin/login', { password: 'wrong' });
        assert.equal(bad.json.success, false);
        const ok = await call('POST', '/superadmin/login', { password: ctx.saPassword });
        assert.equal(ok.json.success, true);
        saToken = ok.json.token;
        assert.equal((await call('GET', '/superadmin/camps', undefined, saToken)).status, 200);
    });

    test('settings cannot expose or change secrets', async () => {
        const r = await call('POST', '/api/settings', { key: 'admin_password', value: 'hacked' }, saToken);
        assert.equal(r.status, 400);
        const g = await call('GET', '/api/settings');
        assert.deepEqual(Object.keys(g.json), ['systemLogo']);
    });

    test('setup creates a camp and hashes passwords', async () => {
        const r = await call('POST', '/setup', {
            orgName: 'Org', title: 'Camp', password: 'oppass', campType: 'simple',
            teams: [{ id: 't_a', name: 'A', color: '#f00' }, { id: 't_b', name: "B'<img src=x>", color: '#0f0' }],
            stages: [{ id: 's_1', name: 'S1', unit: 'points' }, { id: 's_2', name: 'Time', unit: 'time', timeOrder: 'asc' }],
            users: [
                { id: 'u_op', username: 'op', password: 'op1', role: 'operator' },
                { id: 'u_r1', username: 'ref1', password: 'r1', role: 'referee' },
                { id: 'u_r2', username: 'ref2', password: 'r2', role: 'referee' }
            ]
        }, saToken);
        assert.equal(r.json.success, true);
        campId = r.json.campId;
        const sa = await call('GET', `/superadmin/camps/${campId}`, undefined, saToken);
        assert.equal(sa.json.camp.password, '');
        assert.ok(sa.json.camp.users.every(u => u.password === '' && u.hasPassword));
    });

    test('public endpoints never leak passwords or users', async () => {
        const poll = await call('GET', `/api?action=poll&id=${campId}`);
        assert.equal(poll.status, 200);
        assert.ok(!('password' in poll.json));
        assert.ok(!('users' in poll.json));
        const info = await call('GET', `/api?action=info&id=${campId}`);
        assert.deepEqual(Object.keys(info.json).sort(), ['campType', 'logo', 'orgName', 'success', 'title']);
    });

    test('login works for listed users and the built-in admin operator', async () => {
        assert.equal((await call('POST', '/login', { id: campId, username: 'op', password: 'nope' })).json.success, false);
        const t = await login('op', 'op1');
        assert.ok(t);
        assert.ok(await login('admin', 'oppass'));
        const restored = await call('POST', '/login', { id: campId, token: t });
        assert.equal(restored.json.success, true);
        assert.equal(restored.json.user.username, 'op');
        assert.ok(!('password' in restored.json.user));
    });

    test('scoring requires a camp session', async () => {
        const r = await call('POST', `/api/instant?id=${campId}`, { teamId: 't_a', delta: 5 });
        assert.equal(r.status, 401);
    });

    test('concurrent instant scores are all kept and settings saves do not wipe them', async () => {
        const r1 = await login('ref1', 'r1');
        const r2 = await login('ref2', 'r2');
        const op = await login('op', 'op1');
        const before = await call('GET', `/api?action=poll&id=${campId}`);
        await Promise.all([
            call('POST', `/api/instant?id=${campId}`, { teamId: 't_a', delta: 5, tag: 'نظم' }, r1),
            call('POST', `/api/instant?id=${campId}`, { teamId: 't_a', delta: 2.5 }, r2),
            call('POST', `/api/instant?id=${campId}`, { teamId: 't_a', delta: -1 }, r1)
        ]);
        // Operator saves settings using the stale team list fetched before the scores came in.
        const save = await call('POST', `/api?id=${campId}`, { teams: before.json.teams.map(t => ({ ...t, name: t.name + '!' })), stages: before.json.stages }, op);
        assert.equal(save.json.success, true);
        const after = await call('GET', `/api?action=poll&id=${campId}`);
        const a = after.json.teams.find(t => t.id === 't_a');
        assert.equal(a.name, 'A!');
        assert.equal(a.scoreLogs.length, 3);
        assert.equal(a.score, 6.5);
        assert.ok(a.scoreLogs.every(l => l.user && !('password' in l.user)));
        // Referees cannot change camp settings.
        assert.equal((await call('POST', `/api?id=${campId}`, { title: 'x' }, r1)).status, 403);
    });

    test('undo cancels exactly one log; referees may only undo their own', async () => {
        const r1 = await login('ref1', 'r1');
        const r2 = await login('ref2', 'r2');
        const i1 = await call('POST', `/api/instant?id=${campId}`, { teamId: 't_b', delta: 10 }, r1);
        const i2 = await call('POST', `/api/instant?id=${campId}`, { teamId: 't_b', delta: 3 }, r1);
        assert.equal((await call('POST', `/api/undo_instant?id=${campId}`, { logId: i1.json.logId }, r2)).status, 403);
        assert.equal((await call('POST', `/api/undo_instant?id=${campId}`, { logId: i1.json.logId }, r1)).json.success, true);
        const b = (await call('GET', `/api?action=poll&id=${campId}`)).json.teams.find(t => t.id === 't_b');
        assert.equal(b.score, 3);
        assert.equal(b.scoreLogs.find(l => l.id === i1.json.logId).type, 'cancelled');
        assert.equal(b.scoreLogs.find(l => l.id === i2.json.logId).type, 'instant');
        assert.equal((await call('POST', `/api/undo_instant?id=${campId}`, { logId: 'log_missing' }, r1)).status, 404);
    });

    test('judge stage scores: per-team delete, overrides and decimals', async () => {
        const r1 = await login('ref1', 'r1');
        const r2 = await login('ref2', 'r2');
        const op = await login('op', 'op1');
        await call('POST', `/api/judge_stage_score?id=${campId}`, { stageId: 's_1', scores: { t_a: 7.5, t_b: 4 } }, r1);
        await call('POST', `/api/judge_stage_score?id=${campId}`, { stageId: 's_1', scores: { t_a: 2, t_b: 1 } }, r2);
        let teams = (await call('GET', `/api?action=poll&id=${campId}`)).json.teams;
        assert.equal(teams.find(t => t.id === 't_a').stageScores.s_1, 9.5);
        // A referee cannot delete someone else's score; deleting for one team keeps the other team's entry.
        const delBody = { stageId: 's_1', action: 'delete', targetJudgeKey: 'ref1', singleScore: { teamId: 't_a' } };
        assert.equal((await call('POST', `/api/judge_stage_score?id=${campId}`, delBody, r2)).status, 403);
        await call('POST', `/api/judge_stage_score?id=${campId}`, delBody, op);
        teams = (await call('GET', `/api?action=poll&id=${campId}`)).json.teams;
        assert.equal(teams.find(t => t.id === 't_a').stageScores.s_1, 2);
        assert.equal(teams.find(t => t.id === 't_b').stageScores.s_1, 5);
        // Manual correction replaces the judges' sum.
        await call('POST', `/api/stage_scores?id=${campId}`, { stageId: 's_1', scores: { t_b: 20 } }, op);
        teams = (await call('GET', `/api?action=poll&id=${campId}`)).json.teams;
        const b = teams.find(t => t.id === 't_b');
        assert.equal(b.stageScores.s_1, 20);
        assert.equal(b.score, 23);
    });

    test('team log edits via the dedicated endpoint', async () => {
        const op = await login('op', 'op1');
        const a = (await call('GET', `/api?action=poll&id=${campId}`)).json.teams.find(t => t.id === 't_a');
        // The three logs were created concurrently, so pick them by value rather than position.
        const first = a.scoreLogs.find(l => l.value === 5);
        const second = a.scoreLogs.find(l => l.value === 2.5);
        await call('POST', `/api/team_logs?id=${campId}`, { teamId: 't_a', values: { [first.id]: 10 }, removed: [second.id] }, op);
        const a2 = (await call('GET', `/api?action=poll&id=${campId}`)).json.teams.find(t => t.id === 't_a');
        assert.equal(a2.scoreLogs.length, 2);
        assert.equal(a2.scoreLogs.find(l => l.id === first.id).value, 10);
        assert.equal(a2.score, 10 - 1 + 2);
    });

    test('tiered close uses first-recorded time, dense ranking, DNF and reopen clears it', async () => {
        const r = await call('POST', '/setup', {
            orgName: 'Org', title: 'Tiered', password: 'p', campType: 'tiered', tieredPointsLadder: [500, 400, 300],
            teams: [{ id: 't_1', name: 'One' }, { id: 't_2', name: 'Two' }, { id: 't_3', name: 'Three' }, { id: 't_4', name: 'Four' }],
            stages: [{ id: 's_t', name: 'Speed', unit: 'time', timeOrder: 'asc', multiplier: 2 }],
            users: [{ username: 'op', password: 'op', role: 'operator' }, { username: 'j1', password: 'j1', role: 'referee' }, { username: 'j2', password: 'j2', role: 'referee' }]
        }, saToken);
        const id = r.json.campId;
        const tok = async (u, p) => (await call('POST', '/login', { id, username: u, password: p })).json.token;
        const op = await tok('op', 'op'), j1 = await tok('j1', 'j1'), j2 = await tok('j2', 'j2');
        // j2 records first for team 1, then j1 (whose key sorts first) records a different time.
        await call('POST', `/api/judge_stage_score?id=${id}`, { stageId: 's_t', scores: { t_1: 30 } }, j2);
        await new Promise(res => setTimeout(res, 5));
        await call('POST', `/api/judge_stage_score?id=${id}`, { stageId: 's_t', scores: { t_1: 99, t_2: 30, t_3: 40 } }, j1);
        await call('POST', `/api/judge_stage_score?id=${id}`, { stageId: 's_t', singleScore: { teamId: 't_4', score: '-', dnf: true } }, j1);
        // Totals do not move until the stage is closed.
        let teams = (await call('GET', `/api?action=poll&id=${id}`)).json.teams;
        assert.ok(teams.every(t => t.score === 0));
        assert.equal((await call('POST', '/api/stage/close_tiered', { id, stageId: 's_t' }, j1)).status, 403);
        const closed = await call('POST', '/api/stage/close_tiered', { id, stageId: 's_t' }, op);
        assert.equal(closed.json.success, true);
        const byId = Object.fromEntries(closed.json.results.map(x => [x.teamId, x]));
        assert.equal(byId.t_1.rank, 1); // first recorded time (30) is used, not 99
        assert.equal(byId.t_2.rank, 1);
        assert.equal(byId.t_3.rank, 2);
        assert.equal(byId.t_1.assignedScore, 1000);
        assert.equal(byId.t_3.assignedScore, 800);
        assert.equal(byId.t_4.assignedScore, 0);
        const reopened = await call('POST', '/api/stage/close_tiered', { id, stageId: 's_t', reopen: true }, op);
        assert.equal(reopened.json.success, true);
        const state = (await call('GET', `/api?action=poll&id=${id}`)).json;
        assert.deepEqual(state.closedStages, {});
        assert.ok(state.teams.every(t => t.score === 0));
    });

    test('locked camps reject scoring with an error (not silent success)', async () => {
        await call('POST', `/superadmin/camps/${campId}/lock`, { locked: true }, saToken);
        const r1 = await login('ref1', 'r1');
        const r = await call('POST', `/api/judge_stage_score?id=${campId}`, { stageId: 's_1', scores: { t_a: 1 } }, r1);
        assert.equal(r.status, 403);
        await call('POST', `/superadmin/camps/${campId}/lock`, { locked: false }, saToken);
    });

    test('changing a user password invalidates their session', async () => {
        const r1 = await login('ref1', 'r1');
        const sa = await call('GET', `/superadmin/camps/${campId}`, undefined, saToken);
        const c = sa.json.camp;
        const users = c.users.map(u => (u.username === 'ref1' ? { ...u, password: 'new-pass' } : u));
        const up = await call('POST', '/setup', { ...c, campId, users, password: '' }, saToken);
        assert.equal(up.json.success, true);
        assert.equal((await call('POST', `/api/instant?id=${campId}`, { teamId: 't_a', delta: 1 }, r1)).status, 401);
        assert.ok(await login('ref1', 'new-pass'));
        assert.ok(await login('ref2', 'r2')); // untouched (blank) passwords are kept
        assert.ok(await login('admin', 'oppass'));
    });

    test('invalid ids are rejected', async () => {
        const op = await login('op', 'op1');
        const r = await call('POST', `/api/instant?id=${campId}`, { teamId: "x'); alert(1);//", delta: 1 }, op);
        assert.equal(r.status, 400);
    });

    test('instant scores with a client id are idempotent (offline retries)', async () => {
        const op = await login('op', 'op1');
        const body = { teamId: 't_b', delta: 4, clientLogId: 'log_offline_retry_1' };
        const a = await call('POST', `/api/instant?id=${campId}`, body, op);
        const b = await call('POST', `/api/instant?id=${campId}`, body, op);
        assert.equal(a.json.logId, 'log_offline_retry_1');
        assert.equal(b.json.success, true);
        const t = (await call('GET', `/api?action=poll&id=${campId}`)).json.teams.find(x => x.id === 't_b');
        assert.equal(t.scoreLogs.filter(l => l.id === 'log_offline_retry_1').length, 1);
    });

    test('audit log records manager actions and is not public', async () => {
        const op = await login('op', 'op1');
        await call('POST', `/api/stage_scores?id=${campId}`, { stageId: 's_1', scores: { t_a: 3 } }, op);
        const r = await call('GET', `/api/audit?id=${campId}`, undefined, op);
        assert.equal(r.json.success, true);
        assert.equal(r.json.entries[0].action, 'stage_scores');
        assert.equal(r.json.entries[0].by.username, 'op');
        const ref = await login('ref2', 'r2');
        assert.equal((await call('GET', `/api/audit?id=${campId}`, undefined, ref)).status, 403);
        assert.ok(!('auditLog' in (await call('GET', `/api?action=poll&id=${campId}`)).json));
    });

    test('managers reset referee passwords; users change their own', async () => {
        const op = await login('op', 'op1');
        const list = await call('GET', `/api/users?id=${campId}`, undefined, op);
        assert.ok(list.json.users.every(u => !('password' in u)));
        assert.equal(list.json.users.find(u => u.username === 'ref2').canReset, true);
        assert.equal(list.json.users.find(u => u.username === 'op').canReset, false);
        assert.equal((await call('POST', `/api/users/reset_password?id=${campId}`, { username: 'op', newPassword: 'xxxxxx' }, op)).status, 403);
        assert.equal((await call('POST', `/api/users/reset_password?id=${campId}`, { username: 'ref2', newPassword: '123' }, op)).status, 400);
        assert.equal((await call('POST', `/api/users/reset_password?id=${campId}`, { username: 'ref2', newPassword: 'reset-2' }, op)).json.success, true);
        const ref = await login('ref2', 'reset-2');
        assert.equal((await call('POST', `/api/users/reset_password?id=${campId}`, { username: 'ref1', newPassword: 'zzzzzz' }, ref)).status, 403);
        assert.equal((await call('POST', '/api/user/password', { campId, currentPassword: 'wrong', newPassword: 'mine-22' }, ref)).status, 400);
        const ch = await call('POST', '/api/user/password', { campId, currentPassword: 'reset-2', newPassword: 'ref2-pass' }, ref);
        assert.equal(ch.json.success, true, JSON.stringify(ch.json));
        assert.equal((await call('POST', `/api/instant?id=${campId}`, { teamId: 't_a', delta: 1 }, ref)).status, 401);
        assert.equal((await call('POST', `/api/instant?id=${campId}`, { teamId: 't_a', delta: 1 }, ch.json.token)).json.success, true);
    });

    test('stage reset clears one stage only', async () => {
        const op = await login('op', 'op1');
        const before = (await call('GET', `/api?action=poll&id=${campId}`)).json.teams.find(t => t.id === 't_a');
        const logsSum = before.scoreLogs.filter(l => l.type !== 'cancelled').reduce((a, l) => a + l.value, 0);
        const r = await call('POST', `/api/stage/reset?id=${campId}`, { stageId: 's_1' }, op);
        assert.equal(r.json.success, true);
        const a = (await call('GET', `/api?action=poll&id=${campId}`)).json.teams.find(t => t.id === 't_a');
        assert.equal(a.stageScores.s_1, undefined);
        assert.deepEqual(a.judgeStageScores.s_1 || {}, {});
        assert.equal(a.score, logsSum);
    });

    test('board control, finish and announcement', async () => {
        const op = await login('op', 'op1');
        await call('POST', `/api/board?id=${campId}`, { activeStageId: 's_2' }, op);
        assert.equal((await call('GET', `/api?action=poll&id=${campId}`)).json.activeStageId, 's_2');
        assert.equal((await call('POST', `/api/board?id=${campId}`, { activeStageId: 'nope' }, op)).status, 404);
        const ref = await login('ref2', 'ref2-pass');
        assert.equal((await call('POST', `/api/finish?id=${campId}`, { announce: true }, ref)).status, 403);
        assert.equal((await call('POST', `/api/finish?id=${campId}`, { announce: true }, op)).json.success, true);
        let st = (await call('GET', `/api?action=poll&id=${campId}`)).json;
        assert.equal(st.locked, true);
        assert.equal(st.announcement.active, true);
        assert.equal((await call('POST', `/api/board?id=${campId}`, { announcement: 'hide' }, op)).json.success, true);
        st = (await call('GET', `/api?action=poll&id=${campId}`)).json;
        assert.equal(st.announcement, null);
        await call('POST', `/superadmin/camps/${campId}/lock`, { locked: false }, saToken);
    });

    test('scores reset is operator-only', async () => {
        const op = await login('op', 'op1');
        const ref = await login('ref2', 'ref2-pass');
        assert.equal((await call('POST', `/api/scores/reset?id=${campId}`, { confirm: 'RESET' }, ref)).status, 403);
        assert.equal((await call('POST', `/api/scores/reset?id=${campId}`, {}, op)).status, 400);
        assert.equal((await call('POST', `/api/scores/reset?id=${campId}`, { confirm: 'RESET' }, op)).json.success, true);
        const st = (await call('GET', `/api?action=poll&id=${campId}`)).json;
        assert.ok(st.teams.every(t => t.score === 0 && t.scoreLogs.length === 0));
    });

    test('duplicate and delete camps', async () => {
        const op = await login('op', 'op1');
        await call('POST', `/api/instant?id=${campId}`, { teamId: 't_a', delta: 9 }, op);
        const d = await call('POST', `/superadmin/camps/${campId}/duplicate`, { title: 'دوره دوم' }, saToken);
        assert.equal(d.json.success, true);
        const copyId = d.json.campId;
        const st = (await call('GET', `/api?action=poll&id=${copyId}`)).json;
        assert.equal(st.title, 'دوره دوم');
        assert.ok(st.teams.length === 2 && st.teams.every(t => t.score === 0 && t.scoreLogs.length === 0));
        assert.equal((await call('POST', '/login', { id: copyId, username: 'op', password: 'op1' })).json.success, true);
        assert.equal((await call('POST', `/superadmin/camps/${copyId}/delete`, {})).status, 401);
        assert.equal((await call('POST', `/superadmin/camps/${copyId}/delete`, {}, saToken)).json.success, true);
        assert.equal((await call('GET', `/api?action=poll&id=${copyId}`)).status, 404);
        const list = (await call('GET', '/superadmin/camps', undefined, saToken)).json.camps;
        assert.ok(!list.some(c => c.id === copyId));
    });

    test('superadmin can change their password', async () => {
        assert.equal((await call('POST', '/superadmin/password', { currentPassword: 'wrong', newPassword: 'another-pass' }, saToken)).status, 400);
        const r = await call('POST', '/superadmin/password', { currentPassword: ctx.saPassword, newPassword: 'another-pass' }, saToken);
        assert.equal(r.json.success, true);
        assert.equal((await call('GET', '/superadmin/camps', undefined, saToken)).status, 401);
        assert.equal((await call('GET', '/superadmin/camps', undefined, r.json.token)).status, 200);
        assert.equal((await call('POST', '/superadmin/login', { password: ctx.saPassword })).json.success, false);
        const back = await call('POST', '/superadmin/password', { currentPassword: 'another-pass', newPassword: ctx.saPassword }, r.json.token);
        saToken = back.json.token;
        assert.equal((await call('POST', '/superadmin/login', { password: ctx.saPassword })).json.success, true);
    });
}
