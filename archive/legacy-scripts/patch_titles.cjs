const fs = require('fs');

function addTitle(html, searchStr, titleText) {
    if (html.includes(searchStr)) {
        if (!html.includes(searchStr.replace('>', ` title="${titleText}">`))) {
            return html.replace(searchStr, searchStr.replace('>', ` title="${titleText}">`));
        }
    } else {
        // Handle regex or slightly different formats
        let modified = searchStr.replace('<button', '');
        let reg = new RegExp('<button[^>]*?' + modified.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&') + '[^>]*?>');
        let match = html.match(reg);
        if (match && !match[0].includes('title=')) {
            return html.replace(match[0], match[0].replace('>', ` title="${titleText}">`));
        }
    }
    return html;
}

let sa = fs.readFileSync('public/superadmin.html', 'utf8');
sa = addTitle(sa, '<button onclick="superadminLogin()"', 'ورود به پنل مدیریت');
sa = addTitle(sa, '<button onclick="openSetupMode(null)"', 'ایجاد رویداد جدید به صورت دستی');
sa = addTitle(sa, '<button onclick="showExcelGuide()"', 'بارگذاری اطلاعات رویداد از فایل اکسل');
sa = addTitle(sa, '<button onclick="openGlobalSettings()"', 'تنظیمات کلی سیستم و سوپرادمین');
sa = addTitle(sa, '<button onclick="saveGlobalSettings();"', 'ذخیره تنظیمات کلی سیستم');
sa = addTitle(sa, '<button onclick="closeGlobalSettings()"', 'انصراف و بستن تنظیمات');
sa = addTitle(sa, `<button onclick="document.getElementById('excelUpload').click()"`, 'انتخاب فایل اکسل از دستگاه');
sa = addTitle(sa, '<button onclick="closeExcelGuide()"', 'بستن راهنمای فایل اکسل');
sa = addTitle(sa, '<button onclick="backToDashboard()"', 'بازگشت به داشبورد و لیست رویدادها');
sa = addTitle(sa, '<button class="tab-btn active" id="tabUrlBtn"', 'استفاده از آدرس اینترنتی تصویر');
sa = addTitle(sa, '<button class="tab-btn" id="tabUploadBtn"', 'آپلود تصویر از دستگاه');
sa = addTitle(sa, '<button onclick="addUser()"', 'افزودن کاربر جدید');
sa = addTitle(sa, '<button onclick="addTeam()"', 'افزودن تیم جدید');
sa = addTitle(sa, '<button onclick="addStage()"', 'افزودن مرحله جدید');
sa = addTitle(sa, '<button id="saveCampBtn"', 'ذخیره تنظیمات و ایجاد رویداد');
sa = addTitle(sa, `<button onclick="document.getElementById('colorPickerModal').style.display='none'"`, 'لغو انتخاب رنگ');
sa = sa.replace(/<button onclick="openSetupMode\('\$\{camp\.id\}'\)"(.*?)>/g, '<button onclick="openSetupMode(\'${camp.id}\')" title="ویرایش تنظیمات این رویداد" $1>');
sa = sa.replace(/<button onclick="toggleLock\('\$\{camp\.id\}', \$\{!(.*?)\}\)"(.*?)>/g, '<button onclick="toggleLock(\'${camp.id}\', ${!$1})" title="قفل یا باز کردن امکان ثبت امتیاز" $2>');
sa = sa.replace(/<button onclick="this\.parentElement\.remove\(\)" class="icon-btn remove-btn"/g, '<button onclick="this.parentElement.remove()" class="icon-btn remove-btn" title="حذف"');
fs.writeFileSync('public/superadmin.html', sa);


let op = fs.readFileSync('public/operator.html', 'utf8');
op = addTitle(op, '<button onclick="login()"', 'ورود به پنل اپراتور');
op = addTitle(op, '<button onclick="takeSnapshot()"', 'ثبت تصویر از وضعیت فعلی جدول');
op = addTitle(op, '<button onclick="openSettings()"', 'تنظیمات رویداد و امتیازها');
op = addTitle(op, '<button onclick="logout()"', 'خروج از حساب کاربری');
op = addTitle(op, '<button onclick="saveScores()"', 'ثبت امتیازهای وارد شده در جدول');
op = addTitle(op, '<button onclick="saveLogs()"', 'ذخیره تغییرات تاریخچه امتیازها');
op = addTitle(op, '<button class="tab-btn active" id="tabUrlBtn"', 'استفاده از آدرس اینترنتی تصویر');
op = addTitle(op, '<button class="tab-btn" id="tabUploadBtn"', 'آپلود تصویر از دستگاه');
op = addTitle(op, '<button onclick="addEditStage()"', 'افزودن مرحله جدید');
op = addTitle(op, '<button onclick="addEditTeam()"', 'افزودن تیم جدید');
op = addTitle(op, '<button onclick="saveSettings()"', 'ذخیره تغییرات تنظیمات');
op = addTitle(op, `<button onclick="document.getElementById('colorPickerModal').style.display='none'"`, 'لغو انتخاب رنگ');
op = op.replace(/<button class="instant-btn" id="tgl-\$\{team\.id\}"/g, '<button class="instant-btn" id="tgl-${team.id}" title="تغییر بین امتیاز مثبت و منفی"');
op = op.replace(/<button class="instant-btn" onclick="applyInstant\('\$\{team\.id\}', '\$\{team\.name\}'\)"/g, '<button class="instant-btn" onclick="applyInstant(\'${team.id}\', \'${team.name}\')" title="ثبت امتیاز لحظه‌ای برای این تیم"');
op = op.replace(/<button onclick="undoInstant\('\$\{team\.id\}', ''\)"/g, '<button onclick="undoInstant(\'${team.id}\', \'\')" title="لغو آخرین تغییر امتیاز لحظه‌ای"');
op = op.replace(/<button onclick="this\.parentElement\.remove\(\)" class="icon-btn remove-btn"/g, '<button onclick="this.parentElement.remove()" class="icon-btn remove-btn" title="حذف"');

// Fix boardLink anchor
op = op.replace(/<a id="boardLink" href="#" target="_blank" class="icon-btn"/g, '<a id="boardLink" href="#" target="_blank" class="icon-btn" title="نمایش اسکوربورد در صفحه جدید"');

// Fix stage buttons in js
op = op.replace(/const btn = document\.createElement\('button'\);[\s\S]*?btn\.className = 'icon-btn';/g, "const btn = document.createElement('button');\n                btn.title = 'ثبت گروهی امتیاز برای مرحله ' + stage.name;\n                btn.className = 'icon-btn';");

fs.writeFileSync('public/operator.html', op);
console.log('patched');
