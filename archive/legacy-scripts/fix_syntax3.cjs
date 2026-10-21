const fs = require('fs');
let server = fs.readFileSync('server.js', 'utf8');

// The replacement was applied to the wrong place or failed. I will replace it exactly.
server = server.replace(
    `app.post('/api', async (req, res) => {
    const { id } = req.query;
    const { teams, stages, orgName, title, logo, numLang, dir } = req.body;
    if (!id) return res.status(400).send("شناسه مسابقه وارد نشده است.");
    
    const camp = await getCamp(id);
    if (camp) {
        if (camp.locked === 1) return res.status(403).json({ status: "error", message: "این مسابقه قفل شده است." });
        
        await updateCamp(id, { teams: teams || JSON.parse(camp.teams), stages: stages || (camp.stages ? JSON.parse(camp.stages) : []), orgName: orgName || camp.orgName, title: title !== undefined ? title : camp.title, logo: logo !== undefined ? logo : camp.logo, numLang: numLang || camp.numLang || 'fa', dir: dir || camp.dir || 'rtl' });
        await broadcastState(id);
        }
    }); // end withLock
    res.json({ status: "success" });
});`,
    `app.post('/api', async (req, res) => {
    const { id } = req.query;
    const { teams, stages, orgName, title, logo, numLang, dir } = req.body;
    if (!id) return res.status(400).send("شناسه مسابقه وارد نشده است.");
    
    await withLock(id, async () => {
        const camp = await getCamp(id);
        if (camp) {
            if (camp.locked === 1) return res.status(403).json({ status: "error", message: "این مسابقه قفل شده است." });
            
            await updateCamp(id, { teams: teams || JSON.parse(camp.teams), stages: stages || (camp.stages ? JSON.parse(camp.stages) : []), orgName: orgName || camp.orgName, title: title !== undefined ? title : camp.title, logo: logo !== undefined ? logo : camp.logo, numLang: numLang || camp.numLang || 'fa', dir: dir || camp.dir || 'rtl' });
            await broadcastState(id);
        }
    }); // end withLock
    res.json({ status: "success" });
});`
);

fs.writeFileSync('server.js', server);
