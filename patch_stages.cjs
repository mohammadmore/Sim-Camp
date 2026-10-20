const fs = require('fs');
let op = fs.readFileSync('public/operator.html', 'utf8');

op = op.replace(
    /btn\.innerText = stage\.name;/g,
    "btn.innerText = stage.name;\n                btn.title = 'ثبت گروهی امتیازات برای ' + stage.name;"
);

fs.writeFileSync('public/operator.html', op);
console.log('patched stages');
