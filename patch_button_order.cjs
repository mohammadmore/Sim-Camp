const fs = require('fs');
let html = fs.readFileSync('public/superadmin.html', 'utf8');

const regex = /<div style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap; margin-bottom: 30px;">([\s\S]*?)<\/div>\s*<div id="campsGrid"/;

const newButtons = `
            <button onclick="openSetupMode(null)" style="background: rgba(0, 255, 136, 0.3); color: var(--success-color); padding: 15px 30px; border: 1px solid var(--success-color); border-radius: 15px; font-size: 16px; display: flex; align-items: center; gap: 8px;" title="ایجاد رویداد جدید به صورت دستی">
                <i data-lucide="plus-circle"></i> مسابقه جدید
            </button>
            <button onclick="showExcelGuide()" style="background: var(--blue-bg); color: var(--blue-color); border: 1px solid var(--blue-border); padding: 15px 30px; border-radius: 15px; font-size: 16px; display: flex; align-items: center; gap: 8px;" title="بارگذاری اطلاعات رویداد از فایل اکسل">
                <i data-lucide="file-spreadsheet"></i> ورود اکسل
            </button>
            <button onclick="toggleAllCampsView()" id="toggleAllCampsBtn" style="background: rgba(255, 255, 255, 0.15); color: var(--text-color); border: 1px solid var(--glass-border); padding: 15px 30px; border-radius: 15px; font-size: 16px; display: flex; align-items: center; gap: 8px;" title="نمایش همه مسابقات (آرشیو شده و فعال)">
                <i data-lucide="layers"></i> مسابقات
            </button>
            <button onclick="openGlobalSettings()" style="background: rgba(255, 255, 255, 0.15); color: var(--text-color); border: 1px solid var(--glass-border); padding: 15px 30px; border-radius: 15px; font-size: 16px; display: flex; align-items: center; gap: 8px;" title="تنظیمات کلی سیستم و سوپرادمین">
                <i data-lucide="settings"></i> تنظیمات
            </button>
            <button onclick="superadminLogout()" style="background: rgba(255, 76, 76, 0.15); color: var(--danger-color); border: 1px solid rgba(255, 76, 76, 0.3); padding: 15px 30px; border-radius: 15px; font-size: 16px; display: flex; align-items: center; gap: 8px;" title="خروج از حساب سوپرادمین">
                <i data-lucide="log-out"></i> خروج
            </button>
`;

html = html.replace(regex, `<div style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap; margin-bottom: 30px;">${newButtons}        </div>\n        <div id="campsGrid"`);

fs.writeFileSync('public/superadmin.html', html);
console.log('Button order patched');
