// Chooses the storage backend (DB_ADAPTER, default firebase) and exports one store object.
// Store API (see memoryStore.js for the reference implementation):
//   info(), getCampDoc(id) -> {doc, rev} | null, getCampLogs(id), createCamp(id, doc, logs),
//   commit(id, {expectedRev, docChanges, logSet, logDelete}) -> rev, deleteCamp(id), listCamps(fields),
//   watchCamp(id, {onDoc, onLogs, onError}) -> unsubscribe, getSetting(key), setSetting(key, value),
//   createSettingIfAbsent(key, value) -> stored value, putMedia(name, data, type), getMedia(name)
import { createMemoryStore } from './memoryStore.js';

export const adapterName = process.env.DB_ADAPTER || 'firebase';

async function load() {
    if (adapterName === 'memory') return createMemoryStore();
    if (adapterName === 'firebase') return (await import('./firestoreStore.js')).createFirestoreStore();
    if (adapterName === 'sql') return (await import('./sqlStore.js')).createSqlStore();
    throw new Error(`Unknown DB_ADAPTER: ${adapterName}`);
}

export const store = await load();
console.log(`📦 Database adapter: ${adapterName}`);

export { ConflictError, ExistsError, NotFoundError } from './errors.js';
