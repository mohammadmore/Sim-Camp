const fs = require('fs');

let css = fs.readFileSync('public/style.css', 'utf8');

// Fix theme toggle overlapping modals (modals are 1000)
css = css.replace(/\.theme-toggle \{\n([\s\S]*?)z-index: 9000;/g, '.theme-toggle {\n$1z-index: 900;');

// Fix splash popup to be above modals but not insane
css = css.replace(/\.splash-overlay \{\n([\s\S]*?)z-index: 900;/g, '.splash-overlay {\n$1z-index: 2000;');

// Tooltips should be above modals and splash, 3000 is enough
css = css.replace(/z-index: 999999;/g, 'z-index: 3000;');

// Toast notifications should be above tooltips, 4000 is enough
css = css.replace(/z-index: 10000;/g, 'z-index: 4000;');

fs.writeFileSync('public/style.css', css);
console.log('All z-index patched');
