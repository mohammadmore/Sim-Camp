const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

// 1. Modal Background
html = html.replace(
    /background-color: #1e1b4b; background: var\(--bg-gradient\);/g,
    'background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px);'
);

// 2. Team Circles
html = html.replace(
    /border: 2px solid rgba\(255,255,255,0\.2\);/g,
    'border: 1px solid rgba(255,255,255,0.3); background-image: linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0) 100%); box-shadow: 0 8px 32px 0 rgba(0,0,0,0.3); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);'
);

// 3. Wheels
html = html.replace(
    /border: 2px solid var\(--glass-border\); border-radius: 15px;[\s\S]*?background: var\(--input-bg\);/g,
    'border-radius: 15px; background: var(--glass-bg); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid var(--glass-border); box-shadow: var(--glass-shadow);'
);

// 4. Submit button styles
// In JS, it sets submitBtn.style.background = 'var(--success-color)' or 'var(--danger-color)'
// Let's modify the updateFjPreview function to add glassmorphic styling
html = html.replace(
    /submitBtn\.style\.background = 'var\(--success-color\)';/g,
    "submitBtn.style.background = 'var(--success-bg, rgba(34, 197, 94, 0.8))'; submitBtn.style.backdropFilter = 'blur(10px)'; submitBtn.style.border = '1px solid rgba(255,255,255,0.3)'; submitBtn.style.boxShadow = 'var(--glass-shadow)';"
);
html = html.replace(
    /submitBtn\.style\.background = 'var\(--danger-color\)';/g,
    "submitBtn.style.background = 'var(--danger-bg, rgba(239, 68, 68, 0.8))'; submitBtn.style.backdropFilter = 'blur(10px)'; submitBtn.style.border = '1px solid rgba(255,255,255,0.3)'; submitBtn.style.boxShadow = 'var(--glass-shadow)';"
);

fs.writeFileSync('public/operator.html', html);
console.log("Patched glassmorphism!");
