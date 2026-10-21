const fs = require('fs');

const fontAwesomeToPhosphor = {
    'fa-solid fa-medal': 'ph-fill ph-medal',
    'fa-solid fa-moon': 'ph-light ph-moon',
    'fa-solid fa-sun': 'ph-light ph-sun',
    'fa-solid fa-gear': 'ph-light ph-gear',
    'fa-solid fa-lock': 'ph-light ph-lock-key',
    'fa-solid fa-trash': 'ph-light ph-trash',
    'fa-solid fa-clock-rotate-left': 'ph-light ph-clock-counter-clockwise',
    'fa-solid fa-right-from-bracket': 'ph-light ph-sign-out',
    'fa-solid fa-chart-line': 'ph-light ph-trend-up',
    'fa-solid fa-camera': 'ph-light ph-camera',
    'fa-solid fa-circle-info': 'ph-light ph-info',
    'fa-solid fa-arrow-up': 'ph-light ph-arrow-up',
    'fa-solid fa-arrow-down': 'ph-light ph-arrow-down',
    'fa-solid fa-plus': 'ph-light ph-plus'
};

const files = ['public/board.html', 'public/operator.html', 'public/superadmin.html'];

for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    
    // Replace stylesheet link
    content = content.replace(
        /<link rel="stylesheet" href="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/6\.4\.0\/css\/all\.min\.css">/,
        '<script src="https://unpkg.com/@phosphor-icons/web"></script>'
    );
    
    // Replace all icon classes
    for (const [fa, ph] of Object.entries(fontAwesomeToPhosphor)) {
        const regex = new RegExp(fa, 'g');
        content = content.replace(regex, ph);
    }
    
    fs.writeFileSync(file, content);
    console.log(`Updated ${file}`);
}

// Update style.css
let css = fs.readFileSync('public/style.css', 'utf8');
css = css.replace(/i\.fa-solid \{/, 'i[class^="ph-"], i[class*=" ph-"] {');
fs.writeFileSync('public/style.css', css);
console.log("Updated style.css");
