// Runs the shared API scenarios against cpanel_export/api.php using PHP's built-in server and SQLite.
// Skipped automatically when the php CLI is not installed.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerScenarios } from './scenarios.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const hasPhp = spawnSync('php', ['-v']).status === 0;
const SA_PASSWORD = 'php-superadmin-pass';

let proc, base, dir;

// Node route -> PHP action URL
function phpPath(method, p) {
    const [route, qs = ''] = p.split('?');
    const params = new URLSearchParams(qs);
    const map = {
        '/api/settings': 'settings', '/superadmin/login': 'superadmin_login', '/superadmin/camps': 'superadmin_camps',
        '/setup': 'setup', '/login': 'login', '/api/instant': 'instant', '/api/undo_instant': 'undo_instant',
        '/api/judge_stage_score': 'judge_stage_score', '/api/stage_scores': 'stage_scores', '/api/team_logs': 'team_logs',
        '/api/stage/close_tiered': 'close_tiered', '/api/user/profile-pic': 'user_profile_pic',
        '/superadmin/password': 'superadmin_password', '/api/user/password': 'user_password',
        '/api/users/reset_password': 'users_reset_password', '/api/users': 'users', '/api/stage/reset': 'stage_reset',
        '/api/scores/reset': 'scores_reset', '/superadmin/id_available': 'superadmin_id_available', '/api/board': 'board', '/api/finish': 'finish', '/api/audit': 'audit',
        '/superadmin/trash': 'superadmin_trash', '/superadmin/backup': 'superadmin_backup', '/superadmin/import': 'superadmin_import'
    };
    let m;
    if (map[route]) params.set('action', map[route]);
    else if ((m = route.match(/^\/superadmin\/camps\/([^/]+)\/(lock|archive|delete|duplicate|restore|purge|export)$/))) { params.set('action', `superadmin_camp_${m[2]}`); params.set('id', m[1]); }
    else if ((m = route.match(/^\/superadmin\/camps\/([^/]+)$/))) { params.set('action', 'superadmin_camp'); params.set('id', m[1]); }
    else if (route === '/api' && method === 'POST') params.set('action', 'update_camp');
    return `/api.php?${params.toString()}`;
}

async function call(method, p, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Auth-Token'] = token;
    const res = await fetch(base + phpPath(method, p), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, json, text };
}

// URLs found in the state (media links are relative to the site root in the PHP edition).
const raw = (url, init) => fetch(base + (url.startsWith('/') ? url : '/' + url), init);

