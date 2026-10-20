const fs = require('fs');
let html = fs.readFileSync('public/superadmin.html', 'utf8');

// Replace the card buttons HTML layout
const oldLayout = /<div style="display: flex; gap: 10px; margin-top: 10px;">\s*<button onclick="openSetupMode\('\$\\{camp\.id\\}'\)" title="ویرایش تنظیمات" style="flex: 1; padding: 8px;">ویرایش <i data-lucide="edit-2" style="width: 14px; height: 14px; margin-right: 5px;"><\/i><\/button>\s*<button onclick="toggleLock\('\$\\{camp\.id\\}', \$\\{!isLocked\\}\)" title="قفل کردن" style="flex: 1; padding: 8px; background: rgba\(255, 76, 76, 0\.2\); color: var\(--danger-color\); border: 1px solid rgba\(255, 76, 76, 0\.5\);">\s*\$\\{isLocked \? 'باز کردن' : 'قفل <i data-lucide="lock" style="width: 14px; height: 14px; margin-right: 5px;"><\/i>'\s*\}\s*<\/button>\s*<\/div>\s*<div style="display: flex; gap: 10px; margin-top: 10px;">\s*\$\\{archiveBtn\\}\s*<\/div>\s*<a href="operator\.html\?id=\$\\{camp\.id\\}" target="_blank" class="icon-btn" style="text-align: center; color: #4facfe; text-decoration: none; font-size: 14px; margin-top: 15px; width: 100%; box-sizing: border-box;">مشاهده پنل اپراتور ↗️<\/a>/;

const newLayout = `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 15px;">
                        <button onclick="openSetupMode('\${camp.id}')" title="ویرایش تنظیمات" style="padding: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; border-radius: 12px;">
                            <i data-lucide="edit-2" style="width: 16px; height: 16px;"></i> ویرایش
                        </button>
                        <button onclick="toggleLock('\${camp.id}', \${!isLocked})" title="\${isLocked ? 'باز کردن' : 'قفل کردن'}" style="padding: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(255, 76, 76, 0.15); color: var(--danger-color); border: 1px solid rgba(255, 76, 76, 0.3); border-radius: 12px;">
                            \${isLocked ? '<i data-lucide="unlock" style="width: 16px; height: 16px;"></i> باز کردن' : '<i data-lucide="lock" style="width: 16px; height: 16px;"></i> قفل'}
                        </button>
                        <div style="grid-column: span 2;">
                            \${archiveBtn}
                        </div>
                        <a href="operator.html?id=\${camp.id}" target="_blank" class="icon-btn" style="grid-column: span 2; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(79, 172, 254, 0.1); color: #4facfe; border: 1px solid rgba(79, 172, 254, 0.2); text-decoration: none; font-size: 14px; padding: 12px; border-radius: 12px; width: 100%; box-sizing: border-box;">
                            <i data-lucide="external-link" style="width: 16px; height: 16px;"></i> مشاهده پنل اپراتور
                        </a>
                    </div>`;

html = html.replace(oldLayout, newLayout);

// Also fix the archive button styles in JS logic
const oldArchiveTrue = /`<button onclick="toggleArchive\('\\?\$\\{camp\.id\\}'\?, true, this\)" title="آرشیو این رویداد" style="flex: 1; padding: 8px; background: rgba\(100, 100, 100, 0\.2\); border: 1px solid rgba\(100,100,100,0\.5\);">آرشیو <i data-lucide="archive" style="width: 14px; height: 14px; margin-right: 5px;"><\/i><\/button>`/;
const newArchiveTrue = `\`<button onclick="toggleArchive('\${camp.id}', true, this)" title="آرشیو این رویداد" style="width: 100%; padding: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(100, 100, 100, 0.2); border: 1px solid rgba(100,100,100,0.3); border-radius: 12px; color: var(--text-color);">
                            <i data-lucide="archive" style="width: 16px; height: 16px;"></i> آرشیو
                        </button>\``;

const oldArchiveFalse = /`<button onclick="toggleArchive\('\\?\$\\{camp\.id\\}'\?, false, this\)" title="خروج از آرشیو" style="flex: 1; padding: 8px; background: rgba\(255, 165, 0, 0\.2\); color: #ffa500; border: 1px solid rgba\(255,165,0,0\.5\);">بازگشت به صفحه اصلی <i data-lucide="arrow-up-circle" style="width: 14px; height: 14px; margin-right: 5px;"><\/i><\/button>`/;
const newArchiveFalse = `\`<button onclick="toggleArchive('\${camp.id}', false, this)" title="خروج از آرشیو" style="width: 100%; padding: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(255, 165, 0, 0.15); color: #ffa500; border: 1px solid rgba(255, 165, 0, 0.3); border-radius: 12px;">
                            <i data-lucide="arrow-up-circle" style="width: 16px; height: 16px;"></i> بازگشت به صفحه اصلی
                        </button>\``;

html = html.replace(oldArchiveTrue, newArchiveTrue);
html = html.replace(oldArchiveFalse, newArchiveFalse);

fs.writeFileSync('public/superadmin.html', html);
console.log("Card layout fixed");
