const fs = require('fs');
let html = fs.readFileSync('public/board.html', 'utf8');
html = html.replace(/style\.css\?v=\d+/g, 'style.css?v=9');
fs.writeFileSync('public/board.html', html);
console.log("Bumped CSS version!");
