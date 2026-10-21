const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

const oldHeader = `<div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center;">
                <a id="boardLink" href="#" target="_blank" class="icon-btn" style="text-decoration: none; color: inherit; background: var(--blue-bg); border-color: var(--blue-border);">اسکوربورد <i data-lucide="trending-up"></i></a>
                    
                <div class="snapshot-btn-group" style="display: flex; align-items: center; background: var(--input-bg); border-radius: 10px; border: 1px solid var(--glass-border);" title="مستندسازی و دانلود اسکرین‌شات">
                    <button onclick="takeSnapshot()" style="background: transparent; border: none; padding: 8px 12px; cursor: pointer; color: inherit; font-size: 14px; font-family: inherit; display: flex; align-items: center; gap: 5px; border-radius: 0; box-shadow: none;"><i data-lucide="camera"></i> ثبت تصویر</button>
                    <div style="width: 1px; background: var(--glass-border); height: 25px;"></div>
                    <label style="display: flex; align-items: center; padding: 8px 10px; cursor: pointer; gap: 5px; font-size: 13px; margin: 0;">
                        <input type="checkbox" id="autoSnapshotToggle" onchange="toggleAutoSnapshot()" style="margin: 0;" checked>
                        خودکار
                    </label>
                </div>
                   
                <button onclick="openSettings()" id="btnSettings" class="icon-btn">تنظیمات <i data-lucide="settings"></i></button>
                <button onclick="logout()" class="icon-btn logout-btn" style="background: var(--danger-bg); color: var(--danger-color); border-color: var(--error-color);">خروج <i data-lucide="log-out"></i></button>
            </div>`;

const newHeader = `<div style="display: flex; gap: 10px; align-items: stretch; flex-wrap: wrap; justify-content: center;">
                <a id="boardLink" href="#" target="_blank" class="icon-btn" style="text-decoration: none; color: inherit; background: var(--blue-bg); border-color: var(--blue-border); border-radius: 8px; font-size: 14px; padding: 0 16px; height: 42px; box-sizing: border-box;">اسکوربورد <i data-lucide="trending-up" style="width: 16px; height: 16px; margin-right: 6px;"></i></a>
                    
                <div class="snapshot-btn-group" style="display: flex; align-items: stretch; background: var(--input-bg); border-radius: 8px; border: 1px solid var(--glass-border); height: 42px; box-sizing: border-box;" title="مستندسازی و دانلود اسکرین‌شات">
                    <button onclick="takeSnapshot()" style="background: transparent; border: none; padding: 0 12px; cursor: pointer; color: inherit; font-size: 14px; font-family: inherit; display: flex; align-items: center; gap: 6px; border-radius: 0; box-shadow: none;"><i data-lucide="camera" style="width: 16px; height: 16px;"></i> ثبت تصویر</button>
                    <div style="width: 1px; background: var(--glass-border); align-self: stretch; margin: 8px 0;"></div>
                    <label style="display: flex; align-items: center; padding: 0 12px; cursor: pointer; gap: 6px; font-size: 13px; margin: 0;">
                        <input type="checkbox" id="autoSnapshotToggle" onchange="toggleAutoSnapshot()" style="margin: 0;" checked>
                        خودکار
                    </label>
                </div>
                   
                <button onclick="openSettings()" id="btnSettings" class="icon-btn" style="border-radius: 8px; font-size: 14px; padding: 0 16px; height: 42px; box-sizing: border-box;">تنظیمات <i data-lucide="settings" style="width: 16px; height: 16px; margin-right: 6px;"></i></button>
                <button onclick="logout()" class="icon-btn logout-btn" style="background: var(--danger-bg); color: var(--danger-color); border-color: var(--error-color); border-radius: 8px; font-size: 14px; padding: 0 16px; height: 42px; box-sizing: border-box;">خروج <i data-lucide="log-out" style="width: 16px; height: 16px; margin-right: 6px;"></i></button>
            </div>`;

if (html.includes(oldHeader)) {
    html = html.replace(oldHeader, newHeader);
    fs.writeFileSync('public/operator.html', html);
    console.log('Patched correctly with exact match');
} else {
    console.log('Failed to match exactly, attempting regex');
    // regex fallback
    const regex = /<div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center;">[\s\S]*?<button onclick="logout\(\)"[^>]*>خروج[^<]*<\/button>[\s\S]*?<\/div>/;
    html = html.replace(regex, newHeader);
    fs.writeFileSync('public/operator.html', html);
    console.log('Patched with regex');
}
