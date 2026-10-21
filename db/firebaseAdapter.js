import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase-applet-config.json'), 'utf8'));

// Stored as JSON-compatible values; undefined values are not allowed by Firestore.
function clean(data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
        if (v !== undefined) out[k] = JSON.parse(JSON.stringify(v));
    }
    return out;
}

function loadServiceAccount() {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return 'applicationDefault';
    return null;
}

// Preferred: Admin SDK with a service account. It bypasses security rules, so
// firestore.rules can deny all direct client access.
async function createAdminDb(serviceAccount) {
    const { initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const app = initializeApp({
        credential: serviceAccount === 'applicationDefault' ? applicationDefault() : cert(serviceAccount),
        projectId: config.projectId
    });
    const db = getFirestore(app, config.firestoreDatabaseId || '(default)');
    return {
        async get(col, id) {
            const snap = await db.collection(col).doc(id).get();
            return snap.exists ? snap.data() : null;
        },
        // mergeFields replaces each given top-level field entirely (no deep merge of maps),
        // so keys deleted from closedStages / stageTieredResults really disappear.
        async set(col, id, data) {
            const d = clean(data);
            await db.collection(col).doc(id).set(d, { mergeFields: Object.keys(d) });
        },
        async list(col, fields) {
            const ref = db.collection(col);
            const snap = await (fields ? ref.select(...fields) : ref).get();
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
    };
}

// Fallback: Web SDK. Only works while firestore.rules allow access, which is insecure.
async function createClientDb() {
    const { initializeApp } = await import('firebase/app');
    const { getFirestore, doc, setDoc, getDoc, collection, getDocs, setLogLevel } = await import('firebase/firestore');
    setLogLevel('silent');
    const db = getFirestore(initializeApp(config), config.firestoreDatabaseId);
    return {
        async get(col, id) {
            const snap = await getDoc(doc(db, col, id));
            return snap.exists() ? snap.data() : null;
        },
        async set(col, id, data) {
            const d = clean(data);
            await setDoc(doc(db, col, id), d, { mergeFields: Object.keys(d) });
        },
        async list(col) {
            const snap = await getDocs(collection(db, col));
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
    };
}

let dbPromise = null;
function getDb() {
    if (!dbPromise) {
        const sa = loadServiceAccount();
        if (sa) {
            dbPromise = createAdminDb(sa);
        } else {
            console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT is not set: falling back to the Firebase Web SDK. '
                + 'This requires open Firestore rules and is NOT secure. See README.');
            dbPromise = createClientDb();
        }
    }
    return dbPromise;
}

export default {
    async getCamp(id) {
        if (!id) return null;
        const data = await (await getDb()).get('camps', id);
        return data ? { ...data, id } : null;
    },
    async updateCamp(id, data) {
        await (await getDb()).set('camps', id, data);
    },
    async getSetting(key) {
        const data = await (await getDb()).get('settings', key);
        return data ? data.value : null;
    },
    async setSetting(key, value) {
        await (await getDb()).set('settings', key, { value });
    },
    // Only the fields shown in the superadmin camp list (avoids downloading every team image).
    async getAllCamps() {
        return (await getDb()).list('camps', ['orgName', 'title', 'locked', 'campType', 'archived']);
    }
};
