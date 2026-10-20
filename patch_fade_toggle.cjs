const fs = require('fs');

let html = fs.readFileSync('public/superadmin.html', 'utf8');

// Add smooth transition to grid refresh when toggling tabs
html = html.replace(
    /function toggleAllCampsView\(\) \{/,
    `function toggleAllCampsView() {
            const grid = document.getElementById('campsGrid');
            grid.style.opacity = '0';
            grid.style.transform = 'translateY(10px)';
            grid.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
            
            setTimeout(() => {`
);

html = html.replace(
    /if\(typeof refreshIcons === 'function'\) refreshIcons\(\);\s*renderCampsGrid\(\);\s*\}/,
    `if(typeof refreshIcons === 'function') refreshIcons();
            renderCampsGrid();
            
            grid.style.opacity = '1';
            grid.style.transform = 'translateY(0)';
            }, 200);
        }`
);

fs.writeFileSync('public/superadmin.html', html);
console.log('Grid transition patched');
