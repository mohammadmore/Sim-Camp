const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

html = html.replace(
    /function renderFjValueWheel\(\) \{\s*renderFjValueWheel\(\);\s*if \(\!valWheel\) return;/g,
    "function renderFjValueWheel() {\n        const valWheel = document.getElementById('fjValueWheel');\n        if (!valWheel) return;"
);

html = html.replace(
    /document\.addEventListener\("DOMContentLoaded", \(\) => \{\s*renderFjValueWheel\(\);/g,
    "document.addEventListener(\"DOMContentLoaded\", () => {\n        renderFjValueWheel();"
);

fs.writeFileSync('public/operator.html', html);
console.log("Fixed recursion!");
