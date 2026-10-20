const fs = require('fs');
let sa = fs.readFileSync('public/superadmin.html', 'utf8');

sa = sa.replace(/<a id="operatorLink"([^>]*)>/g, '<a id="operatorLink" title="ورود به پنل اپراتور این رویداد در تب جدید" $1>');
sa = sa.replace(/<a href="operator.html\?id=\$\{camp.id\}"([^>]*)>/g, '<a href="operator.html?id=${camp.id}" title="مشاهده پنل اپراتور این رویداد در تب جدید" $1>');

fs.writeFileSync('public/superadmin.html', sa);
console.log('patched links');
