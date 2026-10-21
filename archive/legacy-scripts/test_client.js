import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function test() {
    try {
        const snap = await getDocs(collection(db, 'camps'));
        console.log("Success! Docs:", snap.docs.length);
    } catch(e) {
        console.error("Error:", e.message);
    }
}
test();
