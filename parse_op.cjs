const fs = require('fs');
const html = fs.readFileSync('public/operator.html', 'utf8');
const scripts = html.match(/<script>([\s\S]*?)<\/script>/gi);
scripts.forEach((script, i) => {
    const code = script.replace(/<script>|<\/script>/gi, '');
    try {
        new Function(code);
        console.log('Script ' + i + ' is valid');
    } catch (e) {
        console.log('Script ' + i + ' has error: ' + e);
    }
});
