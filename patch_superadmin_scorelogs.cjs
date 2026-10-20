const fs = require('fs');

let sa = fs.readFileSync('public/superadmin.html', 'utf8');

sa = sa.replace(
    /function addTeam\(name = '', color = COLORS\[Math\.floor\(Math\.random\(\) \* COLORS\.length\)\], id = '', score = 0, stageScores = \{\}\) \{/,
    `function addTeam(name = '', color = COLORS[Math.floor(Math.random() * COLORS.length)], id = '', score = 0, stageScores = {}, scoreLogs = []) {`
);

sa = sa.replace(
    /item\.dataset\.stagescores = JSON\.stringify\(stageScores\);/,
    `item.dataset.stagescores = JSON.stringify(stageScores);\n            item.dataset.scorelogs = JSON.stringify(scoreLogs);`
);

sa = sa.replace(
    /c\.teams\.forEach\(t => addTeam\(t\.name, t\.color, t\.id, t\.score, t\.stageScores\)\);/,
    `c.teams.forEach(t => addTeam(t.name, t.color, t.id, t.score, t.stageScores, t.scoreLogs));`
);

sa = sa.replace(
    /stageScores: JSON\.parse\(el\.dataset\.stagescores \|\| '\{\}'\)/,
    `stageScores: JSON.parse(el.dataset.stagescores || '{}'),\n                    scoreLogs: JSON.parse(el.dataset.scorelogs || '[]')`
);

fs.writeFileSync('public/superadmin.html', sa);
