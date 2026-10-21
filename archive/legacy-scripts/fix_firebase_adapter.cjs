const fs = require('fs');

// We are going to rewrite db/firebaseAdapter.js to use firebase-admin.
// Using firebase-admin allows the backend to bypass security rules which are meant for clients.

const code = `import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));

const app = initializeApp({
  credential: applicationDefault(),
  projectId: config.projectId
});

const db = getFirestore(app, config.firestoreDatabaseId || '(default)');

export default {
    async getCamp(id) {
        if (!id) return null;
        const docRef = db.collection('camps').doc(id);
        const docSnap = await docRef.get();
        if (!docSnap.exists) return null;
        const data = docSnap.data();
        data.id = id;
        if (typeof data.teams === 'object') data.teams = JSON.stringify(data.teams);
        if (typeof data.stages === 'object') data.stages = JSON.stringify(data.stages);
        if (typeof data.users === 'object') data.users = JSON.stringify(data.users);
        return data;
    },
    async updateCamp(id, data) {
        if (data.teams && typeof data.teams === 'string') data.teams = JSON.parse(data.teams);
        if (data.stages && typeof data.stages === 'string') data.stages = JSON.parse(data.stages);
        if (data.users && typeof data.users === 'string') data.users = JSON.parse(data.users);
        
        await db.collection('camps').doc(id).set(data, { merge: true });
    },
    async getSetting(key) {
        const docSnap = await db.collection('settings').doc(key).get();
        return docSnap.exists ? docSnap.data().value : null;
    },
    async setSetting(key, value) {
        await db.collection('settings').doc(key).set({ value });
    },
    async getAllCamps() {
        const snap = await db.collection('camps').get();
        return snap.docs.map(d => {
            const data = d.data();
            return { 
                 id: d.id, 
                 orgName: data.orgName, 
                 title: data.title, 
                 locked: data.locked, 
                 campType: data.campType 
             };
        });
    }
};
`;

fs.writeFileSync('db/firebaseAdapter.js', code);
console.log('✅ Rewrote firebaseAdapter.js to use firebase-admin');
