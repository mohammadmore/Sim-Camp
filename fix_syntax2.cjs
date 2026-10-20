const fs = require('fs');
let html = fs.readFileSync('public/superadmin.html', 'utf8');

const regex = /const archiveBtn = camp\.archived[\s\S]*?card\.innerHTML = `/g;

const newBtn = `const archiveBtn = camp.archived
                    ? \`<button onclick="toggleArchive('\${camp.id}', false, this)" title="خروج از آرشیو" style="width: 100%; padding: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(255, 165, 0, 0.15); color: #ffa500; border: 1px solid rgba(255, 165, 0, 0.3); border-radius: 12px;">
                            <i data-lucide="arrow-up-circle" style="width: 16px; height: 16px;"></i> خروج از آرشیو
                        </button>\`
                    : \`<button onclick="toggleArchive('\${camp.id}', true, this)" title="آرشیو این رویداد" style="width: 100%; padding: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(100, 100, 100, 0.2); border: 1px solid rgba(100,100,100,0.3); border-radius: 12px; color: var(--text-color);">
                            <i data-lucide="archive" style="width: 16px; height: 16px;"></i> آرشیو
                        </button>\`;
                
                card.innerHTML = \``;

html = html.replace(regex, newBtn);
fs.writeFileSync('public/superadmin.html', html);
console.log('Fixed syntax again');
