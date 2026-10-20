const fs = require('fs');

// 1. Update CSS
let css = fs.readFileSync('public/style.css', 'utf8');
if (!css.includes('.main-action-btn')) {
    css += `
/* Main Action Buttons Responsive */
.main-action-btn {
    padding: 15px 30px;
    border-radius: 15px;
    font-size: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

@media (max-width: 650px) {
    .main-action-btn {
        padding: 15px;
        border-radius: 12px;
    }
    .main-action-btn .btn-text {
        display: none;
    }
    .main-action-btn i, .main-action-btn svg {
        width: 20px;
        height: 20px;
    }
}
`;
    fs.writeFileSync('public/style.css', css);
}

// 2. Update HTML
let html = fs.readFileSync('public/superadmin.html', 'utf8');

const oldButtonsRegex = /<div style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap; margin-bottom: 30px;">([\s\S]*?)<\/div>\s*<div id="campsGrid"/;

const newButtons = `
            <button onclick="openSetupMode(null)" class="main-action-btn" style="background: rgba(0, 255, 136, 0.3); color: var(--success-color); border: 1px solid var(--success-color);" title="ایجاد رویداد جدید به صورت دستی">
                <i data-lucide="plus-circle"></i> <span class="btn-text">مسابقه جدید</span>
            </button>
            <button onclick="showExcelGuide()" class="main-action-btn" style="background: var(--blue-bg); color: var(--blue-color); border: 1px solid var(--blue-border);" title="بارگذاری اطلاعات رویداد از فایل اکسل">
                <i data-lucide="file-spreadsheet"></i> <span class="btn-text">ورود اکسل</span>
            </button>
            <button onclick="toggleAllCampsView()" id="toggleAllCampsBtn" class="main-action-btn" style="background: rgba(255, 255, 255, 0.15); color: var(--text-color); border: 1px solid var(--glass-border);" title="نمایش همه مسابقات (آرشیو شده و فعال)">
                <i data-lucide="layers"></i> <span class="btn-text">مسابقات</span>
            </button>
            <button onclick="openGlobalSettings()" class="main-action-btn" style="background: rgba(255, 255, 255, 0.15); color: var(--text-color); border: 1px solid var(--glass-border);" title="تنظیمات کلی سیستم و سوپرادمین">
                <i data-lucide="settings"></i> <span class="btn-text">تنظیمات</span>
            </button>
            <button onclick="superadminLogout()" class="main-action-btn" style="background: rgba(255, 76, 76, 0.15); color: var(--danger-color); border: 1px solid rgba(255, 76, 76, 0.3);" title="خروج از حساب سوپرادمین">
                <i data-lucide="log-out"></i> <span class="btn-text">خروج</span>
            </button>
`;

html = html.replace(oldButtonsRegex, `<div style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap; margin-bottom: 30px;">${newButtons}        </div>\n        <div id="campsGrid"`);

html = html.replace(
    /btn\.innerHTML = '<i data-lucide="layers"><\/i> فقط فعال‌ها';/g,
    `btn.innerHTML = '<i data-lucide="layers"></i> <span class="btn-text">فقط فعال‌ها</span>';`
);
html = html.replace(
    /btn\.innerHTML = '<i data-lucide="layers"><\/i> مسابقات';/g,
    `btn.innerHTML = '<i data-lucide="layers"></i> <span class="btn-text">مسابقات</span>';`
);

fs.writeFileSync('public/superadmin.html', html);
console.log('Mobile responsive buttons updated');
