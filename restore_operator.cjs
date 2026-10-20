const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf-8');

const replacement = `            <div class="op-title-section" style="display: flex; align-items: center; justify-content: center; gap: 20px;">
                <img id="opSystemLogo" class="header-logo" style="display:none; max-height: 55px; object-fit: contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));" />
                <h2 id="orgTitle" style="margin: 0; text-align: center; font-size: clamp(18px, 3vw, 24px); white-space: pre-wrap; line-height: 1.4;">پنل اپراتور</h2>
                <img id="opHeaderLogo" class="header-logo" style="display:none; max-height: 55px; object-fit: contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));" />
            </div>
            
            <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center;">
                <div class="snapshot-btn-group" style="display: flex; align-items: center; background: var(--input-bg); border-radius: 10px; border: 1px solid var(--glass-border);" title="مستندسازی و دانلود اسکرین‌شات">
                    <button onclick="takeSnapshot()" style="background: transparent; border: none; padding: 8px 12px; cursor: pointer; color: inherit; font-size: 14px; font-family: inherit; display: flex; align-items: center; gap: 5px; border-radius: 0; box-shadow: none;"><i class="ph ph-camera"></i> ثبت تصویر</button>
                    <div style="width: 1px; background: var(--glass-border); height: 25px;"></div>
                    <label style="display: flex; align-items: center; padding: 8px 10px; cursor: pointer; gap: 5px; font-size: 13px; margin: 0;">
                        <input type="checkbox" id="autoSnapshotToggle" onchange="toggleAutoSnapshot()" style="margin: 0;">
                        خودکار
                    </label>
                </div>
                <button onclick="logout()" class="icon-btn logout-btn">خروج <i class="ph ph-sign-out"></i></button>
                <a id="boardLink" href="#" target="_blank" class="icon-btn" style="text-decoration: none; color: inherit;">اسکوربورد <i class="ph ph-chart-line-up"></i></a>
                <button onclick="openSettings()" id="btnSettings" class="icon-btn">تنظیمات <i class="ph ph-gear"></i></button>
            </div>
        </div>`;

html = html.replace(/<div class="op-title-section"[\s\S]*?<\/div>/, replacement);
fs.writeFileSync('public/operator.html', html);
console.log("Operator buttons restored.");
