const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

// 1. Add formatNumber function at the top of the script
if (!html.includes('function formatNumber')) {
    html = html.replace(
        /<script>\n/,
        "<script>\n    function formatNumber(num, lang) { return lang === 'fa' ? num.toString().replace(/\\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]) : num; }\n"
    );
}

// 2. Change the initialization of fjValueWheel to a function
html = html.replace(
    /let valHtml = '<div class="wheel-highlight"><\/div><div style="height: 70px;"><\/div>';\s*for \(let i = 5; i <= 100; i \+= 5\) \{\s*valHtml \+= `<div class="wheel-item" data-val="\$\{i\}">\$\{i\}<\/div>`;\s*\}\s*valHtml \+= '<div style="height: 70px;"><\/div>';\s*if \(valWheel\) valWheel\.innerHTML = valHtml;/g,
    `function renderFjValueWheel() {
        const valWheel = document.getElementById('fjValueWheel');
        if (!valWheel) return;
        let valHtml = '<div class="wheel-highlight"></div><div style="height: 70px;"></div>';
        for (let i = 5; i <= 100; i += 5) {
            valHtml += \`<div class="wheel-item" data-val="\${i}">\${formatNumber(i, typeof currentNumLang !== 'undefined' ? currentNumLang : 'fa')}</div>\`;
        }
        valHtml += '<div style="height: 70px;"></div>';
        valWheel.innerHTML = valHtml;
    }
    renderFjValueWheel();` // Call it initially
);

// 3. Update preview text to format number
html = html.replace(
    /const text = fjCurrentSign \+ fjCurrentValue;/g,
    "const text = fjCurrentSign + formatNumber(fjCurrentValue, typeof currentNumLang !== 'undefined' ? currentNumLang : 'fa');"
);

// 4. Update preview in submit confirmation
html = html.replace(
    /btn\.innerHTML = '✔ ثبت شد';/g,
    "btn.innerHTML = (typeof currentNumLang !== 'undefined' && currentNumLang === 'fa') ? '✔ ثبت شد' : '✔ Saved';" // just in case
);

// 5. Call renderFjValueWheel inside openFieldJudging
html = html.replace(
    /document\.getElementById\('fieldJudgingModal'\)\.style\.display = 'flex';/g,
    "document.getElementById('fieldJudgingModal').style.display = 'flex';\n        if(typeof renderFjValueWheel === 'function') renderFjValueWheel();"
);

fs.writeFileSync('public/operator.html', html);
console.log("Patched formatNumber!");
