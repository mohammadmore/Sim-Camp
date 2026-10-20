const fs = require('fs');
let html = fs.readFileSync('public/board.html', 'utf8');
let css = fs.readFileSync('public/style.css', 'utf8');

// Ensure board takes exactly 100vh on non-mobile (TV) and hides scroll on body
html = html.replace(
    /<body style="overflow-y: auto; min-height: 100vh; padding: 10px; box-sizing: border-box; margin: 0; display: flex; flex-direction: column;">/,
    '<body style="overflow: hidden; height: 100vh; padding: 10px; box-sizing: border-box; margin: 0; display: flex; flex-direction: column;">'
);

// Modify the spacer to not push footer out of screen on TV
html = html.replace(
    /    <div class="asva-spacer" style="flex-grow: 1; min-height: 40px;"><\/div>/,
    '    <div class="asva-spacer" style="flex-grow: 1;"></div>' // Remove min-height so it shrinks if needed
);

// Fix CSS for footer to ensure it stays within bounds
// On desktop (TV), we want it absolute or fixed at the bottom so it never leaves the screen
css = css.replace(
    /\/\* Base Footer \*\/\n\.asva-footer \{\n    position: relative;\n    margin: 10px auto 15px auto;/g,
    '/* Base Footer */\n.asva-footer {\n    position: absolute;\n    bottom: 15px;\n    left: 50%;\n    transform: translateX(-50%);\n    margin: 0;'
);

// On mobile, we still want it to scroll with the content so it doesn't cover teams
css = css.replace(
    /\/\* Mobile Footer \*\/\n    \.asva-footer \{\n        position: relative !important;\n        bottom: auto !important;\n        margin: 20px auto 40px auto !important;/g,
    '/* Mobile Footer */\n    .asva-footer {\n        position: relative !important;\n        bottom: auto !important;\n        left: auto !important;\n        transform: none !important;\n        margin: 20px auto 40px auto !important;'
);

// Force body scroll on mobile only
css += `\n@media (max-width: 1024px) {\n    body {\n        overflow-y: auto !important;\n        height: auto !important;\n        min-height: 100vh !important;\n    }\n}\n`;

fs.writeFileSync('public/board.html', html);
fs.writeFileSync('public/style.css', css);
console.log("Patched footer for TV!");
