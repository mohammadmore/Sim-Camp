const fs = require('fs');

let html = fs.readFileSync('public/superadmin.html', 'utf8');

// Color picker shouldn't be z-index 2000 if normal modals are 1000 and tooltips 3000, 1500 is fine
html = html.replace(/<div id="colorPickerModal" class="modal-overlay" style="z-index: 2000;">/g, '<div id="colorPickerModal" class="modal-overlay" style="z-index: 1500;">');

// Animation flying card can be 2000, 9999 is excessive
html = html.replace(/card\.style\.zIndex = '9999';/g, "card.style.zIndex = '2500';");

fs.writeFileSync('public/superadmin.html', html);
console.log('Inline z-index patched');
