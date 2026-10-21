const fs = require('fs');
let html = fs.readFileSync('public/superadmin.html', 'utf8');

// The first replace didn't work because I used the wrong matching string in the previous step for the old layout, let me fix everything using simpler regexes

// 1. Let's find the card.innerHTML assignment and just rewrite the whole block
const cardRegex = /card\.innerHTML = `[\s\S]*?grid\.appendChild\(card\);/g;

const newCardCode = `card.innerHTML = \`
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 5px;">
                        <div style="flex-grow: 1; padding-left: 10px;">
                            <h3 style="margin: 0 0 8px 0; font-size: 18px; line-height: 1.4;">\${camp.title || 'بدون عنوان'}</h3>
                            <div style="font-size: 13px; opacity: 0.7; display: flex; align-items: center; gap: 5px;">
                                <i data-lucide="building-2" style="width: 14px; height: 14px;"></i> 
                                \${camp.orgName || '-'}
                            </div>
                        </div>
                        \${statusBadge}
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 15px;">
                        <button onclick="openSetupMode('\${camp.id}')" title="ویرایش تنظیمات" style="padding: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; border-radius: 12px;">
                            <i data-lucide="edit-2" style="width: 16px; height: 16px;"></i> ویرایش
                        </button>
                        <button onclick="toggleLock('\${camp.id}', \${!isLocked})" title="\${isLocked ? 'باز کردن' : 'قفل کردن'}" style="padding: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(255, 76, 76, 0.15); color: var(--danger-color); border: 1px solid rgba(255, 76, 76, 0.3); border-radius: 12px;">
                            \${isLocked ? '<i data-lucide="unlock" style="width: 16px; height: 16px;"></i> باز' : '<i data-lucide="lock" style="width: 16px; height: 16px;"></i> قفل'}
                        </button>
                        <div style="grid-column: span 2;">
                            \${archiveBtn}
                        </div>
                        <a href="operator.html?id=\${camp.id}" target="_blank" class="icon-btn" style="grid-column: span 2; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(79, 172, 254, 0.1); color: #4facfe; border: 1px solid rgba(79, 172, 254, 0.2); text-decoration: none; font-size: 14px; padding: 12px; border-radius: 12px; width: 100%; box-sizing: border-box; transition: all 0.3s;">
                            <i data-lucide="external-link" style="width: 16px; height: 16px;"></i> پنل اپراتور
                        </a>
                    </div>
                \`;
                grid.appendChild(card);`;

html = html.replace(cardRegex, newCardCode);

// 2. Fix the archive button definitions again just to be safe
const oldArchivedDef = /const archiveBtn = camp\.archived[\s\S]*?;/;

const newArchivedDef = `const archiveBtn = camp.archived
                    ? \`<button onclick="toggleArchive('\${camp.id}', false, this)" title="خروج از آرشیو" style="width: 100%; padding: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(255, 165, 0, 0.15); color: #ffa500; border: 1px solid rgba(255, 165, 0, 0.3); border-radius: 12px;">
                            <i data-lucide="arrow-up-circle" style="width: 16px; height: 16px;"></i> خروج از آرشیو
                        </button>\`
                    : \`<button onclick="toggleArchive('\${camp.id}', true, this)" title="آرشیو این رویداد" style="width: 100%; padding: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(100, 100, 100, 0.2); border: 1px solid rgba(100,100,100,0.3); border-radius: 12px; color: var(--text-color);">
                            <i data-lucide="archive" style="width: 16px; height: 16px;"></i> آرشیو
                        </button>\`;`;
                        
html = html.replace(oldArchivedDef, newArchivedDef);

fs.writeFileSync('public/superadmin.html', html);
console.log("Card layout replaced perfectly");
