// Automatic backup of the Node edition (run by cron / a scheduler), e.g.:
//   node scripts/backup.mjs                       -> ./backups, keeps the newest 14 files
//   node scripts/backup.mjs /var/backups/simcamp 30
// Uses the same database settings as the server (DB_ADAPTER, FIREBASE_SERVICE_ACCOUNT, ...; a .env
// file is read when present). The file can be restored from the superadmin panel of either edition.
import fs from 'fs';
import path from 'path';

if (fs.existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env');

const dir = path.resolve(process.argv[2] || 'backups');
const keep = Math.max(1, parseInt(process.argv[3], 10) || 14);

const { store } = await import('../db/index.js');
const { buildBackup, allCampIds } = await import('../lib/backup.js');

fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const backup = await buildBackup(store, await allCampIds(store), { includeSettings: true });
const file = path.join(dir, `sim-camp-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
fs.writeFileSync(file + '.tmp', JSON.stringify(backup), { mode: 0o600 });
fs.renameSync(file + '.tmp', file);

// Rotation: only the newest `keep` backups stay.
const all = fs.readdirSync(dir).filter(f => /^sim-camp-backup-.*\.json$/.test(f)).sort();
for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, old));

console.log(`Backup written: ${file} (${backup.camps.length} camps, ${Object.keys(backup.media).length} images)`);
process.exit(0); // database watchers / connections would keep the process alive
