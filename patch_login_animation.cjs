const fs = require('fs');
let html = fs.readFileSync('public/superadmin.html', 'utf8');

html = html.replace(
    /document\.getElementById\('loginSection'\)\.style\.display = 'none';\n\s*document\.getElementById\('dashboardSection'\)\.style\.display = 'block';/,
    `hideModal('loginSection');\n                    setTimeout(() => { showModal('dashboardSection', 'block'); }, 280);`
);

fs.writeFileSync('public/superadmin.html', html);
console.log('Login animation patched');
