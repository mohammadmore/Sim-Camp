// Run with: npm test   (Node backend with the in-memory database adapter)
import { before, after } from 'node:test';
import { registerScenarios } from './scenarios.js';

process.env.NODE_ENV = 'test';
process.env.DB_ADAPTER = 'memory';
process.env.SUPERADMIN_PASS = 'test-superadmin-pass';

const { app, initSecurity } = await import('../server.js');

let server, base;

before(async () => {
    await initSecurity();
    server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.closeAllConnections(); server.close(); });

async function call(method, path, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Auth-Token'] = token;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, json, text };
}

registerScenarios({ call, saPassword: 'test-superadmin-pass' });
