const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

// The submit function was using the main title to get the team name, we need to fix that
html = html.replace(
    /const teamName = document\.getElementById\('fjMainTitle'\)\.innerText;/g,
    `const selectedCircle = document.querySelector('.fj-team-circle.fj-selected');\n        const teamName = selectedCircle ? selectedCircle.innerText : 'نامشخص';`
);

fs.writeFileSync('public/operator.html', html);
console.log("Patched submit!");
