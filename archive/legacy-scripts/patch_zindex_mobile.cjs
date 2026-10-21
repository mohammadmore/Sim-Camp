const fs = require('fs');
let css = fs.readFileSync('public/style.css', 'utf8');

if (!css.includes('z-index: 900 !important;') && css.includes('.asva-footer {\\n        margin: 10px auto 20px auto !important;')) {
    css = css.replace(/\.asva-footer \{\n\s*margin: 10px auto 20px auto !important;/g, '.asva-footer {\n        z-index: 900 !important;\n        margin: 10px auto 20px auto !important;');
    fs.writeFileSync('public/style.css', css);
    console.log('Mobile z-index patched');
} else {
    // try a broader replace for mobile
    css = css.replace(/\.asva-footer \{\n\s*margin: 10px auto 20px auto !important;/g, '.asva-footer {\n        z-index: 900 !important;\n        margin: 10px auto 20px auto !important;');
    fs.writeFileSync('public/style.css', css);
    console.log('Mobile z-index patched (fallback)');
}
