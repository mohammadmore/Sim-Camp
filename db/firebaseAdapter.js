import { initializeApp } from 'firebase/app';
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
        if (typeof data.positiveTags === 'string') try { data.positiveTags = JSON.parse(data.positiveTags); } catch(e){}
        if (typeof data.negativeTags === 'string') try { data.negativeTags = JSON.parse(data.negativeTags); } catch(e){}
        if (typeof data.fieldJudgingValues === 'string') try { data.fieldJudgingValues = JSON.parse(data.fieldJudgingValues); } catch(e){}
        return data;
    },
    async updateCamp(id, data) {
        if (data.teams && typeof data.teams === 'string') data.teams = JSON.parse(data.teams);
        if (data.stages && typeof data.stages === 'string') data.stages = JSON.parse(data.stages);
        if (data.users && typeof data.users === 'string') data.users = JSON.parse(data.users);
        if (data.positiveTags && typeof data.positiveTags === 'string') try { data.positiveTags = JSON.parse(data.positiveTags); } catch(e){}
        if (data.negativeTags && typeof data.negativeTags === 'string') try { data.negativeTags = JSON.parse(data.negativeTags); } catch(e){}
        if (data.fieldJudgingValues && typeof data.fieldJudgingValues === 'string') try { data.fieldJudgingValues = JSON.parse(data.fieldJudgingValues); } catch(e){}
        
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
                 campType: data.campType,
                 archived: data.archived || false
             };
        });
    }
};
