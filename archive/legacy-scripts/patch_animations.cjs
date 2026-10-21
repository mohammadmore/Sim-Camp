const fs = require('fs');

// 1. Add transition to CSS
let css = fs.readFileSync('public/style.css', 'utf8');

// Add transition for opacity to the camp-card
css = css.replace(
    /transition: transform 0\.3s;/,
    `transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s, color 0.3s;`
);

// Also add a general class for smooth grid items
if (!css.includes('.fade-in-up')) {
    css += `
/* Smooth Animations */
@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(15px); }
    to { opacity: 1; transform: translateY(0); }
}
.fade-in-up {
    animation: fadeInUp 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
.fade-out {
    opacity: 0 !important;
    transform: scale(0.95);
    pointer-events: none;
}
button {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
`;
}
fs.writeFileSync('public/style.css', css);

// 2. Add transition logic to HTML
let html = fs.readFileSync('public/superadmin.html', 'utf8');

const oldScript = `            campsToShow.forEach(camp => {
                const card = document.createElement('div');
                card.className = 'camp-card';
                if (camp.archived) card.style.opacity = '0.7';`;

const newScript = `            campsToShow.forEach((camp, index) => {
                const card = document.createElement('div');
                card.className = 'camp-card fade-in-up';
                card.style.animationDelay = \`\${index * 0.05}s\`;
                if (camp.archived) card.style.opacity = '0.6';`;

html = html.replace(oldScript, newScript);

// Add smooth fade out when archiving/unarchiving
const oldToggle = `        function toggleArchive(id, status) {
            fetch(\`/superadmin/camps/\${id}/archive\`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ archived: status })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) loadCamps();
            });
        }`;

const newToggle = `        function toggleArchive(id, status, btnElement) {
            const card = btnElement.closest('.camp-card');
            if(card) {
                if(!viewingAllCamps) {
                    card.classList.add('fade-out');
                } else {
                    card.style.opacity = status ? '0.6' : '1';
                    // Update button visually before reload
                    btnElement.style.opacity = '0.5';
                    btnElement.innerText = 'درحال ثبت...';
                }
            }
            
            setTimeout(() => {
                fetch(\`/superadmin/camps/\${id}/archive\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ archived: status })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) loadCamps();
                });
            }, !viewingAllCamps ? 300 : 0); // Wait for fade out animation if hiding
        }`;
html = html.replace(oldToggle, newToggle);

// Fix the onclick references
html = html.replace(/toggleArchive\('\\?\$\{\s*camp\.id\s*\}'?,\s*false\)/g, `toggleArchive('\${camp.id}', false, this)`);
html = html.replace(/toggleArchive\('\\?\$\{\s*camp\.id\s*\}'?,\s*true\)/g, `toggleArchive('\${camp.id}', true, this)`);


fs.writeFileSync('public/superadmin.html', html);
console.log('Added animations');
