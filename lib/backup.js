// Backup files shared by both editions (Node / PHP): every camp with its scores inside the
// teams, the images it uses (base64) and, for a full backup, the system logo.
import { readCampForBackup, collectMediaNames } from './campRepo.js';

export const BACKUP_FORMAT = 'sim-camp-backup';

export async function buildBackup(store, ids, { includeSettings = false } = {}) {
    const camps = [];
    for (const id of ids) {
        const camp = await readCampForBackup(store, id);
        if (camp) camps.push(camp);
    }
    const settings = {};
    if (includeSettings) {
        const logo = await store.getSetting('systemLogo');
        if (logo) settings.systemLogo = logo;
    }
    const media = {};
    for (const name of collectMediaNames([camps, settings])) {
        const m = await store.getMedia(name);
        if (m) media[name] = Buffer.from(m.data).toString('base64');
    }
    return { format: BACKUP_FORMAT, version: 1, source: 'node', exportedAt: new Date().toISOString(), camps, settings, media };
}

export async function allCampIds(store) {
    return (await store.listCamps(['deletedAt'])).map(c => c.id);
}
