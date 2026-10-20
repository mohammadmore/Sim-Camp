import firebaseAdapter from './firebaseAdapter.js';
import sqlAdapter from './sqlAdapter.js';

// Choose adapter based on environment variable (default to firebase)
const adapterName = process.env.DB_ADAPTER || 'firebase';

let dbAdapter;

if (adapterName === 'firebase') {
    dbAdapter = firebaseAdapter;
    console.log('📦 Database initialized using: Firebase Firestore');
} else if (adapterName === 'sql') {
    dbAdapter = sqlAdapter;
    console.log('📦 Database initialized using: SQL Database');
} else {
    throw new Error(`Unknown DB_ADAPTER: ${adapterName}`);
}

export const getCamp = dbAdapter.getCamp;
export const updateCamp = dbAdapter.updateCamp;
export const getSetting = dbAdapter.getSetting;
export const setSetting = dbAdapter.setSetting;
export const getAllCamps = dbAdapter.getAllCamps;
