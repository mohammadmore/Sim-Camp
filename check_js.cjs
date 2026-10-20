const fs = require('fs');
const html = fs.readFileSync('public/superadmin.html', 'utf8');
const scriptRegex = /<script>([\s\S]*?)<\/script>/g;
let match;
while ((match = scriptRegex.exec(html)) !== null) {
    try {
        new Function(match[1]);
    } catch(e) {
        console.error("Syntax Error:", e.message);
    }
}
