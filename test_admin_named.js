import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const app = initializeApp({
    credential: applicationDefault(),
    projectId: config.projectId
});
const db = getFirestore(app, config.firestoreDatabaseId);

async function test() {
    try {
        const snap = await db.collection('camps').get();
        console.log("Success with named DB! Docs:", snap.docs.length);
    } catch(e) {
        console.error("Error with named DB:", e.message);
    }
}
test();
