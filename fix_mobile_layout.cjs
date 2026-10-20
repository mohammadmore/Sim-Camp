const fs = require('fs');
let css = fs.readFileSync('public/style.css', 'utf8');

// Replace mobile header and footer styles
css = css.replace(/\/\* Board & Operator Headers for Mobile \*\/[\s\S]*?(?=\}\s*\/\* Base Footer \*\/)/, `/* Board & Operator Headers for Mobile */
    #boardHeader {
        flex-direction: column !important;
        height: auto !important;
        gap: 15px !important;
        margin-top: 25px !important; /* Space from top */
    }
    #boardHeader > div {
        width: 100% !important;
        justify-content: center !important;
        flex-direction: row !important; /* Keep logos inside their wrappers normal */
    }
    /* Let's put the logos side by side in a new row if we could, but they are in separate divs.
       Actually, since they are flex items, we can use order to stack title first, then logos. Or we can just let them stack.
       A better approach: We have 3 divs: Logo1, Title, Logo2. 
       Let's put Title on top, and logos below side-by-side using a trick or just display them elegantly.
    */
    #boardHeader > div:nth-child(1) { order: 2; width: 50% !important; } /* Left logo */
    #boardHeader > div:nth-child(2) { order: 1; padding: 0 10px !important; } /* Title */
    #boardHeader > div:nth-child(3) { order: 3; width: 50% !important; } /* Right logo */
    
    /* Make the logos sit side by side by making the header a flex wrap container */
    #boardHeader {
        flex-direction: row !important;
        flex-wrap: wrap !important;
        justify-content: center !important;
    }
    
    #boardSystemLogo, #orgLogo {
        max-height: 10vh !important;
        max-width: 100% !important;
        padding: 5px !important;
    }
    
    #campTitleText {
        font-size: clamp(20px, 6vw, 30px) !important;
        white-space: normal !important;
        line-height: 1.3 !important;
    }

    .op-header-container {
        flex-direction: column !important;
        justify-content: center !important;
        height: auto !important;
    }
    .op-title-section {
        flex-direction: column !important;
        gap: 10px !important;
    }
    
    /* Mobile Footer */
    .asva-footer {
        margin: 20px auto 40px auto !important;
        line-height: 1.6 !important;
        white-space: normal !important;
        padding: 10px 15px !important;
        width: 90% !important;
        max-width: 320px !important;
        border-radius: 12px !important;
        font-size: 11px !important;
        background: rgba(0, 0, 0, 0.6) !important;
        backdrop-filter: blur(15px) !important;
        box-shadow: 0 8px 25px rgba(0,0,0,0.3) !important;
        border: 1px solid rgba(255,255,255,0.15) !important;
    }
    .asva-footer span {
        display: block !important;
        margin: 4px 0 !important;
    }
    .credit-divider {
        display: none !important;
    }
    .en-credit {
        font-size: 13px !important;
        font-weight: 600 !important;
        letter-spacing: 0.5px !important;
        opacity: 0.9;
    }
    .fa-credit {
        opacity: 0.8;
    }
`);

fs.writeFileSync('public/style.css', css);
console.log("Patched mobile styles!");
