const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

// 1. Swap Wheels
const signWheelHtml = `<!-- Sign Wheel -->
                <div id="fjSignWheel" class="wheel-container">
                    <div class="wheel-highlight"></div>
                    <div style="height: 70px;"></div>
                    <div class="wheel-item" data-val="+">+</div>
                    <div class="wheel-item" data-val="-">-</div>
                    <div style="height: 70px;"></div>
                </div>`;
const valueWheelHtml = `<!-- Value Wheel -->
                <div id="fjValueWheel" class="wheel-container">
                    <div class="wheel-highlight"></div>
                    <div style="height: 70px;"></div>
                    <!-- populated by JS -->
                </div>`;
                
html = html.replace(
    /<!-- Sign Wheel -->[\s\S]*?<\/div>\s*<!-- Value Wheel -->[\s\S]*?<\/div>/,
    valueWheelHtml + '\n                ' + signWheelHtml
);

// 2. Fix Submit Button Overflow
html = html.replace(
    /width: 100%; max-width: 400px; padding: 20px;/g,
    'width: 100%; max-width: 400px; padding: 20px; box-sizing: border-box;'
);

// 3. Sharper colors
html = html.replace(
    /submitBtn\.style\.background = 'var\(--success-bg, rgba\(34, 197, 94, 0\.8\)\)';/g,
    "submitBtn.style.background = 'rgba(0, 230, 118, 0.85)';" // sharp green
);
html = html.replace(
    /valWheelItems\.forEach\(i => i\.style\.color = 'var\(--success-color\)'\);/g,
    "valWheelItems.forEach(i => i.style.color = '#00e676');"
);

html = html.replace(
    /submitBtn\.style\.background = 'var\(--danger-bg, rgba\(239, 68, 68, 0\.8\)\)';/g,
    "submitBtn.style.background = 'rgba(255, 23, 68, 0.85)';" // sharp red
);
html = html.replace(
    /valWheelItems\.forEach\(i => i\.style\.color = 'var\(--danger-color\)'\);/g,
    "valWheelItems.forEach(i => i.style.color = '#ff1744');"
);

// Also need to color the sign wheel items too! The user said "رنگ قرمز و سبز امتیاز و +/- رو شارپ و زندهتر کن"
// Currently we only color valWheelItems. We need to color signWheelItems as well.
html = html.replace(
    /const valWheelItems = document\.querySelectorAll\('#fjValueWheel \.wheel-item'\);/g,
    "const valWheelItems = document.querySelectorAll('#fjValueWheel .wheel-item');\n        const signWheelItems = document.querySelectorAll('#fjSignWheel .wheel-item');"
);

html = html.replace(
    /valWheelItems\.forEach\(i => i\.style\.color = '#00e676'\);/g,
    "valWheelItems.forEach(i => i.style.color = '#00e676');\n            signWheelItems.forEach(i => i.style.color = '#00e676');"
);

html = html.replace(
    /valWheelItems\.forEach\(i => i\.style\.color = '#ff1744'\);/g,
    "valWheelItems.forEach(i => i.style.color = '#ff1744');\n            signWheelItems.forEach(i => i.style.color = '#ff1744');"
);

fs.writeFileSync('public/operator.html', html);
console.log("Patched fixes!");
