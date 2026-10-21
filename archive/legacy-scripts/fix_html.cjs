const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

html = html.replace(
    /<\/div>\s*<div style="height: 70px;"><\/div>\s*<!-- populated by JS -->\s*<\/div>\s*<\/div>\s*<!-- Big Submit Button -->/,
    '</div>\n            </div>\n\n            <!-- Big Submit Button -->'
);

fs.writeFileSync('public/operator.html', html);
console.log("Fixed!");
