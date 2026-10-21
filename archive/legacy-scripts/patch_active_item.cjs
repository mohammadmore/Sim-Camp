const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

// The issue is we are coloring all items with the sharp color, and opacity 0.3 for non-active is not enough contrast, or active item does not stand out enough.
// We will only color the ACTIVE item with the sharp color, and the rest will be white with lower opacity.

// 1. CSS update for wheel item active
html = html.replace(
    /\.wheel-item\.active \{ opacity: 1; font-size: 40px; \}/g,
    '.wheel-item.active { opacity: 1; font-size: 44px; text-shadow: 0 0 15px currentColor; }'
);

// 2. JS update for color assignment
// Instead of setting color on ALL items via forEach, we set it via CSS variables, or we can just update the colors dynamically only for the active items.
html = html.replace(
    /valWheelItems\.forEach\(i => i\.style\.color = '#00e676'\);\n            signWheelItems\.forEach\(i => i\.style\.color = '#00e676'\);/g,
    `valWheelItems.forEach(i => i.style.color = i.classList.contains('active') ? '#00e676' : 'rgba(255,255,255,0.4)');
            signWheelItems.forEach(i => i.style.color = i.classList.contains('active') ? '#00e676' : 'rgba(255,255,255,0.4)');`
);

html = html.replace(
    /valWheelItems\.forEach\(i => i\.style\.color = '#ff1744'\);\n            signWheelItems\.forEach\(i => i\.style\.color = '#ff1744'\);/g,
    `valWheelItems.forEach(i => i.style.color = i.classList.contains('active') ? '#ff1744' : 'rgba(255,255,255,0.4)');
            signWheelItems.forEach(i => i.style.color = i.classList.contains('active') ? '#ff1744' : 'rgba(255,255,255,0.4)');`
);

// In initWheel, we need to call updateFjPreview when active item changes so the colors re-evaluate
html = html.replace(
    /closest\.classList\.add\('active'\);\n                    onSelect\(closest\.dataset\.val\);/g,
    `closest.classList.add('active');\n                    onSelect(closest.dataset.val);\n                    updateFjPreview();` // updateFjPreview will re-run the color logic
);

fs.writeFileSync('public/operator.html', html);
console.log("Patched active item colors!");
