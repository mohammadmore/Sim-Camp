const fs = require('fs');

const code = `import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, setLogLevel } from 'firebase/firestore';
setLogLevel('silent');
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
// Make sure to ignore undefined properties to fix the excel undefined bug
const db = getFirestore(app, config.firestoreDatabaseId);

export default {
    async getCamp(id) {
        if (!id) return null;
        const docRef = doc(db, 'camps', id);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return null;
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
        
        // Remove undefined values to avoid Firebase Client errors
        Object.keys(data).forEach(key => {
            if (data[key] === undefined) {
                delete data[key];
            }
        });
        
        await setDoc(doc(db, 'camps', id), data, { merge: true });
    },
    async getSetting(key) {
        const docSnap = await getDoc(doc(db, 'settings', key));
        return docSnap.exists() ? docSnap.data().value : null;
    },
    async setSetting(key, value) {
        await setDoc(doc(db, 'settings', key), { value });
    },
    async getAllCamps() {
        const snap = await getDocs(collection(db, 'camps'));
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
console.log('✅ Restored Firebase Client SDK and cleaned undefined values');
