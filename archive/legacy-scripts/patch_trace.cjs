const fs = require('fs');
let sa = fs.readFileSync('public/superadmin.html', 'utf8');
sa = sa.replace(
    /c\.teams\.forEach\(t => addTeam\(t\.name, t\.color, t\.id, t\.score, t\.stageScores, t\.scoreLogs\)\);/,
    `c.teams.forEach(t => {
        try {
            console.log("t:", t);
            addTeam(t.name, t.color, t.id, t.score, t.stageScores, t.scoreLogs);
        } catch(e) {
            console.error("ADDTEAM ERROR:", e);
        }
    });`
);
fs.writeFileSync('public/superadmin.html', sa);
