// In-memory store for local development and automated tests (DB_ADAPTER=memory).
// Data is lost when the process exits. Watchers are notified asynchronously, like Firestore snapshots.
import { EventEmitter } from 'events';
import { ConflictError, ExistsError, NotFoundError } from './errors.js';

const copy = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const later = fn => setImmediate(fn);
const delay = () => {
    // Test hook: simulate a slow database write.
    const ms = parseInt(process.env.MEMORY_DB_WRITE_DELAY_MS || '0', 10);
    return ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();
};

export function createMemoryStore() {
    const camps = new Map();     // id -> { doc, rev }
    const logs = new Map();      // id -> Map(logId -> log)
    const settings = new Map();
    const media = new Map();
    const bus = new EventEmitter();
    bus.setMaxListeners(0);

    const emitDoc = id => later(() => {
        const c = camps.get(id);
        bus.emit('doc:' + id, c ? copy(c.doc) : null, c ? c.rev : 0);
    });
    const emitLogs = (id, changes) => { if (changes.length) later(() => bus.emit('logs:' + id, copy(changes))); };

    function applyLogs(id, logSet = [], logDelete = []) {
        if (!logs.has(id)) logs.set(id, new Map());
        const m = logs.get(id);
        const changes = [];
        for (const l of logSet) { changes.push({ type: m.has(l.id) ? 'modified' : 'added', log: copy(l) }); m.set(l.id, copy(l)); }
        for (const lid of logDelete) { const old = m.get(lid); if (old) { m.delete(lid); changes.push({ type: 'removed', log: copy(old) }); } }
        emitLogs(id, changes);
    }

    return {
        info() { return { mode: 'memory', media: 'memory' }; },

        async getCampDoc(id) {
            const c = camps.get(id);
            return c ? { doc: copy(c.doc), rev: c.rev } : null;
        },
        async getCampLogs(id) {
            return [...(logs.get(id) || new Map()).values()].map(copy);
        },
        async createCamp(id, doc, campLogs = []) {
            await delay();
            if (camps.has(id)) throw new ExistsError();
            camps.set(id, { doc: copy(doc), rev: 1 });
            logs.set(id, new Map());
            applyLogs(id, campLogs, []);
            emitDoc(id);
            return 1;
        },
        async commit(id, { expectedRev, docChanges = {}, logSet = [], logDelete = [] }) {
            await delay();
            const c = camps.get(id);
            if (!c) throw new NotFoundError();
            let rev = c.rev;
            if (Object.keys(docChanges).length) {
                if (expectedRev !== undefined && c.rev !== expectedRev) throw new ConflictError();
                for (const [k, v] of Object.entries(docChanges)) if (v !== undefined) c.doc[k] = copy(v);
                c.rev = rev = c.rev + 1;
                emitDoc(id);
            }
            applyLogs(id, logSet, logDelete);
            return rev;
        },
        async deleteCamp(id) {
            await delay();
            camps.delete(id);
            logs.delete(id);
            emitDoc(id);
        },
        async listCamps(fields) {
            return [...camps.entries()].map(([id, c]) => {
                const out = { id };
                for (const f of fields) if (c.doc[f] !== undefined) out[f] = copy(c.doc[f]);
                return out;
            });
        },
        watchCamp(id, { onDoc, onLogs }) {
            const d = (doc, rev) => onDoc(doc, rev);
            const l = changes => onLogs(changes);
            bus.on('doc:' + id, d);
            bus.on('logs:' + id, l);
            return () => { bus.off('doc:' + id, d); bus.off('logs:' + id, l); };
        },

        async getSetting(key) { return settings.has(key) ? copy(settings.get(key)) : null; },
        async setSetting(key, value) { settings.set(key, copy(value)); },
        async createSettingIfAbsent(key, value) {
            if (!settings.has(key)) settings.set(key, copy(value));
            return copy(settings.get(key));
        },

        async putMedia(name, data, contentType) { media.set(name, { data: Buffer.from(data), contentType }); },
        async getMedia(name) { return media.get(name) || null; }
    };
}
