// Choose adapter based on environment variable (default to firebase)
const adapterName = process.env.DB_ADAPTER || 'firebase';

const loaders = {
    firebase: () => import('./firebaseAdapter.js'),
    sql: () => import('./sqlAdapter.js'),
    memory: () => import('./memoryAdapter.js')
};

if (!loaders[adapterName]) throw new Error(`Unknown DB_ADAPTER: ${adapterName}`);
const dbAdapter = (await loaders[adapterName]()).default;
console.log(`📦 Database adapter: ${adapterName}`);

export const getCamp = dbAdapter.getCamp;
export const updateCamp = dbAdapter.updateCamp;
export const getSetting = dbAdapter.getSetting;
export const setSetting = dbAdapter.setSetting;
export const getAllCamps = dbAdapter.getAllCamps;
export const deleteCamp = dbAdapter.deleteCamp;
export const adapterInfo = () => (typeof dbAdapter.info === 'function' ? dbAdapter.info() : { mode: adapterName });
