const fs = require('fs');
let op = fs.readFileSync('public/operator.html', 'utf8');
op = op.replace(
    'updateHeaderUI(); syncData(); closeSettings();',
    'updateHeaderUI(); syncData(); closeSettings(); alert("تغییرات با موفقیت ذخیره شد.");'
);
fs.writeFileSync('public/operator.html', op);
