const fs = require('fs');

let sa = fs.readFileSync('public/superadmin.html', 'utf8');

sa = sa.replace(
    /title: campTitle,/,
    "title: campTitle,\n                campType: campType,"
);

fs.writeFileSync('public/superadmin.html', sa);
console.log('campData patched');
