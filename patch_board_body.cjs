const fs = require('fs');
let html = fs.readFileSync('public/board.html', 'utf8');

html = html.replace(
    /<body style="overflow-y: auto; height: 100vh; padding: 10px; box-sizing: border-box; margin: 0;">/,
    '<body style="overflow-y: auto; min-height: 100vh; padding: 10px; box-sizing: border-box; margin: 0; display: flex; flex-direction: column;">'
);

html = html.replace(
    /    <div class="asva-spacer" style="flex-grow: 1; min-height: 80px;"><\/div>/,
    '    <div class="asva-spacer" style="flex-grow: 1; min-height: 40px;"></div>'
);


fs.writeFileSync('public/board.html', html);
console.log("Patched board body!");
