const fs = require('fs');
let css = fs.readFileSync('public/style.css', 'utf8');

// The issue is that #boardHeader > div has width: 100% !important; which overrides the nth-child width in some cases,
// or flex-wrap pushes it because of margins/padding.
// We should make the logos take EXACTLY 50% without overflowing.
// We'll also simplify the header rules for mobile to make them foolproof.

css = css.replace(
    /#boardHeader > div \{\n        width: 100% !important;\n        justify-content: center !important;\n        flex-direction: row !important; \/\* Keep logos inside their wrappers normal \*\/\n    \}/,
    '#boardHeader > div {\n        justify-content: center !important;\n        align-items: center !important;\n        display: flex !important;\n        flex-direction: row !important;\n        box-sizing: border-box !important;\n    }'
);

css = css.replace(
    /#boardHeader > div:nth-child\(1\) \{ order: 1; width: 50% !important; justify-content: center !important; \} \/\* Left logo \*\//,
    '#boardHeader > div:nth-child(1) { order: 1; width: 50% !important; justify-content: flex-end !important; padding-right: 5px !important; } /* Left logo */'
);

css = css.replace(
    /#boardHeader > div:nth-child\(3\) \{ order: 2; width: 50% !important; justify-content: center !important; \} \/\* Right logo \*\//,
    '#boardHeader > div:nth-child(3) { order: 2; width: 50% !important; justify-content: flex-start !important; padding-left: 5px !important; } /* Right logo */'
);

// We need to fix the duplicate max-height bug introduced in my last run
css = css.replace(
    /#boardSystemLogo, #orgLogo \{\n        max-height: 12vh !important;\n        max-height: 10vh !important;/,
    '#boardSystemLogo, #orgLogo {\n        max-height: 8vh !important;' // Slightly smaller so they fit well together horizontally
);

fs.writeFileSync('public/style.css', css);
console.log("Patched header again!");
