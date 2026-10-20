const fs = require('fs');

// 1. Fix CSS
let css = fs.readFileSync('public/style.css', 'utf8');

// Move theme toggle to top left on mobile
css = css.replace(
    /\/\* Fix mobile overlap for theme toggle \*\/\n@media \(max-width: 768px\) \{\n    \.theme-toggle \{\n        bottom: 20px !important;\n        transform: scale\(0.9\);\n    \}\n\}/,
    '/* Fix mobile overlap for theme toggle */\n@media (max-width: 768px) {\n    .theme-toggle {\n        top: 15px !important;\n        bottom: auto !important;\n        left: 15px !important;\n        transform: scale(0.85);\n    }\n}'
);

// Remove the body overflow auto block so it never scrolls
css = css.replace(
    /@media \(max-width: 1024px\) \{\n    body \{\n        overflow-y: auto !important;\n        height: auto !important;\n        min-height: 100vh !important;\n        min-height: 100dvh !important;\n        padding-bottom: 40px !important;\n    \}\n\}/,
    '/* Removed body overflow-y: auto to force no-scroll on mobile */'
);

// We need to be careful. In my last patch I did this exact string for min-height:
// 'min-height: 100vh !important;\n        min-height: 100dvh !important;\n        padding-bottom: 40px !important;'
// Let's use regex to safely remove it
css = css.replace(
    /@media \(max-width: 1024px\) \{\s*body\s*\{[\s\S]*?\}\s*\}/,
    ''
);

// Footer spacing on mobile
css = css.replace(
    /\.asva-footer \{\n        margin: 20px auto 40px auto !important;/,
    '.asva-footer {\n        margin: 10px auto 20px auto !important;'
);

fs.writeFileSync('public/style.css', css);

// 2. Fix JS in HTML
let html = fs.readFileSync('public/board.html', 'utf8');
html = html.replace(
    /const availableHeight = window\.innerHeight - headerHeight - 80;/,
    "const footerEl = document.querySelector('.asva-footer');\n            const footerHeight = footerEl ? footerEl.offsetHeight + 40 : 40;\n            const availableHeight = window.innerHeight - headerHeight - footerHeight - 60;"
);

html = html.replace(/style\.css\?v=\d+/g, 'style.css?v=11');
fs.writeFileSync('public/board.html', html);
console.log("Patched CSS and HTML!");
