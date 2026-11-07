// Firestore store.
//  - camps/{id}            camp definition + stage scores (small, changes rarely) with a revision number
//  - camps/{id}/logs/{id}  one document per instant score (high write rate, never rewrites the camp)
//  - settings/{key}
//  - media: images in Firebase Storage (media/<name>), or in the Firestore "media" collection when
//    Storage is unavailable / in Web-SDK mode.
// Two drivers: Admin SDK (service account, bypasses security rules) and the Web SDK fallback.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ConflictError, ExistsError, NotFoundError } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let config;
try {
    config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase-applet-config.json'), 'utf8'));
} catch (e) {
    throw new Error('firebase-applet-config.json is missing or invalid: ' + e.message);
}

const BATCH_LIMIT = 400;

// Firestore reserves field names like __name__ (e.g. the "__override__" judge key): they are
// stored as ~__name__~ and restored when read.
const RESERVED_RE = /^__.*__$/;
const ESCAPED_RE = /^~__.*__~$/;
function mapKeys(v, fn) {
    if (Array.isArray(v)) return v.map(x => mapKeys(x, fn));
    if (v && typeof v === 'object' && v.constructor === Object) {
        const out = {};
        for (const [k, x] of Object.entries(v)) out[fn(k)] = mapKeys(x, fn);
        return out;
    }
    return v;
}
const encodeKeys = v => mapKeys(v, k => (RESERVED_RE.test(k) ? '~' + k + '~' : k));
const decode = v => mapKeys(v, k => (ESCAPED_RE.test(k) ? k.slice(1, -1) : k));

// Firestore rejects undefined values.
function clean(data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) if (v !== undefined) out[k] = encodeKeys(JSON.parse(JSON.stringify(v)));
    return out;
}

function loadServiceAccount() {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return 'applicationDefault';
    if (process.env.FIRESTORE_EMULATOR_HOST) return 'emulator';
    return null;
}

export function firestoreMode() {
    try { return loadServiceAccount() ? 'admin' : 'web'; } catch (e) { return 'web'; }
}

// ---------------------------------------------------------------------------
// Drivers: the same small set of operations for both SDKs
// ---------------------------------------------------------------------------
async function adminDriver(sa) {
    const { initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const options = { projectId: process.env.GCLOUD_PROJECT || config.projectId };
    if (sa === 'applicationDefault') options.credential = applicationDefault();
    else if (sa !== 'emulator') options.credential = cert(sa);
    const app = initializeApp(options, 'sim-camp-' + Date.now());
    const db = getFirestore(app, process.env.FIRESTORE_DATABASE_ID || config.firestoreDatabaseId || '(default)');
    let bucket = null;
    try {
        const { getStorage } = await import('firebase-admin/storage');
        const name = process.env.FIREBASE_STORAGE_BUCKET || config.storageBucket;
        if (name && sa !== 'emulator') bucket = getStorage(app).bucket(name);
    } catch (e) { bucket = null; }

    const campRef = id => db.collection('camps').doc(id);
    return {
        bucket,
        async getDoc(col, id) { const s = await db.collection(col).doc(id).get(); return s.exists ? decode(s.data()) : null; },
        async setDoc(col, id, data) { const d = clean(data); await db.collection(col).doc(id).set(d, { mergeFields: Object.keys(d) }); },
        async getLogs(id) { const s = await campRef(id).collection('logs').get(); return s.docs.map(d => ({ ...decode(d.data()), id: d.id })); },
        async list(fields) { const s = await db.collection('camps').select(...fields).get(); return s.docs.map(d => ({ id: d.id, ...decode(d.data()) })); },
        async transact(id, fn) {
            return db.runTransaction(async tx => {
                const snap = await tx.get(campRef(id));
                return fn(snap.exists ? decode(snap.data()) : null, {
                    setCamp: (data, fields) => tx.set(campRef(id), data, { mergeFields: fields }),
                    createCamp: data => tx.set(campRef(id), data),
                    setLog: log => { const { id: lid, ...rest } = log; tx.set(campRef(id).collection('logs').doc(lid), clean(rest)); },
                    deleteLog: lid => tx.delete(campRef(id).collection('logs').doc(lid))
                });
            });
        },
        async batchLogs(id, logSet, logDelete) {
            const ops = [...logSet.map(l => ['set', l]), ...logDelete.map(l => ['del', l])];
            for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
                const b = db.batch();
                for (const [op, v] of ops.slice(i, i + BATCH_LIMIT)) {
                    if (op === 'set') { const { id: lid, ...rest } = v; b.set(campRef(id).collection('logs').doc(lid), clean(rest)); }
                    else b.delete(campRef(id).collection('logs').doc(v));
                }
                await b.commit();
            }
        },
        async deleteCamp(id) {
            const logs = await campRef(id).collection('logs').get();
            for (let i = 0; i < logs.docs.length; i += BATCH_LIMIT) {
                const b = db.batch();
                logs.docs.slice(i, i + BATCH_LIMIT).forEach(d => b.delete(d.ref));
                await b.commit();
            }
            await campRef(id).delete();
        },
        watch(id, onDoc, onLogs, onError) {
            const u1 = campRef(id).onSnapshot(s => onDoc(s.exists ? decode(s.data()) : null), onError);
            const u2 = campRef(id).collection('logs').onSnapshot(qs => onLogs(qs.docChanges().map(c => ({ type: c.type, log: { ...decode(c.doc.data()), id: c.doc.id } }))), onError);
            return () => { u1(); u2(); };
        },
        async createDocIfAbsent(col, id, data) {
            const ref = db.collection(col).doc(id);
            return db.runTransaction(async tx => {
                const s = await tx.get(ref);
                if (s.exists) return s.data();
                tx.set(ref, clean(data));
                return clean(data);
            });
        },
        async putMediaDoc(name, data, contentType) { await db.collection('media').doc(name).set({ data: Buffer.from(data), contentType }); },
        async getMediaDoc(name) {
            const s = await db.collection('media').doc(name).get();
            if (!s.exists) return null;
            const d = s.data();
            return { data: Buffer.from(d.data), contentType: d.contentType };
        }
    };
}

