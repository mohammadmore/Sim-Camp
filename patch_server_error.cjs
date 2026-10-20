const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

if (!code.includes('unhandledRejection')) {
    code += `\nprocess.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});\n`;
    fs.writeFileSync('server.js', code);
    console.log('Patched global error handler!');
}
