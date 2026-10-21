// In-memory adapter for local development and automated tests (DB_ADAPTER=memory).
// Data is lost when the process exits.
const camps = new Map();
const settings = new Map();
const copy = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export default {
    async getCamp(id) {
        if (!id || !camps.has(id)) return null;
        return { ...copy(camps.get(id)), id };
    },
    async updateCamp(id, data) {
        const cur = camps.get(id) || {};
        for (const [k, v] of Object.entries(data)) if (v !== undefined) cur[k] = copy(v);
        camps.set(id, cur);
    },
    async getSetting(key) {
        return settings.has(key) ? copy(settings.get(key)) : null;
    },
    async setSetting(key, value) {
        settings.set(key, copy(value));
    },
    async deleteCamp(id) {
        camps.delete(id);
    },
    async getAllCamps() {
        return [...camps.entries()].map(([id, c]) => ({ ...copy(c), id }));
    }
};
