const fs = require('fs');
let html = fs.readFileSync('public/superadmin.html', 'utf8');
html = html.replace(/loadDashboard\(\);/g, 'loadCamps();');
fs.writeFileSync('public/superadmin.html', html);
console.log('fixed');
