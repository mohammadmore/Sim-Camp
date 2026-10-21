const fs = require('fs');
let html = fs.readFileSync('public/board.html', 'utf-8');

if (!html.includes('id="bgLogo"')) {
    html = html.replace(
        '<body style="overflow: hidden;"> <!-- Prevent scrolling during dynamic resizing -->',
        '<body style="overflow: hidden;"> <!-- Prevent scrolling during dynamic resizing -->\n    <img id="bgLogo" style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 80vmin; height: 80vmin; object-fit: contain; opacity: 0.15; z-index: -1; pointer-events: none; display: none;" />'
    );
}

html = html.replace(
    'const logoEl = document.getElementById(\'orgLogo\');',
    `const logoEl = document.getElementById('orgLogo');
            const bgLogoEl = document.getElementById('bgLogo');`
);

html = html.replace(
    /logoEl\.src = data\.logo;\s*logoEl\.style\.display = 'block';/g,
    `logoEl.src = data.logo;
                logoEl.style.display = 'block';
                if (bgLogoEl) {
                    bgLogoEl.src = data.logo;
                    bgLogoEl.style.display = 'block';
                }`
);

html = html.replace(
    /logoEl\.style\.display = 'none';/g,
    `logoEl.style.display = 'none';
                if (bgLogoEl) {
                    bgLogoEl.style.display = 'none';
                }`
);

fs.writeFileSync('public/board.html', html);
console.log("Background logo added.");
