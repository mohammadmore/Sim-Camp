const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

html = html.replace(
    /function renderFjValueWheel\(\) \{[\s\S]*?renderFjValueWheel\(\);/g,
    '' // remove it from DOMContentLoaded
);

html = html.replace(
    /<script>\n    function formatNumber/g,
    "<script>\n    function renderFjValueWheel() {\n        const valWheel = document.getElementById('fjValueWheel');\n        if (!valWheel) return;\n        let valHtml = '<div class=\"wheel-highlight\"></div><div style=\"height: 70px;\"></div>';\n        for (let i = 5; i <= 100; i += 5) {\n            valHtml += `<div class=\"wheel-item\" data-val=\"\${i}\">\\${formatNumber(i, typeof currentNumLang !== 'undefined' ? currentNumLang : 'fa')}</div>`;\n        }\n        valHtml += '<div style=\"height: 70px;\"></div>';\n        valWheel.innerHTML = valHtml;\n    }\n    function formatNumber"
);

// We still need to call it initially in DOMContentLoaded so it populates before opening the modal.
html = html.replace(
    /const valWheel = document\.getElementById\('fjValueWheel'\);/,
    "renderFjValueWheel();"
);

fs.writeFileSync('public/operator.html', html);
console.log("Fixed scope!");
