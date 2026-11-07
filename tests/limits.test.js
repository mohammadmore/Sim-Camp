// Operational safeguards of server.js: readiness, health, body limits, rate limits, connection caps, lock timeouts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DB_ADAPTER = 'memory';
process.env.SUPERADMIN_PASS = 'limits-pass';
process.env.RATE_READ_PER_MIN = '60';
process.env.BODY_LIMIT_SMALL = '2kb';
process.env.SSE_MAX_PER_IP = '2';
process.env.LOCK_HOLD_MS = '300';

const { app, initSecurity } = await import('../server.js');
let server, base;

before(async () => {
    server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections(); server.close(); });

const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('before the database is ready, API calls answer 503 "starting" and static pages still load', async () => {
    const h = await fetch(base + '/health');
    assert.equal(h.status, 503);
    assert.equal((await h.json()).status, 'starting');
    const r = await fetch(base + '/api/settings');
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('retry-after'), '5');
    assert.equal((await fetch(base + '/board.html')).status, 200);
    await initSecurity();
});

test('health reports ok with database latency and warnings', async () => {
    const r = await fetch(base + '/health');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.status, 'ok');
    assert.equal(j.db.ok, true);
    assert.ok(j.warnings.some(w => w.includes('memory')));
    assert.ok(!JSON.stringify(j).includes('limits-pass'));
});

test('oversized bodies get a JSON 413; anonymous large uploads are refused before reading', async () => {
    const r = await post('/login', { id: 'x', username: 'u', password: 'p'.repeat(5000) });
    assert.equal(r.status, 413);
    assert.match((await r.json()).message, /حجم/);
    const big = await post('/setup', { orgName: 'x'.repeat(5 * 1024 * 1024) });
    assert.equal(big.status, 401);
    const bad = await post('/login', '{not json');
    assert.equal(bad.status, 400);
});

let saToken, campId, opToken;
test('setup still accepts large authenticated bodies', async () => {
    saToken = (await (await post('/superadmin/login', { password: 'limits-pass' })).json()).token;
    const r = await post('/setup', {
        orgName: 'Org', title: 'T', password: 'oppass', logo: 'data:image/png;base64,' + 'A'.repeat(300 * 1024),
        teams: [{ id: 't_1', name: 'A' }], stages: [{ id: 's_1', name: 'S' }], users: [{ username: 'op', password: 'op1', role: 'operator' }]
    }, { 'X-Auth-Token': saToken });
    const j = await r.json();
    assert.equal(j.success, true);
    campId = j.campId;
    opToken = (await (await post('/login', { id: campId, username: 'op', password: 'op1' })).json()).token;
});

test('a write that exceeds LOCK_HOLD_MS fails fast with 503 and the camp keeps working', async () => {
    process.env.MEMORY_DB_WRITE_DELAY_MS = '1500';
    const t0 = Date.now();
    const r = await post(`/api/instant?id=${campId}`, { teamId: 't_1', delta: 1 }, { 'X-Auth-Token': opToken });
    assert.equal(r.status, 503);
    assert.ok(Date.now() - t0 < 1200, 'answered before the slow write finished');
    process.env.MEMORY_DB_WRITE_DELAY_MS = '0';
    await new Promise(r2 => setTimeout(r2, 1400)); // let the abandoned write settle
    const ok = await post(`/api/instant?id=${campId}`, { teamId: 't_1', delta: 2 }, { 'X-Auth-Token': opToken });
    assert.equal(ok.status, 200);
});

test('live board connections are capped per IP', async () => {
    const ctrls = [new AbortController(), new AbortController()];
    const open = await Promise.all(ctrls.map(c => fetch(`${base}/api?action=stream&id=${campId}`, { signal: c.signal })));
    assert.ok(open.every(r => r.status === 200));
    const third = await fetch(`${base}/api?action=stream&id=${campId}`);
    assert.equal(third.status, 429);
    ctrls.forEach(c => c.abort());
});

test('per-IP read rate limit answers 429 with Retry-After', async () => {
    let last;
    for (let i = 0; i < 70; i++) last = await fetch(`${base}/api?action=info&id=${campId}`);
    assert.equal(last.status, 429);
    assert.equal(last.headers.get('retry-after'), '60');
    assert.equal((await fetch(base + '/health')).status, 200); // health is never rate limited
});
