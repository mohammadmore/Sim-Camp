const fs = require('fs');
let sa = fs.readFileSync('public/superadmin.html', 'utf8');
sa = sa.replace(
    /stageScores: JSON\.parse\(el\.dataset\.stagescores \|\| '\{\}'\),/,
    `stageScores: (function() { 
        console.log("dumping dataset:", el.dataset);
        console.log("stagescores str:", el.dataset.stagescores);
        return JSON.parse(el.dataset.stagescores || '{}');
    })(),`
);
fs.writeFileSync('public/superadmin.html', sa);
