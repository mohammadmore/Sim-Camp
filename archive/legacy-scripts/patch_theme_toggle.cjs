const fs = require('fs');

// Update board.html
let html = fs.readFileSync('public/board.html', 'utf8');
html = html.replace(/class="theme-toggle"/g, 'class="theme-toggle board-theme-toggle"');
fs.writeFileSync('public/board.html', html);

// Update style.css
let css = fs.readFileSync('public/style.css', 'utf8');
css = css.replace(/\/\* Fix mobile overlap for theme toggle \*\/\n@media \(max-width: 768px\) \{\n\s*\.theme-toggle \{\n\s*top: 15px !important;\n\s*bottom: auto !important;\n\s*left: 15px !important;\n\s*transform: scale\(0.85\);\n\s*\}\n\}/g, 
`/* Fix mobile overlap for theme toggle - only on board */
@media (max-width: 768px) {
    .board-theme-toggle {
        top: 15px !important;
        bottom: auto !important;
        left: 15px !important;
        transform: scale(0.85);
    }
    .theme-toggle:not(.board-theme-toggle) {
        transform: scale(0.85);
    }
}`);

fs.writeFileSync('public/style.css', css);
console.log('Theme toggle patched');