async function webDriver() {
    const { initializeApp } = await import('firebase/app');
    const F = await import('firebase/firestore');
    F.setLogLevel('silent');
    const db = F.getFirestore(initializeApp(config, 'sim-camp-' + Date.now()), config.firestoreDatabaseId);
    const campRef = id => F.doc(db, 'camps', id);
    const logRef = (id, lid) => F.doc(db, 'camps', id, 'logs', lid);
    return {
        bucket: null,
        async getDoc(col, id) { const s = await F.getDoc(F.doc(db, col, id)); return s.exists() ? decode(s.data()) : null; },
        async setDoc(col, id, data) { const d = clean(data); await F.setDoc(F.doc(db, col, id), d, { mergeFields: Object.keys(d) }); },
        async getLogs(id) { const s = await F.getDocs(F.collection(db, 'camps', id, 'logs')); return s.docs.map(d => ({ ...decode(d.data()), id: d.id })); },
        async list(fields) {
            const s = await F.getDocs(F.collection(db, 'camps'));
            return s.docs.map(d => { const data = decode(d.data()); const out = { id: d.id }; fields.forEach(f => { if (data[f] !== undefined) out[f] = data[f]; }); return out; });
        },
        async transact(id, fn) {
            return F.runTransaction(db, async tx => {
                const snap = await tx.get(campRef(id));
                return fn(snap.exists() ? decode(snap.data()) : null, {
                    setCamp: (data, fields) => tx.set(campRef(id), data, { mergeFields: fields }),
                    createCamp: data => tx.set(campRef(id), data),
                    setLog: log => { const { id: lid, ...rest } = log; tx.set(logRef(id, lid), clean(rest)); },
                    deleteLog: lid => tx.delete(logRef(id, lid))
                });
            });
        },
        async batchLogs(id, logSet, logDelete) {
            const ops = [...logSet.map(l => ['set', l]), ...logDelete.map(l => ['del', l])];
            for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
                const b = F.writeBatch(db);
                for (const [op, v] of ops.slice(i, i + BATCH_LIMIT)) {
                    if (op === 'set') { const { id: lid, ...rest } = v; b.set(logRef(id, lid), clean(rest)); } else b.delete(logRef(id, v));
                }
                await b.commit();
            }
        },
        async deleteCamp(id) {
            const logs = await F.getDocs(F.collection(db, 'camps', id, 'logs'));
            for (let i = 0; i < logs.docs.length; i += BATCH_LIMIT) {
                const b = F.writeBatch(db);
                logs.docs.slice(i, i + BATCH_LIMIT).forEach(d => b.delete(d.ref));
                await b.commit();
            }
            await F.deleteDoc(campRef(id));
        },
        watch(id, onDoc, onLogs, onError) {
            const u1 = F.onSnapshot(campRef(id), s => onDoc(s.exists() ? decode(s.data()) : null), onError);
            const u2 = F.onSnapshot(F.collection(db, 'camps', id, 'logs'), qs => onLogs(qs.docChanges().map(c => ({ type: c.type, log: { ...decode(c.doc.data()), id: c.doc.id } }))), onError);
            return () => { u1(); u2(); };
        },
        async createDocIfAbsent(col, id, data) {
            const ref = F.doc(db, col, id);
            return F.runTransaction(db, async tx => {
                const s = await tx.get(ref);
                if (s.exists()) return s.data();
                tx.set(ref, clean(data));
                return clean(data);
            });
        },
        async putMediaDoc(name, data, contentType) { await F.setDoc(F.doc(db, 'media', name), { data: F.Bytes.fromUint8Array(new Uint8Array(data)), contentType }); },
        async getMediaDoc(name) {
            const s = await F.getDoc(F.doc(db, 'media', name));
            if (!s.exists()) return null;
            const d = s.data();
            return { data: Buffer.from(d.data.toUint8Array()), contentType: d.contentType };
        }
    };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
