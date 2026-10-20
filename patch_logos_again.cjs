const fs = require('fs');
let html = fs.readFileSync('public/board.html', 'utf8');

html = html.replace(
    /<img id="boardSystemLogo"[^>]+>/g,
    '<img id="boardSystemLogo" style="display:none; max-height: 15vh; padding: 10px; box-sizing: border-box; max-width: 25vw; object-fit: contain;" />'
);

html = html.replace(
    /<img id="orgLogo"[^>]+>/g,
    '<img id="orgLogo" style="display:none; max-height: 15vh; padding: 10px; box-sizing: border-box; max-width: 25vw; object-fit: contain;" />'
);

html = html.replace(
    /height: 12vh;/g,
    'height: 15vh;'
);

fs.writeFileSync('public/board.html', html);
console.log("Patched board logos explicitly!");
