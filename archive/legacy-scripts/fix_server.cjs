const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// Replace everything from `// Mocked SQLite` up to the first endpoint with our new imports
const importDbText = `
import { getCamp, updateCamp, getSetting, setSetting, getAllCamps } from './db/index.js';
`;
code = code.replace(/\/\/ Mocked SQLite for AI Studio environment[\s\S]*?\/\/ Global Settings Endpoints/m, importDbText + '\n// Global Settings Endpoints');

// Fix /api/settings GET
code = code.replace(/const stmt = db\.prepare\('SELECT key, value FROM settings'\);\s*const rows = stmt\.all\(\);\s*const settings = \{\};\s*rows\.forEach\(r => \{ settings\[r\.key\] = r\.value; \}\);\s*res\.json\(settings\);/g, `
        const adminPassVal = await getSetting('admin_password');
        res.json({ admin_password: adminPassVal });
`);

// Fix /api/settings POST
code = code.replace(/const stmt = db\.prepare\('INSERT INTO settings \(key, value\) VALUES \(\?, \?\) ON CONFLICT\(key\) DO UPDATE SET value = excluded\.value'\);\s*stmt\.run\(key, value\);/g, `
        await setSetting(key, value);
`);

// Fix superadmin /camps (GET all camps)
// Wait, I see there's an endpoint `app.get('/superadmin/camps', (req, res)` that might use `db.prepare`
// Let's replace the whole route just in case
code = code.replace(/app\.get\('\/superadmin\/camps',.*?\{[\s\S]*?res\.json\(\{ success: true, camps \}\);\s*\n\s*\}\);/g, `app.get('/superadmin/camps', async (req, res) => {
    try {
        const camps = await getAllCamps();
        res.json({ success: true, camps });
    } catch(err) { res.status(500).json({error: err.message}); }
});`);

// Fix superadmin lock endpoint
code = code.replace(/app\.post\('\/superadmin\/camps\/:id\/lock', async \(req, res\) => \{[\s\S]*?db\.prepare\('UPDATE camps SET locked = \? WHERE id = \?'\)\.run\(isLocked, req\.params\.id\);\s*res\.json\(\{ success: true \}\);\s*\n\s*\}\);/g, `app.post('/superadmin/camps/:id/lock', async (req, res) => {
    try {
        const { locked } = req.body;
        const isLocked = locked ? 1 : 0;
        await updateCamp(req.params.id, { locked: isLocked });
        res.json({ success: true });
    } catch(err) { res.status(500).json({error: err.message}); }
});`);

// Fix any other stray db.prepare or similar
code = code.replace(/const tableInfo = db\.prepare\("PRAGMA table_info\(camps\)"\)\.all\(\);\s*const colNames = tableInfo\.map\(c => c\.name\);\s*missingColumns\.forEach\(col => \{.*\}\);/g, `// PRAGMA migration handled by NoSQL structure`);
code = code.replace(/const camp = db\.prepare\('SELECT \* FROM camps WHERE id = \?'\)\.get\(req\.params\.id\);/g, `const camp = await getCamp(req.params.id);`);


fs.writeFileSync('server.js', code);
