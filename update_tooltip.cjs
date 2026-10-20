const fs = require('fs');

const js = `
document.addEventListener('DOMContentLoaded', () => {
    const tooltipEl = document.createElement('div');
    tooltipEl.id = 'custom-tooltip';
    document.body.appendChild(tooltipEl);

    let currentTarget = null;
    let hoverTimer = null;
    let lastX = 0;
    let lastY = 0;
    let isVisible = false;

    function updatePosition() {
        tooltipEl.style.left = lastX + 'px';
        tooltipEl.style.top = lastY + 'px';
        
        // Boundary correction
        const rect = tooltipEl.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            tooltipEl.style.left = (lastX - rect.width - 30) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            tooltipEl.style.top = (lastY - rect.height - 30) + 'px';
        }
    }

    document.addEventListener('mousemove', (e) => {
        const target = e.target.closest('[title], [data-title]');
        lastX = e.clientX + 15;
        lastY = e.clientY + 15;
        
        if (target) {
            if (target.hasAttribute('title')) {
                target.setAttribute('data-title', target.getAttribute('title'));
                target.removeAttribute('title');
            }
            
            if (currentTarget !== target) {
                currentTarget = target;
                clearTimeout(hoverTimer);
                tooltipEl.classList.remove('show');
                isVisible = false;
                
                hoverTimer = setTimeout(() => {
                    tooltipEl.textContent = target.getAttribute('data-title');
                    tooltipEl.classList.add('show');
                    isVisible = true;
                    updatePosition();
                }, 1000);
            }
            
            if (isVisible) {
                updatePosition();
            }
        } else {
            if (currentTarget) {
                currentTarget = null;
                clearTimeout(hoverTimer);
                tooltipEl.classList.remove('show');
                isVisible = false;
            }
        }
    });
    
    document.addEventListener('click', () => {
        if (currentTarget) {
            clearTimeout(hoverTimer);
            tooltipEl.classList.remove('show');
            isVisible = false;
            currentTarget = null;
        }
    });
});
`;

fs.writeFileSync('public/tooltip.js', js.trim());
console.log('Tooltip JS updated with 1s delay');
