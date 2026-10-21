const fs = require('fs');

let html = fs.readFileSync('public/operator.html', 'utf8');

// Color picker inline z-index
html = html.replace(/<div id="colorPickerModal" class="modal-overlay" style="z-index: 2000;">/g, '<div id="colorPickerModal" class="modal-overlay" style="z-index: 1500;">');

// Field Judging Modal is a full screen modal, z-index 10000 -> 1000 (same as other modals)
html = html.replace(/background: rgba\(15, 23, 42, 0\.7\); backdrop-filter: blur\(25px\); -webkit-backdrop-filter: blur\(25px\); z-index: 10000;/g, 'background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); z-index: 1000;');

fs.writeFileSync('public/operator.html', html);
console.log('Operator z-index patched');
