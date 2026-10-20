const fs = require('fs');

let css = fs.readFileSync('public/style.css', 'utf8');

css = css.replace(/z-index: 9999;/g, 'z-index: 900;');

fs.writeFileSync('public/style.css', css);
console.log('z-index patched');
