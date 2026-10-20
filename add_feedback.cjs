const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf-8');

html = html.replace(
    'link.click();\n            }).catch(err => alert("Error taking snapshot: " + err));',
    `link.click();
                const btn = document.querySelector('button[onclick="takeSnapshot()"]');
                if (btn) {
                    const oldText = btn.innerHTML;
                    btn.innerHTML = '✅ ثبت شد';
                    setTimeout(() => btn.innerHTML = oldText, 2000);
                }
            }).catch(err => alert("خطا در ثبت تصویر: " + err));`
);

fs.writeFileSync('public/operator.html', html);
console.log("Added feedback");
