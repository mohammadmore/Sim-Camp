const fs = require('fs');

let srv = fs.readFileSync('server.js', 'utf8');

srv = srv.replace(
    /\{ name: 'dir', type: 'TEXT DEFAULT "rtl"' \},/,
    "{ name: 'dir', type: 'TEXT DEFAULT \"rtl\"' },\n    { name: 'campType', type: 'TEXT DEFAULT \"simple\"' },"
);

// update `/setup` endpoint
srv = srv.replace(
    /const \{ campId, orgName, title, logo, password, teams, stages, numLang, dir, users \} = req\.body;/,
    "const { campId, orgName, title, logo, password, teams, stages, numLang, dir, users, campType } = req.body;"
);

srv = srv.replace(
    /UPDATE camps SET orgName = \?, title = \?, logo = \?, password = \?, teams = \?, stages = \?, numLang = \?, dir = \?, users = \? WHERE id = \?/,
    "UPDATE camps SET orgName = ?, title = ?, logo = ?, password = ?, teams = ?, stages = ?, numLang = ?, dir = ?, users = ?, campType = ? WHERE id = ?"
);

srv = srv.replace(
    /JSON\.stringify\(users \|\| \[\]\), campId/,
    "JSON.stringify(users || []), campType || 'simple', campId"
);

srv = srv.replace(
    /INSERT INTO camps \(id, orgName, title, logo, password, teams, stages, locked, numLang, dir, users\) VALUES \(\?, \?, \?, \?, \?, \?, \?, 0, \?, \?, \?\)/,
    "INSERT INTO camps (id, orgName, title, logo, password, teams, stages, locked, numLang, dir, users, campType) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)"
);

srv = srv.replace(
    /JSON\.stringify\(users \|\| \[\]\)\n        \);/,
    "JSON.stringify(users || []), campType || 'simple'\n        );"
);

fs.writeFileSync('server.js', srv);
console.log('patched columns in setup');
