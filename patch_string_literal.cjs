const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

// The issue is \\${formatNumber...} was literally rendering the string ${formatNumber...} because of double escaping.
html = html.replace(
    /\\\$(\{formatNumber\(i, typeof currentNumLang !== 'undefined' \? currentNumLang : 'fa'\)\})/g,
    "$$$1"
);

fs.writeFileSync('public/operator.html', html);
console.log("Patched literal string!");