export function createFirestoreStore() {
    let driverPromise = null;
    let mediaBackend = process.env.MEDIA_BACKEND || null; // 'storage' | 'firestore'
    const driver = () => {
        if (!driverPromise) {
            const sa = loadServiceAccount();
            if (!sa) console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT is not set: falling back to the Firebase Web SDK. This requires open Firestore rules and is NOT secure. See README.');
            driverPromise = sa ? adminDriver(sa) : webDriver();
        }
        return driverPromise;
    };

    return {
        info() { return { mode: firestoreMode(), media: mediaBackend || (firestoreMode() === 'admin' ? 'storage' : 'firestore') }; },

        async getCampDoc(id) {
            const doc = await (await driver()).getDoc('camps', id);
            if (!doc) return null;
            const { rev = 0, ...rest } = doc;
            return { doc: rest, rev };
        },
        async getCampLogs(id) { return (await driver()).getLogs(id); },

        async createCamp(id, doc, logs = []) {
            const d = await driver();
            const small = logs.length <= BATCH_LIMIT;
            await d.transact(id, (existing, tx) => {
                if (existing) throw new ExistsError();
                tx.createCamp({ ...clean(doc), rev: 1 });
                if (small) logs.forEach(l => tx.setLog(l));
            });
            if (!small) await d.batchLogs(id, logs, []);
            return 1;
        },

        // Optimistic concurrency: the camp document is written only if nobody changed it since expectedRev.
        async commit(id, { expectedRev, docChanges = {}, logSet = [], logDelete = [] }) {
            const d = await driver();
            const fields = Object.keys(clean(docChanges));
            if (!fields.length) {
                await d.batchLogs(id, logSet, logDelete);
                return expectedRev;
            }
            const inTx = logSet.length + logDelete.length <= BATCH_LIMIT;
            const rev = await d.transact(id, (existing, tx) => {
                if (!existing) throw new NotFoundError();
                const cur = existing.rev || 0;
                if (expectedRev !== undefined && cur !== expectedRev) throw new ConflictError();
                tx.setCamp({ ...clean(docChanges), rev: cur + 1 }, [...fields, 'rev']);
                if (inTx) { logSet.forEach(l => tx.setLog(l)); logDelete.forEach(l => tx.deleteLog(l)); }
                return cur + 1;
            });
            if (!inTx) await d.batchLogs(id, logSet, logDelete);
            return rev;
        },

        async deleteCamp(id) { await (await driver()).deleteCamp(id); },
        async listCamps(fields) { return (await driver()).list(fields); },

        watchCamp(id, { onDoc, onLogs, onError = () => {} }) {
            let stop = null, stopped = false;
            const fail = e => { console.error('[watch]', id, e && e.message); if (!stopped) onError(e); };
            driver().then(d => {
                if (stopped) return;
                stop = d.watch(id, raw => {
                    if (!raw) return onDoc(null, 0);
                    const { rev = 0, ...rest } = raw;
                    onDoc(rest, rev);
                }, onLogs, fail);
            }, fail);
            return () => { stopped = true; if (stop) stop(); };
        },

        async getSetting(key) { const d = await (await driver()).getDoc('settings', key); return d ? d.value : null; },
        async setSetting(key, value) { await (await driver()).setDoc('settings', key, { value }); },
        // Used for values every server instance must share (session secret, generated password).
        async createSettingIfAbsent(key, value) { return (await (await driver()).createDocIfAbsent('settings', key, { value })).value; },

        // Images: Firebase Storage when available, otherwise one Firestore document per image.
        async putMedia(name, data, contentType) {
            const d = await driver();
            if (mediaBackend !== 'firestore' && d.bucket) {
                try {
                    await d.bucket.file('media/' + name).save(Buffer.from(data), { contentType, resumable: false, metadata: { cacheControl: 'public, max-age=31536000, immutable' } });
                    mediaBackend = 'storage';
                    return;
                } catch (e) {
                    console.warn(`⚠️  Firebase Storage unavailable (${e.message}); storing images in Firestore instead.`);
                    mediaBackend = 'firestore';
                }
            }
            await d.putMediaDoc(name, data, contentType);
        },
        async getMedia(name) {
            const d = await driver();
            if (d.bucket) {
                try {
                    const [buf] = await d.bucket.file('media/' + name).download();
                    return { data: buf, contentType: null };
                } catch (e) { /* not in Storage: try Firestore */ }
            }
            return d.getMediaDoc(name);
        }
    };
}
