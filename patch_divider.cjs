const fs = require('fs');
let css = fs.readFileSync('public/style.css', 'utf8');

// The issue is that the rule .asva-footer span { display: block !important; } 
// is overriding .credit-divider { display: none !important; } 
// because .credit-divider IS a span and the previous rule has more specificity if it's placed later or because they are equal and it's cascading.
// Let's fix this by adding the span tag to the divider selector to increase its specificity.

css = css.replace(/\.credit-divider \{/, 'span.credit-divider, .asva-footer span.credit-divider {');

fs.writeFileSync('public/style.css', css);
console.log('Divider patched');
