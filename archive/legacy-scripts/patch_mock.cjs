const fs = require('fs');
let srv = fs.readFileSync('server.js', 'utf8');

srv = srv.replace(
    /if \(query.includes\('INSERT INTO camps'\)\) \{\n                _data.camps.push\(\{\n                    id: args\[0\], orgName: args\[1\], title: args\[2\], logo: args\[3\], password: args\[4\],\n                    teams: args\[5\], stages: args\[6\], locked: 0, numLang: args\[7\], dir: args\[8\], users: args\[9\]\n                \}\);\n            \}/,
    `if (query.includes('INSERT INTO camps')) {
                _data.camps.push({
                    id: args[0], orgName: args[1], title: args[2], logo: args[3], password: args[4],
                    teams: args[5], stages: args[6], locked: 0, numLang: args[7], dir: args[8], users: args[9], campType: args[10] || 'simple'
                });
            }`
);

srv = srv.replace(
    /if \(query.includes\('UPDATE camps SET orgName = \?'\)\) \{\n                const c = _data.camps.find\(c => c.id === args\[9\]\);\n                if \(c\) \{\n                    c.orgName = args\[0\]; c.title = args\[1\]; c.logo = args\[2\]; c.password = args\[3\];\n                    c.teams = args\[4\]; c.stages = args\[5\]; c.numLang = args\[6\]; c.dir = args\[7\]; c.users = args\[8\];\n                \}\n            \}/,
    `if (query.includes('UPDATE camps SET orgName = ?')) {
                const c = _data.camps.find(c => c.id === args[10]);
                if (c) {
                    c.orgName = args[0]; c.title = args[1]; c.logo = args[2]; c.password = args[3];
                    c.teams = args[4]; c.stages = args[5]; c.numLang = args[6]; c.dir = args[7]; c.users = args[8]; c.campType = args[9] || 'simple';
                }
            }`
);

fs.writeFileSync('server.js', srv);
console.log('mock db patched');
