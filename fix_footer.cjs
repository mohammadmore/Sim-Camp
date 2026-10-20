const fs = require('fs');

let css = fs.readFileSync('public/style.css', 'utf8');

// Replace Mobile Footer
css = css.replace(/\/\* Mobile Footer \*\/[\s\S]*?(?=\}\s*\/\* Base Footer \*\/)/, 
`/* Mobile Footer */
    .asva-footer {
        margin: 20px auto 40px auto !important;
        line-height: 1.8 !important;
        white-space: normal !important;
        padding: 12px 20px !important;
        width: 85% !important;
        max-width: 400px !important;
        border-radius: 15px !important;
    }
    .credit-divider {
        display: none !important;
    }
    .fa-credit {
        display: block !important;
    }
    .en-credit {
        display: block !important;
        font-size: 16px !important;
        letter-spacing: 0.5px !important;
        margin-bottom: -2px !important;
    }
`);

// Replace Base Footer
css = css.replace(/\/\* Base Footer \*\/[\s\S]*?(?=\/\* Icon adjustments \*\/)/, 
`/* Base Footer */
.asva-footer {
    position: relative;
    margin: auto auto 15px auto; /* auto margin-top pushes it to the bottom of the flex container */
    align-self: center; /* perfectly center horizontally in a flex column */
    width: max-content;
    text-align: center;
    font-size: 13px;
    z-index: 9999;
    padding: 8px 20px;
    border-radius: 20px;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
    color: #ffffff;
    white-space: nowrap;
    pointer-events: none;
}
[data-theme="light"] .asva-footer {
    background: rgba(255, 255, 255, 0.6);
    border: 1px solid rgba(0, 0, 0, 0.05);
    color: #333333;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05);
}
`);

fs.writeFileSync('public/style.css', css);
console.log("Replaced CSS logic!");

// Also update HTML to ensure spacer exists
let html = fs.readFileSync('public/board.html', 'utf8');

// Ensure spacer is set to push the footer down in flexbox if needed, although margin: auto auto does it too
html = html.replace(
    /    <div class="asva-spacer" style="flex-grow: 1;"><\/div>/,
    '    <div class="asva-spacer" style="flex-grow: 1; flex-shrink: 0; min-height: 20px;"></div>' 
);

html = html.replace(/style\.css\?v=\d+/g, 'style.css?v=6');
fs.writeFileSync('public/board.html', html);

