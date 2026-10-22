// Two server instances on one Firestore database (the Firestore emulator).
// Skipped unless FIRESTORE_EMULATOR_HOST is set, e.g.:
//   npx firebase-tools emulators:start --only firestore   (or java -jar cloud-firestore-emulator.jar --port 8089)
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8089 npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !EMU && 'FIRESTORE_EMULATOR_HOST is not set';
const PROJECT = 'sim-camp-test-' + Date.now();
const SA_PASS = 'multi-pass-1';
const procs = [];
let A, B;

function startServer(port) {
    const p = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: {
            ...process.env, NODE_ENV: 'production', PORT: String(port), DB_ADAPTER: 'firebase',
            FIRESTORE_EMULATOR_HOST: EMU, GCLOUD_PROJECT: PROJECT, FIRESTORE_DATABASE_ID: '(default)',
            SUPERADMIN_PASS: SA_PASS, FIREBASE_SERVICE_ACCOUNT: '', GOOGLE_APPLICATION_CREDENTIALS: ''
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    procs.push(p);
    let out = '';
    p.stderr.on('data', d => { out += d; if (process.env.MULTI_DEBUG) process.stderr.write(`[${port}] ${d}`); });
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('server did not start: ' + out)), 30000);
        p.stdout.on('data', d => { out += d; if (String(d).includes('Ready')) { clearTimeout(t); resolve(`http://127.0.0.1:${port}`); } });
        p.on('exit', code => reject(new Error(`server exited (${code}): ${out}`)));
    });
}

async function call(base, method, p, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Auth-Token'] = token;
    const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
}

async function eventually(fn, ms = 5000) {
    const until = Date.now() + ms;
    for (;;) {
        try { return await fn(); } catch (e) { if (Date.now() > until) throw e; }
        await new Promise(r => setTimeout(r, 100));
    }
}

before(async () => {
    if (skip) return;
    // Start one after the other: the first creates the shared session secret.
    A = await startServer(4101);
    B = await startServer(4102);
});
after(() => procs.forEach(p => p.kill()));

let saA, campId, refTok, opTok;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('sessions created on one instance work on the other', { skip }, async () => {
    saA = (await call(A, 'POST', '/superadmin/login', { password: SA_PASS })).json.token;
    assert.ok(saA);
    assert.equal((await call(B, 'GET', '/superadmin/camps', undefined, saA)).status, 200);
    const r = await call(A, 'POST', '/setup', {
        orgName: 'Org', title: 'Multi', password: 'oppass', campType: 'simple', logo: PNG,
        teams: [{ id: 't_a', name: 'A', color: '#f00', image: PNG }, { id: 't_b', name: 'B', color: '#0f0' }],
        stages: [{ id: 's_1', name: 'S1', unit: 'points' }],
        users: [{ id: 'u_op', username: 'op', password: 'op1pass', role: 'operator' }, { id: 'u_r', username: 'ref', password: 'ref1pass', role: 'referee' }]
    }, saA);
    assert.equal(r.json.success, true);
    campId = r.json.campId;
    refTok = (await call(A, 'POST', '/login', { id: campId, username: 'ref', password: 'ref1pass' })).json.token;
    opTok = (await call(B, 'POST', '/login', { id: campId, username: 'op', password: 'op1pass' })).json.token;
    assert.ok(refTok && opTok);
});

test('images are stored once and served by both instances', { skip }, async () => {
    const poll = await call(B, 'GET', `/api?action=poll&id=${campId}`);
    assert.match(poll.json.logo, /^\/media\/[a-f0-9]{32}\.png$/);
    assert.equal(poll.json.teams[0].image, poll.json.logo);
    assert.ok(!poll.text.includes('base64'));
    const img = await fetch(B + poll.json.logo);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.match(img.headers.get('cache-control'), /immutable/);
});