if (!hasPhp) {
    test('PHP backend (skipped: php CLI not installed)', { skip: true }, () => {});
} else {
    before(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simcamp-php-'));
        fs.cpSync(path.join(ROOT, 'cpanel_export'), dir, { recursive: true });
        fs.rmSync(path.join(dir, 'data'), { recursive: true, force: true });
        const port = 18000 + Math.floor(Math.random() * 2000);
        base = `http://127.0.0.1:${port}`;
        proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', dir], { stdio: 'ignore', env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4' } });
        for (let i = 0; i < 50; i++) {
            try { await fetch(base + '/favicon.svg'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); }
        }
        // First-run: choose the superadmin password.
        const form = new URLSearchParams({ password: SA_PASSWORD, password2: SA_PASSWORD });
        await fetch(base + '/setup_db.php', { method: 'POST', body: form });
    });

    after(() => {
        proc.kill();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('the old default password admin123 is rejected', async () => {
        const r = await call('POST', '/superadmin/login', { password: 'admin123' });
        if (r.json.success !== false) throw new Error('default password accepted');
    });

    registerScenarios({ call, raw, pollUrl: id => `/api.php?action=poll&id=${id}`, saPassword: SA_PASSWORD, mediaRe: /^media\.php\?f=[a-f0-9]{32}\.png$/ });

    test('health check reports the database', async () => {
        const r = await fetch(base + '/api.php?action=health');
        assert.equal(r.status, 200);
        const j = await r.json();
        assert.equal(j.status, 'ok');
        assert.equal(j.db.driver, 'sqlite');
    });

    test('oversized bodies are rejected with 413 before reaching the database', async () => {
        const r = await fetch(base + '/api.php?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'x', username: 'u', password: 'p'.repeat(300 * 1024) }) });
        assert.equal(r.status, 413);
    });

    test('a write blocked by another writer fails with 503 instead of hanging', { timeout: 30000 }, async () => {
        const sa = (await call('POST', '/superadmin/login', { password: SA_PASSWORD })).json.token;
        const c = await call('POST', '/setup', { orgName: 'o', title: 't', password: 'oppass', teams: [{ id: 't_1', name: 'A' }], stages: [{ id: 's_1', name: 'S' }], users: [] }, sa);
        const op = (await call('POST', '/login', { id: c.json.campId, username: 'admin', password: 'oppass' })).json.token;
        // Another process holds the SQLite write lock for 14 s.
        const holder = spawn('php', ['-r', `$db = new PDO('sqlite:${path.join(dir, 'data', 'simul_camp.sqlite')}'); $db->exec('BEGIN IMMEDIATE'); echo "locked\n"; sleep(14); $db->exec('ROLLBACK');`]);
        await new Promise(r => holder.stdout.once('data', r));
        const t0 = Date.now();
        const r = await call('POST', `/api/instant?id=${c.json.campId}`, { teamId: 't_1', delta: 1 }, op);
        const took = Date.now() - t0;
        holder.kill();
        assert.equal(r.status, 503);
        assert.ok(took < 13000, `gave up after ${took} ms`);
    });

    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    test('camps saved with embedded images are converted to files on first use', async () => {
        const sa = (await call('POST', '/superadmin/login', { password: SA_PASSWORD })).json.token;
        const c = await call('POST', '/setup', { orgName: 'o', title: 'legacy', password: 'oppass', teams: [{ id: 't_1', name: 'A' }], stages: [{ id: 's_1', name: 'S' }], users: [] }, sa);
        const db = path.join(dir, 'data', 'simul_camp.sqlite');
        const teams = JSON.stringify([{ id: 't_1', name: 'A', image: PNG, scoreLogs: [{ id: 'log_x', type: 'instant', value: 2, timestamp: 1, user: { username: 'u', profilePic: PNG } }] }]);
        const r = spawnSync('php', ['-r', `$db = new PDO('sqlite:${db}'); $s = $db->prepare('UPDATE camps SET logo = ?, teams = ? WHERE id = ?'); $s->execute([$argv[1], $argv[2], $argv[3]]);`, PNG, teams, c.json.campId]);
        assert.equal(r.status, 0, String(r.stderr));
        const poll = await call('GET', `/api?action=poll&id=${c.json.campId}`);
        assert.ok(!poll.text.includes('base64'));
        assert.match(poll.json.logo, /^media\.php\?f=/);
        assert.equal(poll.json.teams[0].score, 2);
        const stored = spawnSync('php', ['-r', `$db = new PDO('sqlite:${db}'); echo $db->query("SELECT logo || teams FROM camps WHERE id = '${c.json.campId}'")->fetchColumn();`]);
        assert.ok(!String(stored.stdout).includes('data:image'));
    });

    test('a backup made by the Node edition can be restored here', async () => {
        const sa = (await call('POST', '/superadmin/login', { password: SA_PASSWORD })).json.token;
        const name = 'f6c4b8d9a4d4a6a2e1f2e9a4f2d6c0b1.png';
        const bytes = Buffer.from(PNG.split(',')[1], 'base64');
        const real = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex').slice(0, 32) + '.png';
        const backup = {
            format: 'sim-camp-backup', version: 1, source: 'node', camps: [{
                id: 'from-node', title: 'Node camp', orgName: 'N', password: 'scrypt$abc$def', logo: '/media/' + real,
                teams: [{ id: 't_1', name: 'A', image: '/media/' + real, stageScores: { s_1: 4 }, judgeStageScores: {}, scoreLogs: [{ id: 'log_1', type: 'instant', value: 3, timestamp: 5, createdAt: 5 }] }],
                stages: [{ id: 's_1', name: 'S' }], users: [], closedStages: {}, stageTieredResults: {}
            }],
            media: { [real]: bytes.toString('base64'), [name]: 'AAAA' }, settings: {}
        };
        const r = await call('POST', '/superadmin/import', backup, sa);
        assert.equal(r.json.success, true);
        assert.equal(r.json.foreignPasswords, true);
        assert.equal(r.json.media, 1); // the corrupted image is skipped
        const poll = await call('GET', `/api?action=poll&id=${r.json.imported[0].id}`);
        assert.equal(poll.json.teams[0].score, 7);
        assert.equal(poll.json.logo, 'media.php?f=' + real);
        assert.equal((await raw(poll.json.logo)).status, 200);
        // The Node password hash is never accepted as a plain-text password.
        assert.equal((await call('POST', '/login', { id: r.json.imported[0].id, username: 'admin', password: 'scrypt$abc$def' })).json.success, false);
    });

    test('backup.php writes rotated backup files from the command line', () => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'simcamp-bk-'));
        for (let i = 0; i < 3; i++) {
            const r = spawnSync('php', [path.join(dir, 'backup.php'), out, '2']);
            assert.equal(r.status, 0, String(r.stderr) + String(r.stdout));
            spawnSync('sleep', ['1']);
        }
        const files = fs.readdirSync(out);
        assert.equal(files.length, 2);
        const b = JSON.parse(fs.readFileSync(path.join(out, files[0]), 'utf8'));
        assert.equal(b.format, 'sim-camp-backup');
        assert.ok(b.camps.length > 3);
        fs.rmSync(out, { recursive: true, force: true });
        const web = spawnSync('php', ['-r', 'echo 1;']); // sanity
        assert.equal(web.status, 0);
    });

    test('backup.php refuses web requests', async () => {
        const r = await fetch(base + '/backup.php');
        assert.equal(r.status, 403);
    });
}
