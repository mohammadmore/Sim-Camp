const fs = require('fs');

let css = fs.readFileSync('public/style.css', 'utf8');

// The issue is likely that in mobile, the footer margins and spacing need to be adjusted, OR the theme-toggle overlaps the footer, OR the action buttons overlap the cards. Let's add extra padding/margin to be safe.

// 1. Give theme toggle a specific z-index and adjust position in mobile if it's not the board
css = css.replace(/\.theme-toggle:not\(\.board-theme-toggle\) \{\n\s*transform: scale\(0\.85\);\n\s*\}/g, 
    `.theme-toggle:not(.board-theme-toggle) {
        transform: scale(0.85);
        bottom: 80px !important; /* Move it up so it doesn't overlap footer */
        z-index: 950; /* Slightly above footer but below modals */
    }`);

fs.writeFileSync('public/style.css', css);
console.log('Overlap patched');
