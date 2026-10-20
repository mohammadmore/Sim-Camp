const fs = require('fs');
let css = fs.readFileSync('public/style.css', 'utf8');

// 1. Remove the old mobile footer styles
css = css.replace(/\/\* Mobile Footer \*\/[\s\S]*?(?=\}\s*\/\* Base Footer \*\/)/, '');
// Note: We need to be careful with regex replacement for big blocks. 
