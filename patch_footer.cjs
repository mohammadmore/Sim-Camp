const fs = require('fs');

let css = fs.readFileSync('public/style.css', 'utf8');

css = css.replace(/max-width: 320px !important;/, 'max-width: 360px !important;');
css = css.replace(/\.asva-footer span \{\n\s*display: block !important;\n\s*margin: 4px 0 !important;\n\s*\}/, 
    `.asva-footer span {
        display: block !important;
        margin: 4px 0 !important;
        white-space: nowrap !important;
        overflow: hidden;
        text-overflow: ellipsis;
    }`);

fs.writeFileSync('public/style.css', css);
console.log('Footer patched');
