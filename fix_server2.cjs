const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

// replace the PRAGMA lines
code = code.replace(/\/\/ Add new columns if they don't exist[\s\S]*?\}\);/m, '// NoSQL structure needs no PRAGMA check');

// fix the async GET camp issue we found earlier
code = code.replace(/app\.get\('\/superadmin\/camps\/:id', \(req, res\) => \{/g, "app.get('/superadmin/camps/:id', async (req, res) => {");

fs.writeFileSync('server.js', code);
