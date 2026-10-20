const fs = require('fs');

let sa = fs.readFileSync('public/superadmin.html', 'utf8');
sa = sa.replace('function createCamp() {', 'function createCamp() { console.log("createCamp clicked");');
fs.writeFileSync('public/superadmin.html', sa);

let op = fs.readFileSync('public/operator.html', 'utf8');
op = op.replace('function saveSettings() {', 'function saveSettings() { console.log("saveSettings clicked");');
fs.writeFileSync('public/operator.html', op);
