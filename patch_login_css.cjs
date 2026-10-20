const fs = require('fs');
let css = fs.readFileSync('public/style.css', 'utf8');

css += `
#loginSection {
    animation: modalPopIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}
#loginSection.closing {
    animation: modalPopOut 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
`;
fs.writeFileSync('public/style.css', css);
console.log('Login CSS patched');