test('a score recorded on A reaches B (poll and live board splash)', { skip }, async () => {
    // Live board connected to B.
    const ctrl = new AbortController();
    const stream = await fetch(`${B}/api?action=stream&id=${campId}`, { signal: ctrl.signal });
    const reader = stream.body.getReader();
    let sse = '';
    const splash = (async () => {
        const dec = new TextDecoder();
        while (!sse.includes('event: splash')) { const { value, done } = await reader.read(); if (done) break; sse += dec.decode(value); }
    })();
    await new Promise(r => setTimeout(r, 300));
    const r = await call(A, 'POST', `/api/instant?id=${campId}`, { teamId: 't_a', delta: 7, tag: 'x' }, refTok);
    assert.equal(r.json.success, true);
    await Promise.race([splash, new Promise((_, rej) => setTimeout(() => rej(new Error('no splash on B: ' + sse)), 5000))]);
    ctrl.abort();
    assert.match(sse, /"delta":7/);
    await eventually(async () => {
        const p = await call(B, 'GET', `/api?action=poll&id=${campId}`);
        assert.equal(p.json.teams.find(t => t.id === 't_a').score, 7);
    });
});

test('scores from both instances at the same time are all counted', { skip }, async () => {
    const reqs = [];
    for (let i = 0; i < 10; i++) reqs.push(call(i % 2 ? A : B, 'POST', `/api/instant?id=${campId}`, { teamId: 't_b', delta: 1 }, refTok));
    const res = await Promise.all(reqs);
    assert.ok(res.every(r => r.json && r.json.success), JSON.stringify(res.map(r => r.json)));
    for (const base of [A, B]) {
        await eventually(async () => {
            const p = await call(base, 'GET', `/api?action=poll&id=${campId}`);
            assert.equal(p.json.teams.find(t => t.id === 't_b').score, 10);
        });
    }
});

test('concurrent edits of the camp on both instances do not overwrite each other', { skip }, async () => {
    const [x, y] = await Promise.all([
        call(A, 'POST', `/api/stage_scores?id=${campId}`, { stageId: 's_1', scores: { t_a: 50 } }, opTok),
        call(B, 'POST', `/api/board?id=${campId}`, { activeStageId: 's_1' }, opTok)
    ]);
    assert.equal(x.json.success, true, x.text);
    assert.equal(y.json.success, true, y.text);
    for (const base of [A, B]) {
        await eventually(async () => {
            const p = await call(base, 'GET', `/api?action=poll&id=${campId}`);
            assert.equal(p.json.activeStageId, 's_1');
            assert.equal(p.json.teams.find(t => t.id === 't_a').score, 57);
        });
    }
});

test('unchanged data answers 304 with the same ETag on both instances', { skip }, async () => {
    const a = await call(A, 'GET', `/api?action=poll&id=${campId}`);
    const b = await call(B, 'GET', `/api?action=poll&id=${campId}`);
    assert.equal(a.headers.get('etag'), b.headers.get('etag'));
    const r = await fetch(`${B}/api?action=poll&id=${campId}`, { headers: { 'If-None-Match': a.headers.get('etag') } });
    assert.equal(r.status, 304);
});

test('a superadmin password changed on A is accepted by B', { skip }, async () => {
    const r = await call(A, 'POST', '/superadmin/password', { currentPassword: SA_PASS, newPassword: 'changed-pass-2' }, saA);
    assert.equal(r.json.success, true);
    const newTok = r.json.token;
    await eventually(async () => assert.equal((await call(B, 'GET', '/superadmin/camps', undefined, newTok)).status, 200));
    const login = await call(B, 'POST', '/superadmin/login', { password: 'changed-pass-2' });
    assert.equal(login.json.success, true);
});

test('trash, restore and backup work across instances', { skip }, async () => {
    const sa = (await call(B, 'POST', '/superadmin/login', { password: 'changed-pass-2' })).json.token;
    assert.equal((await call(A, 'POST', `/superadmin/camps/${campId}/delete`, {}, sa)).json.success, true);
    await eventually(async () => assert.equal((await call(B, 'GET', `/api?action=poll&id=${campId}`)).status, 404));
    assert.equal((await call(B, 'POST', `/superadmin/camps/${campId}/restore`, {}, sa)).json.success, true);
    await eventually(async () => assert.equal((await call(A, 'GET', `/api?action=poll&id=${campId}`)).status, 200));
    const backup = await call(A, 'GET', `/superadmin/camps/${campId}/export`, undefined, sa);
    assert.equal(backup.json.camps[0].teams.find(t => t.id === 't_b').scoreLogs.length, 10);
    assert.equal(Object.keys(backup.json.media).length, 1);
    const imp = await call(B, 'POST', '/superadmin/import', backup.json, sa);
    assert.equal(imp.json.success, true);
    assert.notEqual(imp.json.imported[0].id, campId);
    const copy = await call(A, 'GET', `/api?action=poll&id=${imp.json.imported[0].id}`);
    assert.equal(copy.json.teams.find(t => t.id === 't_a').score, 57);
});

