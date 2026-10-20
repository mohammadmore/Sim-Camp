const fs = require('fs');
let html = fs.readFileSync('public/superadmin.html', 'utf8');

const oldToggle = /function toggleArchive\(id, status, btnElement\) \{[\s\S]*?body: JSON\.stringify\(\{ archived: status \}\)\n                \}\)\n                \.then\(res => res\.json\(\)\)\n                \.then\(data => \{\n                    if \(data\.success\) loadCamps\(\);\n                \}\);\n            \}, !viewingAllCamps \? 300 : 0\); \/\/ Wait for fade out animation if hiding\n        \}/;

const newToggle = `function toggleArchive(id, status, btnElement) {
            const card = btnElement.closest('.camp-card');
            if(card) {
                if(!viewingAllCamps) {
                    const targetBtn = document.getElementById('toggleAllCampsBtn');
                    const cardRect = card.getBoundingClientRect();
                    const targetRect = targetBtn.getBoundingClientRect();
                    
                    // Calculate translation distance
                    const deltaX = (targetRect.left + targetRect.width / 2) - (cardRect.left + cardRect.width / 2);
                    const deltaY = (targetRect.top + targetRect.height / 2) - (cardRect.top + cardRect.height / 2);
                    
                    // Set relative position so z-index works to fly over everything
                    card.style.position = 'relative';
                    card.style.zIndex = '9999';
                    card.style.pointerEvents = 'none'; // Avoid intercepting clicks
                    
                    // Apply smooth fly-away transform
                    card.style.transition = 'transform 0.6s cubic-bezier(0.5, 0, 0.2, 1), opacity 0.5s ease-out';
                    card.style.transform = \`translate(\${deltaX}px, \${deltaY}px) scale(0.05)\`;
                    card.style.opacity = '0';
                    
                    // Pulse the target button slightly when the card "arrives"
                    setTimeout(() => {
                        targetBtn.style.transform = 'scale(1.1)';
                        targetBtn.style.transition = 'transform 0.2s';
                        setTimeout(() => targetBtn.style.transform = 'scale(1)', 200);
                    }, 500);

                } else {
                    card.style.opacity = status ? '0.6' : '1';
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
            }, !viewingAllCamps ? 600 : 0);
        }`;

html = html.replace(oldToggle, newToggle);
fs.writeFileSync('public/superadmin.html', html);
console.log('Patched flying animation!');
