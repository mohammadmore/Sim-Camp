const fs = require('fs');

const files = ['public/superadmin.html', 'public/operator.html', 'public/board.html'];
const footerHTML = `\n    <div style="position: fixed; bottom: 10px; left: 0; right: 0; text-align: center; font-size: 12px; opacity: 0.7; pointer-events: none; z-index: 9999;">Powered by Asva Studio | توسعه یافته توسط شرکت داده‌پردازان اسوا</div>\n`;

files.forEach(file => {
    let html = fs.readFileSync(file, 'utf-8');
    if (!html.includes('Powered by Asva Studio')) {
        html = html.replace('</body>', footerHTML + '</body>');
        fs.writeFileSync(file, html);
        console.log("Updated " + file);
    }
});
