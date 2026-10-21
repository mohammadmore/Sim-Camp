const fs = require('fs');
let sa = fs.readFileSync('public/superadmin.html', 'utf8');

// Fix the importExcel error
sa = sa.replace(
    /campType: campType,/,
    "campType: 'simple',"
);

// Add campType to createCamp payload
sa = sa.replace(
    /title: campTitle,\n\s*logo: logo,/,
    "title: campTitle,\n                campType: campType,\n                logo: logo,"
);

fs.writeFileSync('public/superadmin.html', sa);
console.log('fixed');
