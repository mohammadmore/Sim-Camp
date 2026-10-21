// Runs the shared API scenarios against cpanel_export/api.php using PHP's built-in server and SQLite.
// Skipped automatically when the php CLI is not installed.
import { before, after, test } from 'node:test';
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
        '/api/scores/reset': 'scores_reset', '/superadmin/id_available': 'superadmin_id_available', '/api/board': 'board', '/api/finish': 'finish', '/api/audit': 'audit'
    };
    let m;
    if (map[route]) params.set('action', map[route]);
    else if ((m = route.match(/^\/superadmin\/camps\/([^/]+)\/(lock|archive|delete|duplicate)$/))) { params.set('action', `superadmin_camp_${m[2]}`); params.set('id', m[1]); }
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

    registerScenarios({ call, saPassword: SA_PASSWORD });
}
