const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

// Replace scoring area top position and circle margin
html = html.replace(
    /\.fj-team-circle\.fj-selected \{[\s\S]*?\}/g,
    '.fj-team-circle.fj-selected {\n        transform: scale(1.2);\n        z-index: 10;\n        margin-bottom: 20px;\n        cursor: default;\n        position: absolute;\n        top: 20px;\n    }'
);

html = html.replace(
    /\.fj-scoring-area \{[\s\S]*?\}/g,
    '.fj-scoring-area {\n        width: 100%; display: flex; flex-direction: column; align-items: center;\n        opacity: 0; transform: translateY(20px); pointer-events: none;\n        transition: all 0.4s ease;\n        position: absolute; top: 180px; left: 0; right: 0; padding: 0 20px;\n    }'
);

// We need to make sure the selected circle stays centered
html = html.replace(
    /position: absolute;\n        top: 20px;/g,
    'position: absolute;\n        top: 20px;\n        left: 50%;\n        margin-left: calc(-1 * clamp(65px, 20vw, 110px) / 2);'
);

fs.writeFileSync('public/operator.html', html);
console.log("Patched positions!");
