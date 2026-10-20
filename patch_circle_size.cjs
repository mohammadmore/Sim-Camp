const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

// Replace grid gap and alignment
html = html.replace(
    /gap: 15px;[\s\S]*?padding: 20px; flex-grow: 1; align-content: flex-start;/g,
    'gap: 10px; padding: 15px; flex-grow: 1; align-content: center; overflow-y: auto;'
);

// Replace team circle dimensions
html = html.replace(
    /width: 100px; height: 100px; border-radius: 50%;[\s\S]*?font-size: 18px;/g,
    'width: clamp(65px, 20vw, 110px); height: clamp(65px, 20vw, 110px); border-radius: 50%;\n        display: flex; align-items: center; justify-content: center;\n        text-align: center; color: #fff; font-weight: bold; font-size: clamp(11px, 3vw, 18px);'
);

fs.writeFileSync('public/operator.html', html);
console.log("Patched sizes!");