test('documents written by the previous version are migrated on first use', { skip }, async () => {
    const { initializeApp } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore(initializeApp({ projectId: PROJECT }, 'legacy-writer'));
    const ref = db.collection('camps').doc('legacy_camp');
    await ref.set({
        orgName: 'Old', title: 'Legacy', password: 'plain-old', campType: 'simple', locked: 0, logo: PNG,
        stages: [{ id: 's_1', name: 'S1', unit: 'points' }], users: [],
        teams: [{
            id: 't_1', name: 'One', color: '#000', image: PNG, score: 13, stageScores: { s_1: 10 }, judgeStageScores: {},
            scoreLogs: [
                { id: 'log_old1', type: 'instant', value: 5, timestamp: 1000, user: { username: 'r', profilePic: PNG } },
                { id: 'log_old2', type: 'cancelled', value: 4, timestamp: 5000 },
                { id: 'log_old3', type: 'instant', value: -2, timestamp: 3000 }
            ]
        }]
    });
    const p = await call(A, 'GET', '/api?action=poll&id=legacy_camp');
    assert.equal(p.status, 200);
    const team = p.json.teams[0];
    assert.equal(team.score, 13);
    assert.deepEqual(team.scoreLogs.map(l => l.id), ['log_old1', 'log_old2', 'log_old3']);
    assert.ok(!p.text.includes('base64'));
    const stored = (await ref.get()).data();
    assert.ok(!('scoreLogs' in stored.teams[0]));
    assert.match(stored.logo, /^\/media\//);
    assert.equal((await ref.collection('logs').get()).size, 3);
    // The other instance reads the migrated data.
    const q = await call(B, 'GET', '/api?action=poll&id=legacy_camp');
    assert.equal(q.json.teams[0].score, 13);
    assert.equal(q.headers.get('etag'), p.headers.get('etag'));
    // Legacy plain-text operator password still works (and is upgraded).
    const login = await call(B, 'POST', '/login', { id: 'legacy_camp', username: 'admin', password: 'plain-old' });
    assert.equal(login.json.success, true);
    assert.match((await ref.get()).data().password, /^scrypt\$/);
});

test('scripts/backup.mjs writes a rotated backup of the whole database', { skip }, async () => {
    const fs = await import('fs');
    const os = await import('os');
    const { spawnSync } = await import('child_process');
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'simcamp-nodebk-'));
    const env = { ...process.env, DB_ADAPTER: 'firebase', FIRESTORE_EMULATOR_HOST: EMU, GCLOUD_PROJECT: PROJECT, FIRESTORE_DATABASE_ID: '(default)', FIREBASE_SERVICE_ACCOUNT: '', GOOGLE_APPLICATION_CREDENTIALS: '' };
    for (let i = 0; i < 2; i++) {
        const r = spawnSync(process.execPath, ['scripts/backup.mjs', out, '1'], { cwd: ROOT, env });
        assert.equal(r.status, 0, String(r.stderr));
        await new Promise(res => setTimeout(res, 1100));
    }
    const files = fs.readdirSync(out);
    assert.equal(files.length, 1);
    const b = JSON.parse(fs.readFileSync(path.join(out, files[0]), 'utf8'));
    assert.ok(b.camps.some(c => c.id === campId && c.teams.find(t => t.id === 't_b').scoreLogs.length === 10));
    assert.ok(Object.keys(b.media).length >= 1);
    fs.rmSync(out, { recursive: true, force: true });
});
