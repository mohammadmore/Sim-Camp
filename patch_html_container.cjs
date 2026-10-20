const fs = require('fs');
let html = fs.readFileSync('public/superadmin.html', 'utf8');

// Add a specific class to the button container to make targeting it cleaner
const oldContainer = /<div style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap; margin-bottom: 30px;">/;
const newContainer = '<div class="action-buttons-container" style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap; margin-bottom: 30px;">';

html = html.replace(oldContainer, newContainer);
fs.writeFileSync('public/superadmin.html', html);

let css = fs.readFileSync('public/style.css', 'utf8');

// Replace the #dashboardSection selector with the specific class
css = css.replace(/#dashboardSection > div:first-of-type/g, '.action-buttons-container');

fs.writeFileSync('public/style.css', css);
console.log('Container patched');
