const fs = require('fs');
let css = fs.readFileSync('public/style.css', 'utf8');

css = css.replace(
    /min-height: 100vh !important;/g,
    'min-height: 100vh !important;\n        min-height: 100dvh !important;\n        padding-bottom: 40px !important;'
);

fs.writeFileSync('public/style.css', css);
console.log("Added body padding!");
