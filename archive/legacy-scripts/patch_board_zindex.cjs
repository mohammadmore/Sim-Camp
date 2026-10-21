const fs = require('fs');

let html = fs.readFileSync('public/board.html', 'utf8');

// The footer in board.html has an inline z-index of 10. Let's make it consistent with the CSS just in case.
html = html.replace(/<div class="asva-footer" style="position: relative; z-index: 10;">/g, '<div class="asva-footer">');

fs.writeFileSync('public/board.html', html);
console.log('Board z-index patched');
