const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

// Inject hexToRgba function
const jsToInject = `
    function hexToRgba(hex, alpha) {
        let r = 0, g = 0, b = 0;
        if (hex.length == 4) {
            r = parseInt(hex[1] + hex[1], 16);
            g = parseInt(hex[2] + hex[2], 16);
            b = parseInt(hex[3] + hex[3], 16);
        } else if (hex.length == 7) {
            r = parseInt(hex.substring(1, 3), 16);
            g = parseInt(hex.substring(3, 5), 16);
            b = parseInt(hex.substring(5, 7), 16);
        }
        return \`rgba(\${r}, \${g}, \${b}, \${alpha})\`;
    }
`;

if (!html.includes('hexToRgba')) {
    html = html.replace('let fjSelectedTeamId = null;', jsToInject + '\n    let fjSelectedTeamId = null;');
}

html = html.replace(
    /circle\.style\.backgroundColor = team\.color;/g,
    "circle.style.backgroundColor = team.color && team.color.startsWith('#') ? hexToRgba(team.color, 0.6) : team.color;"
);

fs.writeFileSync('public/operator.html', html);
console.log("Patched hexToRgba!");
