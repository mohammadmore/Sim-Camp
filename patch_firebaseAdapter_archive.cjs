const fs = require('fs');

let adapter = fs.readFileSync('db/firebaseAdapter.js', 'utf8');

adapter = adapter.replace(
    /return \{\s*id: d\.id,\s*orgName: data\.orgName,\s*title: data\.title,\s*locked: data\.locked,\s*campType: data\.campType\s*\};/,
    `return { 
                 id: d.id, 
                 orgName: data.orgName, 
                 title: data.title, 
                 locked: data.locked, 
                 campType: data.campType,
                 archived: data.archived || false
             };`
);

fs.writeFileSync('db/firebaseAdapter.js', adapter);
console.log('Fixed getAllCamps to return archived status');
