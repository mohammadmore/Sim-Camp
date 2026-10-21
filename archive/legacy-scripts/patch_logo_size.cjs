const fs = require('fs');
let html = fs.readFileSync('public/board.html', 'utf8');

html = html.replace(
    /height: 18vh;/g,
    'height: 12vh;' // Reduce header height slightly
);

html = html.replace(
    /max-height: 18vh;/g,
    'max-height: 12vh; padding: 10px; box-sizing: border-box;' // Give logos some breathing room
);

fs.writeFileSync('public/board.html', html);
console.log("Patched board.html sizes!");
