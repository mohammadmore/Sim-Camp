const fs = require('fs');

let html = fs.readFileSync('public/board.html', 'utf8');

// The inline styles on HTML divs are overriding the !important CSS order in flexbox on some browsers
// Let's strip the hardcoded inline styles from the header containers and rely cleanly on CSS
html = html.replace(
    /style="flex: 0 0 auto; display: flex; align-items: center;"/g,
    'class="logo-container"'
);

html = html.replace(
    /style="flex: 1 1 auto; text-align: center; display: flex; flex-direction: column; justify-content: center; padding: 0 20px;"/g,
    'class="title-container"'
);

html = html.replace(
    /style="display:none; max-height: 15vh; padding: 10px; box-sizing: border-box; max-width: 25vw; object-fit: contain;"/g,
    'style="display:none; object-fit: contain;"'
);

html = html.replace(/style\.css\?v=\d+/g, 'style.css?v=10');
fs.writeFileSync('public/board.html', html);


let css = fs.readFileSync('public/style.css', 'utf8');

// Add base desktop styles for the header containers since we removed inline styles
css = css.replace(
    /\/\* Board specific absolute positioning \*\//,
    `/* Board Header Containers */
.logo-container {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
}
.title-container {
    flex: 1 1 auto;
    text-align: center;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 20px;
}
#boardSystemLogo, #orgLogo {
    max-height: 15vh;
    padding: 10px;
    box-sizing: border-box;
    max-width: 25vw;
}

/* Board specific absolute positioning */`
);

// Mobile overrides:
css = css.replace(
    /#boardHeader > div:nth-child\(1\) \{ order: 1; width: 50% !important; justify-content: flex-end !important; padding-right: 5px !important; \} \/\* Left logo \*\//,
    '.logo-container:first-child { order: 1 !important; width: 50% !important; justify-content: flex-end !important; padding-right: 5px !important; }'
);
css = css.replace(
    /#boardHeader > div:nth-child\(2\) \{ order: 3; width: 100% !important; padding: 0 10px !important; margin-top: 10px !important; \} \/\* Title full width bottom \*\//,
    '.title-container { order: 3 !important; width: 100% !important; padding: 0 10px !important; margin-top: 10px !important; flex: none !important; }'
);
css = css.replace(
    /#boardHeader > div:nth-child\(3\) \{ order: 2; width: 50% !important; justify-content: flex-start !important; padding-left: 5px !important; \} \/\* Right logo \*\//,
    '.logo-container:last-child { order: 2 !important; width: 50% !important; justify-content: flex-start !important; padding-left: 5px !important; }'
);

// Clean up duplicate #boardHeader block
css = css.replace(
    /#boardHeader \{\n        flex-direction: column !important;\n        height: auto !important;\n        gap: 15px !important;\n        margin-top: 25px !important; \/\* Space from top \*\/\n    \}/,
    ''
);
css = css.replace(
    /#boardHeader \{\n        flex-direction: row !important;\n        flex-wrap: wrap !important;\n        justify-content: center !important;\n    \}/,
    '#boardHeader {\n        flex-direction: row !important;\n        flex-wrap: wrap !important;\n        justify-content: center !important;\n        height: auto !important;\n        margin-top: 15px !important;\n        gap: 0 !important;\n    }'
);


fs.writeFileSync('public/style.css', css);
console.log("Patched HTML and CSS!");
