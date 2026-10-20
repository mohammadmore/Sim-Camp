const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

// The position of the team title needs to be hidden when a team is selected since the circle is already there
// Also we need to make sure fjTeamsContainer handles the absolute positioning correctly
html = html.replace(
    /document\.getElementById\('fjMainTitle'\)\.innerText = team\.name;/g,
    `document.getElementById('fjMainTitle').style.opacity = '0';`
);

html = html.replace(
    /document\.getElementById\('fjMainTitle'\)\.innerText = 'داوری میدانی';/g,
    `document.getElementById('fjMainTitle').innerText = 'داوری میدانی';\n        document.getElementById('fjMainTitle').style.opacity = '1';`
);

fs.writeFileSync('public/operator.html', html);
console.log("Patched titles!");
