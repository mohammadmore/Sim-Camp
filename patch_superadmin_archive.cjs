const fs = require('fs');
let html = fs.readFileSync('public/superadmin.html', 'utf8');

// Add the button
html = html.replace(
    /<button onclick="openGlobalSettings\(\)"/,
    `<button onclick="toggleAllCampsView()" id="toggleAllCampsBtn" style="background: rgba(255, 255, 255, 0.15); color: var(--text-color); border: 1px solid var(--glass-border); padding: 15px 30px; border-radius: 15px; font-size: 16px; display: flex; align-items: center; gap: 8px;" title="نمایش همه مسابقات (آرشیو شده و فعال)">
                <i data-lucide="layers"></i> مسابقات
            </button>
            <button onclick="openGlobalSettings()"`
);

// We need to inject the logic to renderCampsGrid
// Replace loadCamps and renderCampsGrid
const scriptToReplace = /function loadCamps\(\) \{[\s\S]*?if\(typeof refreshIcons === 'function'\) refreshIcons\(\);\s*\}/;

const newScript = `
        let allFetchedCamps = [];
        let viewingAllCamps = false;

        function toggleAllCampsView() {
            viewingAllCamps = !viewingAllCamps;
            const btn = document.getElementById('toggleAllCampsBtn');
            if (viewingAllCamps) {
                btn.style.background = 'var(--blue-bg)';
                btn.style.color = 'var(--blue-color)';
                btn.innerHTML = '<i data-lucide="layers"></i> فقط فعال‌ها';
            } else {
                btn.style.background = 'rgba(255, 255, 255, 0.15)';
                btn.style.color = 'var(--text-color)';
                btn.innerHTML = '<i data-lucide="layers"></i> مسابقات';
            }
            if(typeof refreshIcons === 'function') refreshIcons();
            renderCampsGrid();
        }

        function toggleArchive(id, status) {
            fetch(\`/superadmin/camps/\${id}/archive\`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ archived: status })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) loadCamps();
            });
        }

        function loadCamps() {
            fetch('/superadmin/camps')
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    allFetchedCamps = data.camps;
                    renderCampsGrid();
                }
            });
        }

        function renderCampsGrid() {
            const grid = document.getElementById('campsGrid');
            grid.innerHTML = '';
            
            let campsToShow = allFetchedCamps;
            if (!viewingAllCamps) {
                campsToShow = allFetchedCamps.filter(c => !c.archived);
            }
            
            if (campsToShow.length === 0) {
                grid.innerHTML = '<p>هیچ مسابقه‌ای برای نمایش وجود ندارد.</p>';
                return;
            }

            campsToShow.forEach(camp => {
                const card = document.createElement('div');
                card.className = 'camp-card';
                if (camp.archived) card.style.opacity = '0.7';
                
                const isLocked = camp.locked === 1;
                const statusBadge = isLocked 
                    ? '<span class="camp-badge badge-locked"><i data-lucide="lock"></i> قفل شده</span>'
                    : '<span class="camp-badge badge-active"><i data-lucide="check-circle" style="width: 14px; height: 14px; margin-left: 5px;"></i> فعال</span>';

                const archiveBtn = camp.archived
                    ? \`<button onclick="toggleArchive('\${camp.id}', false)" title="خروج از آرشیو" style="flex: 1; padding: 8px; background: rgba(255, 165, 0, 0.2); color: #ffa500; border: 1px solid rgba(255,165,0,0.5);">بازگشت به صفحه اصلی <i data-lucide="arrow-up-circle" style="width: 14px; height: 14px; margin-right: 5px;"></i></button>\`
                    : \`<button onclick="toggleArchive('\${camp.id}', true)" title="آرشیو این رویداد" style="flex: 1; padding: 8px; background: rgba(100, 100, 100, 0.2); border: 1px solid rgba(100,100,100,0.5);">آرشیو <i data-lucide="archive" style="width: 14px; height: 14px; margin-right: 5px;"></i></button>\`;

                card.innerHTML = \`
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div>
                            <h3 style="margin: 0 0 5px 0;">\${camp.title || 'بدون عنوان'}</h3>
                            <div style="font-size: 14px; opacity: 0.7;">سازمان: \${camp.orgName || '-'}</div>
                        </div>
                        \${statusBadge}
                    </div>
                    <div style="display: flex; gap: 10px; margin-top: 10px;">
                        <button onclick="openSetupMode('\${camp.id}')" title="ویرایش تنظیمات" style="flex: 1; padding: 8px;">ویرایش <i data-lucide="edit-2" style="width: 14px; height: 14px; margin-right: 5px;"></i></button>
                        <button onclick="toggleLock('\${camp.id}', \${!isLocked})" title="قفل کردن" style="flex: 1; padding: 8px; background: rgba(255, 76, 76, 0.2); color: var(--danger-color); border: 1px solid rgba(255, 76, 76, 0.5);">
                            \${isLocked ? 'باز کردن' : 'قفل <i data-lucide="lock" style="width: 14px; height: 14px; margin-right: 5px;"></i>'}
                        </button>
                    </div>
                    <div style="display: flex; gap: 10px; margin-top: 10px;">
                        \${archiveBtn}
                    </div>
                    <a href="operator.html?id=\${camp.id}" target="_blank" class="icon-btn" style="text-align: center; color: #4facfe; text-decoration: none; font-size: 14px; margin-top: 15px; width: 100%; box-sizing: border-box;">مشاهده پنل اپراتور ↗️</a>
                \`;
                grid.appendChild(card);
            });
            if(typeof refreshIcons === 'function') refreshIcons();
        }`;

html = html.replace(scriptToReplace, newScript);
fs.writeFileSync('public/superadmin.html', html);
console.log("Patched superadmin.html for archive buttons");
