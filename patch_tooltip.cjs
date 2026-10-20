const fs = require('fs');

// 1. Append CSS
const css = `
/* Custom Tooltip */
#custom-tooltip {
    position: fixed;
    background: var(--input-bg);
    color: var(--text-color);
    border: 1px solid var(--glass-border);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    font-family: inherit;
    pointer-events: none;
    z-index: 999999;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.15s ease-in-out;
    white-space: nowrap;
    box-shadow: var(--glass-shadow);
}
#custom-tooltip.show {
    opacity: 1;
    visibility: visible;
}
`;
fs.appendFileSync('public/style.css', css);

// 2. Create JS file
const js = `
document.addEventListener('DOMContentLoaded', () => {
    const tooltipEl = document.createElement('div');
    tooltipEl.id = 'custom-tooltip';
    document.body.appendChild(tooltipEl);

    let currentTarget = null;

    document.addEventListener('mousemove', (e) => {
        const target = e.target.closest('[title], [data-title]');
        
        if (target) {
            if (target.hasAttribute('title')) {
                target.setAttribute('data-title', target.getAttribute('title'));
                target.removeAttribute('title');
            }
            
            if (currentTarget !== target) {
                currentTarget = target;
                tooltipEl.textContent = target.getAttribute('data-title');
                tooltipEl.classList.add('show');
            }
            
            // Position offset (follows cursor)
            let x = e.clientX + 15;
            let y = e.clientY + 15;
            
            tooltipEl.style.left = x + 'px';
            tooltipEl.style.top = y + 'px';
            
            // Boundary correction
            const rect = tooltipEl.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                tooltipEl.style.left = (e.clientX - rect.width - 15) + 'px';
            }
            if (rect.bottom > window.innerHeight) {
                tooltipEl.style.top = (e.clientY - rect.height - 15) + 'px';
            }
            
        } else {
            if (currentTarget) {
                currentTarget = null;
                tooltipEl.classList.remove('show');
            }
        }
    });
    
    // Hide on click or touch
    document.addEventListener('click', () => {
        if (currentTarget) {
            tooltipEl.classList.remove('show');
            currentTarget = null;
        }
    });
});
`;
fs.writeFileSync('public/tooltip.js', js);

// 3. Inject JS into HTML files
const files = ['public/superadmin.html', 'public/operator.html', 'public/board.html'];
for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    if (!content.includes('<script src="tooltip.js"></script>')) {
        content = content.replace('</body>', '    <script src="tooltip.js"></script>\n</body>');
        fs.writeFileSync(file, content);
    }
}

console.log('Tooltips implemented');
