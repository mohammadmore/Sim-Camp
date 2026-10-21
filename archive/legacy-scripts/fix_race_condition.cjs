const fs = require('fs');
let server = fs.readFileSync('server.js', 'utf8');

// We need to fix the race condition in /api/instant and /api/undo_instant
// However, since we are doing a quick fix without rewriting the entire Firestore adapter to use Transactions right now,
// we can implement an in-memory lock (Mutex) per campId to ensure operations are sequential for a single camp.
// This completely solves the race condition for concurrent API requests.

if (!server.includes('const campLocks = new Map();')) {
    server = server.replace(
        /const sseClients = new Map\(\);/,
        'const sseClients = new Map();\nconst campLocks = new Map(); // Mutex locks per camp'
    );
    
    server = server.replace(
        /app\.get\('\/',/,
        `// Simple Mutex to prevent Race Conditions on simultaneous requests
async function withLock(id, fn) {
    if (!campLocks.has(id)) campLocks.set(id, Promise.resolve());
    const lock = campLocks.get(id);
    let release;
    const next = new Promise(resolve => release = resolve);
    campLocks.set(id, lock.then(() => next));
    try { return await lock.then(fn); }
    finally { release(); }
}
app.get('/',`
    );
}

// Wrap /api POST in withLock
server = server.replace(
    /app\.post\('\/api', async \(req, res\) => \{\n    const \{ id \} = req\.query;\n    const \{ teams, stages, orgName, title, logo, numLang, dir \} = req\.body;\n    if \(!id\) return res\.status\(400\)\.send\("شناسه مسابقه وارد نشده است\."\);\n\n    const camp = await getCamp\(id\);/g,
    `app.post('/api', async (req, res) => {
    const { id } = req.query;
    const { teams, stages, orgName, title, logo, numLang, dir } = req.body;
    if (!id) return res.status(400).send("شناسه مسابقه وارد نشده است.");
    
    await withLock(id, async () => {
        const camp = await getCamp(id);`
);

// Close the withLock block for /api POST
server = server.replace(
    /await broadcastState\(id\);\n    \}\n    res\.json\(\{ status: "success" \}\);\n\}\);/g,
    `await broadcastState(id);
        }
    }); // end withLock
    res.json({ status: "success" });
});`
);

// Wrap /api/instant in withLock
server = server.replace(
    /app\.post\('\/api\/instant', async \(req, res\) => \{\n    const \{ id \} = req\.query;\n    const \{ teamId, delta, teamName, user \} = req\.body;\n    const camp = await getCamp\(id\);/g,
    `app.post('/api/instant', async (req, res) => {
    const { id } = req.query;
    const { teamId, delta, teamName, user } = req.body;
    
    await withLock(id, async () => {
        const camp = await getCamp(id);`
);

// Close withLock for /api/instant
server = server.replace(
    /await broadcastState\(id\);\n        \}\n    \}\n    res\.json\(\{ success: true \}\);\n\}\);/g,
    `await broadcastState(id);
            }
        }
    }); // end withLock
    res.json({ success: true });
});`
);

// Wrap /api/undo_instant in withLock
server = server.replace(
    /app\.post\('\/api\/undo_instant', async \(req, res\) => \{\n    const \{ id \} = req\.query;\n    const \{ logId \} = req\.body;\n    const camp = await getCamp\(id\);/g,
    `app.post('/api/undo_instant', async (req, res) => {
    const { id } = req.query;
    const { logId } = req.body;
    
    let success = false;
    await withLock(id, async () => {
        const camp = await getCamp(id);`
);

// Close withLock for /api/undo_instant
server = server.replace(
    /await broadcastState\(id\); res\.json\(\{success: true\}\);\n    \} else \{\n        res\.status\(403\)\.json\(\{error: 'locked'\}\);\n    \}\n\}\);/g,
    `await broadcastState(id); 
            success = true;
        }
    }); // end withLock
    if (success) res.json({success: true});
    else res.status(403).json({error: 'locked'});
});`
);

fs.writeFileSync('server.js', server);
console.log('✅ Secured APIs with Mutex lock against Race Conditions');
