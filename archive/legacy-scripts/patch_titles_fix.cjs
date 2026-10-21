const fs = require('fs');

function injectTitle(html, matchRegex, titleText) {
    return html.replace(matchRegex, (match) => {
        if (match.includes('title=')) return match;
        return match.replace(/>$/, ` title="${titleText}">`);
    });
}

let sa = fs.readFileSync('public/superadmin.html', 'utf8');

sa = injectTitle(sa, /<button onclick="superadminLogin\(\)"[^>]*>/g, 'ورود به پنل مدیریت');
sa = injectTitle(sa, /<button onclick="openSetupMode\(null\)"[^>]*>/g, 'ایجاد رویداد جدید به صورت دستی');
sa = injectTitle(sa, /<button onclick="showExcelGuide\(\)"[^>]*>/g, 'بارگذاری اطلاعات رویداد از فایل اکسل');
sa = injectTitle(sa, /<button onclick="openGlobalSettings\(\)"[^>]*>/g, 'تنظیمات کلی سیستم و سوپرادمین');
sa = injectTitle(sa, /<button onclick="saveGlobalSettings\(\);"[^>]*>/g, 'ذخیره تنظیمات کلی سیستم');
sa = injectTitle(sa, /<button onclick="closeGlobalSettings\(\)"[^>]*>/g, 'انصراف و بستن تنظیمات');
sa = injectTitle(sa, /<button onclick="document.getElementById\('excelUpload'\).click\(\)"[^>]*>/g, 'انتخاب فایل اکسل از دستگاه');
sa = injectTitle(sa, /<button onclick="closeExcelGuide\(\)"[^>]*>/g, 'بستن راهنمای فایل اکسل');
sa = injectTitle(sa, /<button onclick="backToDashboard\(\)"[^>]*>/g, 'بازگشت به داشبورد و لیست رویدادها');
sa = injectTitle(sa, /<button class="tab-btn active" id="tabUrlBtn"[^>]*>/g, 'استفاده از آدرس اینترنتی تصویر');
sa = injectTitle(sa, /<button class="tab-btn" id="tabUploadBtn"[^>]*>/g, 'آپلود تصویر از دستگاه');
sa = injectTitle(sa, /<button onclick="addUser\(\)"[^>]*>/g, 'افزودن کاربر جدید');
sa = injectTitle(sa, /<button onclick="addTeam\(\)"[^>]*>/g, 'افزودن تیم جدید');
sa = injectTitle(sa, /<button onclick="addStage\(\)"[^>]*>/g, 'افزودن مرحله جدید');
sa = injectTitle(sa, /<button id="saveCampBtn"[^>]*>/g, 'ذخیره تنظیمات و ایجاد رویداد');
sa = injectTitle(sa, /<button onclick="document.getElementById\('colorPickerModal'\).style.display='none'"[^>]*>/g, 'لغو انتخاب رنگ');

fs.writeFileSync('public/superadmin.html', sa);

let op = fs.readFileSync('public/operator.html', 'utf8');

op = injectTitle(op, /<button onclick="login\(\)"[^>]*>/g, 'ورود به پنل اپراتور');
op = injectTitle(op, /<button onclick="takeSnapshot\(\)"[^>]*>/g, 'ثبت تصویر از وضعیت فعلی جدول');
op = injectTitle(op, /<button onclick="openSettings\(\)"[^>]*>/g, 'تنظیمات رویداد و امتیازها');
op = injectTitle(op, /<button onclick="logout\(\)"[^>]*>/g, 'خروج از حساب کاربری');
op = injectTitle(op, /<button onclick="saveScores\(\)"[^>]*>/g, 'ثبت امتیازهای وارد شده در جدول');
op = injectTitle(op, /<button onclick="saveLogs\(\)"[^>]*>/g, 'ذخیره تغییرات تاریخچه امتیازها');
op = injectTitle(op, /<button class="tab-btn active" id="tabUrlBtn"[^>]*>/g, 'استفاده از آدرس اینترنتی تصویر');
op = injectTitle(op, /<button class="tab-btn" id="tabUploadBtn"[^>]*>/g, 'آپلود تصویر از دستگاه');
op = injectTitle(op, /<button onclick="addEditStage\(\)"[^>]*>/g, 'افزودن مرحله جدید');
op = injectTitle(op, /<button onclick="addEditTeam\(\)"[^>]*>/g, 'افزودن تیم جدید');
op = injectTitle(op, /<button onclick="saveSettings\(\)"[^>]*>/g, 'ذخیره تغییرات تنظیمات');
op = injectTitle(op, /<button onclick="document.getElementById\('colorPickerModal'\).style.display='none'"[^>]*>/g, 'لغو انتخاب رنگ');
// for buttons generated in javascript, we can't match html tags so easily if they are strings, but they are strings!
// wait, applyInstant and undoInstant were already replaced with title in previous attempt? Let's check if they have title.
fs.writeFileSync('public/operator.html', op);
console.log('patched successfully');
