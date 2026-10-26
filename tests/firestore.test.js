// The shared API scenarios on the Firestore store (emulator). Skipped unless FIRESTORE_EMULATOR_HOST is set.
import { test, before, after } from 'node:test';
import { registerScenarios } from './scenarios.js';
import { registerFeatureScenarios } from './scenarios2.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
let server, base;

if (!EMU) {
    test('Firestore scenarios (skipped: FIRESTORE_EMULATOR_HOST is not set)', { skip: true }, () => {});
} else {
    process.env.NODE_ENV = 'test';
    process.env.DB_ADAPTER = 'firebase';
    process.env.GCLOUD_PROJECT = 'sim-camp-scen-' + Date.now();
    process.env.FIRESTORE_DATABASE_ID = '(default)';
    process.env.SUPERADMIN_PASS = 'fs-superadmin-pass';
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const { app, initSecurity } = await import('../server.js');

    before(async () => {
        await initSecurity();
        server = app.listen(0);
        await new Promise(r => server.once('listening', r));
        base = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => { server.closeAllConnections(); server.close(); setTimeout(() => process.exit(0), 200).unref(); });

    const call = async (method, path, body, token) => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['X-Auth-Token'] = token;
        const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* not json */ }
        return { status: res.status, json, text };
    };
    const opts = { call, raw: (url, init) => fetch(base + url, init), saPassword: 'fs-superadmin-pass', mediaRe: /^\/media\/[a-f0-9]{32}\.png$/ };
    registerScenarios(opts);
    registerFeatureScenarios(opts);
}
