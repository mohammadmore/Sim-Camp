const fs = require('fs');
['public/board.html', 'public/operator.html', 'public/superadmin.html'].forEach(f => {
    let text = fs.readFileSync(f, 'utf8');
    text = text.replace(/\\n/g, '\n');
    fs.writeFileSync(f, text);
});
