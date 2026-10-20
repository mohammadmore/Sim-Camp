const fs = require('fs');

let server = fs.readFileSync('server.js', 'utf8');

// Fix /lock endpoint and add /archive
server = server.replace(
    /app\.post\('\/superadmin\/camps\/:id\/lock', async \(req, res\) => \{\n    const isLocked = req\.body\.locked \? 1 : 0;\n    db\.prepare\('UPDATE camps SET locked = \? WHERE id = \?'\)\.run\(isLocked, req\.params\.id\);\n    broadcastState\(req\.params\.id\);\n    res\.json\(\{ success: true \}\);\n\}\);/,
    `app.post('/superadmin/camps/:id/lock', async (req, res) => {
    const isLocked = req.body.locked ? 1 : 0;
    await updateCamp(req.params.id, { locked: isLocked });
    await broadcastState(req.params.id);
    res.json({ success: true });
});

app.post('/superadmin/camps/:id/archive', async (req, res) => {
    const isArchived = req.body.archived ? true : false;
    await updateCamp(req.params.id, { archived: isArchived });
    res.json({ success: true });
});`
);

fs.writeFileSync('server.js', server);
console.log('Fixed lock and added archive to server.js');
