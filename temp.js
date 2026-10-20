<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <link rel="icon" href="favicon.png" type="image/png">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <link rel="stylesheet" href="style.css">
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        function toggleTheme() {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            updateThemeIcon();
        }
        function updateThemeIcon() {
            const current = document.documentElement.getAttribute('data-theme');
            const icon = document.querySelector('.theme-toggle i, .theme-toggle svg');
            if (icon) {
                icon.outerHTML = current === 'dark' ? '<i data-lucide="sun"></i>' : '<i data-lucide="moon"></i>'; if(typeof refreshIcons === 'function') refreshIcons();
            }
        }
        document.addEventListener('DOMContentLoaded', () => { updateThemeIcon(); fetch('/api/settings').then(r=>r.json()).then(d=>{if(d.systemLogo)applySystemLogo(d.systemLogo)}); });

        const COLORS = [
            '#000000', '#ffffff', '#808080', '#c0c0c0', '#a9a9a9', // Black, White, Grays
            '#ff0000', '#800000', '#ff5733', '#ffa500', '#ff8c00', // Reds & Oranges
            '#ffff00', '#ffd700', '#bdb76b', '#f0e68c', '#eee8aa', // Yellows
            '#008000', '#00ff00', '#32cd32', '#228b22', '#006400', // Greens
            '#0000ff', '#000080', '#00bfff', '#1e90ff', '#4169e1', // Blues
            '#800080', '#ff00ff', '#8b008b', '#9400d3', '#9932cc', // Purples
            '#ffc0cb', '#ff69b4', '#ff1493', '#c71585', '#db7093', // Pinks
            '#8b4513', '#a0522d', '#d2691e', '#cd853f', '#f4a460', // Browns
            '#00ffff', '#20b2aa', '#008080', '#40e0d0', '#48d1cc', // Cyans/Teals
            '#e6e6fa', '#fff0f5', '#f5fffa', '#f0f8ff', '#f5f5dc'  // Off-whites/Pastels
        ];
    
        function moveItemUp(btn) {
            const item = btn.parentElement;
            if (item.previousElementSibling) {
                item.parentElement.insertBefore(item, item.previousElementSibling);
            }
        }
        function moveItemDown(btn) {
            const item = btn.parentElement;
            if (item.nextElementSibling) {
                item.parentElement.insertBefore(item.nextElementSibling, item);
            }
        }
        
</head>
<body>
    <button onclick="toggleTheme()" class="theme-toggle" title="تغییر پوسته"><i data-lucide="moon"></i></button>

    <img id="mainSystemLogo" src="" alt="Simulation Camp Logo" style="display: none; width: calc(60% + 60px); max-width: 460px; aspect-ratio: 12/5; object-fit: contain; margin-bottom: 20px; background: transparent; border: none; box-shadow: none;">
    <!-- Superadmin Login -->
    <div id="loginSection" class="glass" style="padding: 30px; width: 60%; max-width: 400px; text-align: center;">
        <h2>ورود سوپرادمین</h2>
        <input type="password" id="saPassword" placeholder="رمز عبور" class="settings-input" onkeydown="if(event.key === 'Enter') superadminLogin()">
        <button onclick="superadminLogin()" style="padding: 10px 20px; width: 100%;" title="ورود به پنل مدیریت">ورود</button>
        <p id="saErrorMsg" style="color: var(--error-color); display: none;"></p>
    </div>

    <!-- Superadmin Dashboard -->
    <div id="dashboardSection" style="display: none; width: 90%; max-width: 1000px; text-align: center;">
        <h2 style="margin-top: 0; margin-bottom: 25px; font-size: 28px;">داشبورد سوپرادمین</h2>
        
        <div style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap; margin-bottom: 30px;">
            <button onclick="openSetupMode(null)" style="background: rgba(0, 255, 136, 0.3); color: var(--success-color); padding: 15px 30px; border: 1px solid var(--success-color); border-radius: 15px; font-size: 16px; display: flex; align-items: center; gap: 8px;" title="ایجاد رویداد جدید به صورت دستی">
                <i data-lucide="plus-circle"></i> مسابقه جدید
            </button>
            <button onclick="showExcelGuide()" style="background: var(--blue-bg); color: var(--blue-color); border: 1px solid var(--blue-border); padding: 15px 30px; border-radius: 15px; font-size: 16px; display: flex; align-items: center; gap: 8px;" title="بارگذاری اطلاعات رویداد از فایل اکسل">
                <i data-lucide="file-spreadsheet"></i> ورود اکسل
            </button>
            <button onclick="openGlobalSettings()" style="background: rgba(255, 255, 255, 0.15); color: var(--text-color); border: 1px solid var(--glass-border); padding: 15px 30px; border-radius: 15px; font-size: 16px; display: flex; align-items: center; gap: 8px;" title="تنظیمات کلی سیستم و سوپرادمین">
                <i data-lucide="settings"></i> تنظیمات
            </button>
        </div>

        <div id="campsGrid" class="dashboard-grid">
            <!-- Cards go here -->
        </div>
    </div>

    
    <!-- Global Settings Modal -->
    <div id="globalSettingsModal" class="modal-overlay">
        <div class="glass" style="padding: 30px; width: 90%; max-width: 500px; text-align: right;">
            <h3 style="margin-top: 0; display: flex; align-items: center; gap: 10px;"><i data-lucide="settings"></i> تنظیمات عمومی سیستم</h3>
            <div style="display: flex; flex-direction: column; gap: 15px; margin-top: 20px;">
                <div>
                    <label style="display: block; margin-bottom: 8px;">لوگوی اصلی سیستم (لینک عکس):</label>
                    <input type="text" id="sysLogoLink" class="settings-input" placeholder="https://example.com/logo.png">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 8px;">یا آپلود فایل لوگو:</label>
                    <input type="file" id="sysLogoFile" accept="image/*" class="settings-input" style="padding: 10px;">
                </div>
            </div>
            <div style="display: flex; gap: 10px; margin-top: 25px;">
                <button onclick="saveGlobalSettings();" style="flex: 2; padding: 12px; background: rgba(0, 255, 136, 0.3); border: 1px solid var(--success-color); color: var(--success-color);" title="ذخیره تنظیمات کلی سیستم">
                    <i data-lucide="save" style="width: 18px; height: 18px; vertical-align: middle; margin-left: 5px;"></i> ذخیره تغییرات
                </button>
                <button onclick="closeGlobalSettings()" style="flex: 1; padding: 12px; background: var(--input-bg);" title="انصراف و بستن تنظیمات">لغو</button>
            </div>
        </div>
    </div>
    
    <!-- Excel Guide Modal -->
    <!-- Excel Guide Modal -->
    <div id="excelGuideModal" class="modal-overlay">
        <div class="glass" style="padding: 30px; width: 90%; max-width: 700px; max-height: 90vh; overflow-y: auto;">
            <h3 style="margin-top: 0; display: flex; align-items: center; gap: 10px;"><i data-lucide="file-spreadsheet"></i> ورود از طریق اکسل</h3>
            <p>لطفا یک فایل اکسل با <b>دو شیت مجزا</b> ایجاد کنید.</p>
            
            <h4 style="margin-top: 20px; color: var(--blue-color);">شیت اول: اطلاعات مسابقه</h4>
            <p style="font-size: 13px; opacity: 0.9;">ردیف اول هدر باشد و از ردیف دوم اطلاعات وارد شود.</p>
            <div style="overflow-x: auto;">
                <table style="width: 100%; text-align: right; border-collapse: collapse; margin-top: 10px; font-size: 12px;">
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.2);">
                        <th style="padding: 10px;">ستون اول</th>
                        <th style="padding: 10px;">ستون دوم</th>
                        <th style="padding: 10px;">ستون سوم</th>
                        <th style="padding: 10px;">ستون چهارم</th>
                        <th style="padding: 10px;">ستون پنجم</th>
                        <th style="padding: 10px;">ستون ششم</th>
                    </tr>
                    <tr>
                        <td style="padding: 10px;">نام سازمان<br><small>(فقط ردیف ۲)</small></td>
                        <td style="padding: 10px;">عنوان مسابقه<br><small>(فقط ردیف ۲)</small></td>
                        <td style="padding: 10px;">لینک لوگو<br><small>(فقط ردیف ۲ - اختیاری)</small></td>
                        <td style="padding: 10px;">نام مراحل<br><small>(ردیف ۲ تا انتها)</small></td>
                        <td style="padding: 10px;">نام تیم‌ها<br><small>(ردیف ۲ تا انتها)</small></td>
                        <td style="padding: 10px;">کد رنگ تیم<br><small>(اختیاری)</small></td>
                    </tr>
                </table>
            </div>

            <h4 style="margin-top: 30px; color: var(--success-color);">شیت دوم: کاربران و داوران (اختیاری)</h4>
            <p style="font-size: 13px; opacity: 0.9;">ردیف اول هدر باشد و از ردیف دوم لیست اکانت‌ها وارد شود.</p>
            <div style="overflow-x: auto;">
                <table style="width: 100%; text-align: right; border-collapse: collapse; margin-top: 10px; font-size: 12px;">
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.2);">
                        <th style="padding: 10px;">ستون اول</th>
                        <th style="padding: 10px;">ستون دوم</th>
                        <th style="padding: 10px;">ستون سوم</th>
                        <th style="padding: 10px;">ستون چهارم</th>
                        <th style="padding: 10px;">ستون پنجم</th>
                    </tr>
                    <tr>
                        <td style="padding: 10px;">نام و نام خانوادگی</td>
                        <td style="padding: 10px;">نام کاربری</td>
                        <td style="padding: 10px;">رمز عبور</td>
                        <td style="padding: 10px;">نقش<br><small>(اپراتور، داور ارشد، داور)</small></td>
                        <td style="padding: 10px;">لینک عکس پروفایل<br><small>(اختیاری)</small></td>
                    </tr>
                </table>
            </div>
            
            <p style="font-size: 13px; opacity: 0.8; margin-top: 15px;">* در صورتی که کد رنگی جز رنگهای پیشفرض نیست یا سلول رنگ یک تیم خالی است، به صورت پیشفرض آن تیم سفید می‌شود.</p>

            <div id="excelErrors" style="display: none; background: rgba(255,50,50,0.1); border: 1px solid var(--danger-color); color: var(--danger-color); padding: 15px; border-radius: 10px; margin-top: 20px; font-size: 13px; text-align: right;"></div>
            <div style="display: flex; gap: 10px; margin-top: 25px; align-items: center; justify-content: flex-end;">
                <input type="file" id="excelUpload" accept=".xlsx, .xls" style="display: none;" onchange="handleExcelUpload(event);">
                <button onclick="document.getElementById('excelUpload').click()" style="flex: 2; padding: 12px; background: var(--blue-bg); color: var(--blue-color); border: 1px solid var(--blue-border); cursor: pointer; border-radius: 10px;" title="انتخاب فایل اکسل از دستگاه">
                    <i data-lucide="upload" style="width: 18px; height: 18px; vertical-align: middle; margin-left: 5px;"></i> انتخاب فایل اکسل
                </button>
                <button onclick="closeExcelGuide()" style="flex: 1; padding: 12px; background: var(--input-bg); border-radius: 10px; cursor: pointer;" title="بستن راهنمای فایل اکسل">بستن</button>
            </div>
        </div>
    </div>

    <!-- Setup / Edit Section -->
    <div id="setupSection" class="glass" style="display: none; padding: 30px; width: 90%; max-width: 600px; margin-bottom: 50px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 id="setupFormTitle">تنظیمات مسابقه</h2>
            <button onclick="backToDashboard()" class="icon-btn" style="font-size: 14px;" title="بازگشت به داشبورد و لیست رویدادها">بازگشت به داشبورد</button>
        </div>
        
        <input type="hidden" id="editCampId">

        <label>نام سازمان برگزارکننده:</label>
        <input type="text" id="orgName" placeholder="مثلا: شرکت ایکس" class="settings-input">
        
        <label>عنوان مسابقه:</label>
        <input type="text" id="campTitle" placeholder="مثلا: جام رمضان ۱۴۰۵" class="settings-input">
        
        <label>لوگوی سازمان:</label>
        <div class="tabs">
            <button class="tab-btn active" id="tabUrlBtn" onclick="setLogoMode('url')" title="استفاده از آدرس اینترنتی تصویر">لینک عکس</button>
            <button class="tab-btn" id="tabUploadBtn" onclick="setLogoMode('upload')" title="آپلود تصویر از دستگاه">آپلود از دستگاه</button>
        </div>
        <input type="text" id="logoUrl" placeholder="https://example.com/logo.png" class="settings-input">
        <input type="file" id="logoFile" accept="image/*" style="display: none; width: 100%; padding: 10px; margin-bottom: 15px; box-sizing: border-box; background: var(--input-bg);" onchange="handleFileUpload(event)">
        <input type="hidden" id="logoBase64">
        <!-- Image Preview -->
        <div style="text-align: center;">
            <img id="logoPreview" style="display:none; max-height: 60px; border-radius: 5px; margin-bottom: 15px;">
        </div>

        <label>رمز عبور اپراتور اصلی (نام کاربری ورود: admin):</label>
        <input type="password" id="opPassword" placeholder="یک رمز برای ورود اپراتور" class="settings-input">
        
        
        <label>نوع مسابقه:</label>
        <select id="campType" class="settings-input" onchange="toggleUsersSection()">
            <option value="simple">مسابقه ساده (فقط یک اپراتور)</option>
            <option value="professional">مسابقه حرفه‌ای (امکان تعریف داور و داور ارشد)</option>
        </select>

        <div id="usersSectionWrapper" style="display: none;">
            <label>کاربران رویداد:</label>
            <div id="usersList" class="dynamic-list"></div>
            <button onclick="addUser()" class="icon-btn add-dynamic-btn" style="width: 100%; margin-bottom: 20px; color:var(--blue-color);" title="افزودن کاربر جدید">+ افزودن کاربر جدید</button>
        </div>

        
        <label>تیم‌ها:</label>
        <div id="teamsList" class="dynamic-list"></div>
        <button onclick="addTeam()" class="icon-btn add-dynamic-btn" style="width: 100%; margin-bottom: 20px; color:var(--success-color);" title="افزودن تیم جدید">+ افزودن تیم جدید</button>
        
        <label>مراحل مسابقه:</label>
        <div id="stagesList" class="dynamic-list"></div>
        <button onclick="addStage()" class="icon-btn add-dynamic-btn" style="width: 100%; margin-bottom: 20px; color:var(--success-color);" title="افزودن مرحله جدید">+ افزودن مرحله جدید</button>

        <button id="saveCampBtn" onclick="createCamp()" style="padding: 15px; width: 100%; font-size: 18px; background: rgba(0, 255, 136, 0.4);" title="ذخیره تنظیمات و ایجاد رویداد">ذخیره و ایجاد لینک</button>
        
        <div id="result" style="margin-top: 20px; color: var(--text-color); font-weight: bold; display: none; text-align: center;">
            لینک اپراتور: <br>
            <a id="operatorLink" title="ورود به پنل اپراتور این رویداد در تب جدید"  href="#" target="_blank" style="color: var(--text-color); text-decoration: underline;"></a>
        </div>
    </div>

    <!-- Color Picker Modal -->
    <div id="colorPickerModal" class="modal-overlay" style="z-index: 2000;">
        <div class="modal-content glass" style="max-width: 450px; padding: 20px;">
            <h3 style="margin-top: 0;">انتخاب رنگ</h3>
            <div id="colorGrid" class="color-grid"></div>
            <button onclick="document.getElementById('colorPickerModal').style.display='none'" style="margin-top: 20px; padding: 10px;" title="لغو انتخاب رنگ">انصراف</button>
        </div>
    </div>

        // --- Color Picker Logic ---
        let colorTarget = null;
        function initColorPicker() {
            const grid = document.getElementById('colorGrid');
            COLORS.forEach(color => {
                const swatch = document.createElement('div');
                swatch.className = 'color-swatch';
                swatch.style.backgroundColor = color;
                swatch.onclick = () => selectColor(color);
                grid.appendChild(swatch);
            });
        }
        initColorPicker();

        function openColorPicker(btn) {
            colorTarget = btn;
            document.getElementById('colorPickerModal').style.display = 'flex';
        }

        function selectColor(color) {
            if (colorTarget) {
                colorTarget.dataset.value = color;
                colorTarget.style.backgroundColor = color;
            }
            document.getElementById('colorPickerModal').style.display = 'none';
        }

        // --- Logo Mode Logic ---
        let logoMode = 'url';
        function setLogoMode(mode) {
            logoMode = mode;
            if (mode === 'url') {
                document.getElementById('tabUrlBtn').classList.add('active');
                document.getElementById('tabUploadBtn').classList.remove('active');
                document.getElementById('logoUrl').style.display = 'block';
                document.getElementById('logoFile').style.display = 'none';
            } else {
                document.getElementById('tabUrlBtn').classList.remove('active');
                document.getElementById('tabUploadBtn').classList.add('active');
                document.getElementById('logoUrl').style.display = 'none';
                document.getElementById('logoFile').style.display = 'block';
            }
            updatePreview();
        }

        function handleFileUpload(e) {
            const file = e.target.files[0];
            if(file) {
                const reader = new FileReader();
                reader.onload = (e) => { 
                    document.getElementById('logoBase64').value = e.target.result; 
                    updatePreview();
                };
                reader.readAsDataURL(file);
            }
        }

        document.getElementById('logoUrl').addEventListener('input', updatePreview);

        function updatePreview() {
            const preview = document.getElementById('logoPreview');
            let src = '';
            if (logoMode === 'url') {
                src = document.getElementById('logoUrl').value;
            } else {
                src = document.getElementById('logoBase64').value;
            }
            if (src) {
                preview.src = src;
                preview.style.display = 'inline-block';
            } else {
                preview.style.display = 'none';
            }
        }

        // --- Superadmin Logic ---
        
        function openGlobalSettings() {
            document.getElementById('globalSettingsModal').style.display = 'flex';
            if(typeof refreshIcons === 'function') refreshIcons();
        }
        function closeGlobalSettings() {
            document.getElementById('globalSettingsModal').style.display = 'none';
        }
        
        function closeExcelGuide() {
            document.getElementById("excelGuideModal").style.display = "none";
            const errDiv = document.getElementById("excelErrors");
            if (errDiv) errDiv.style.display = "none";
            const fileInput = document.getElementById('excelUpload');
            if (fileInput) fileInput.value = '';
        }

        function showExcelGuide() {
            document.getElementById("excelGuideModal").style.display = "flex";
            if(typeof refreshIcons === "function") refreshIcons();

        }

        function handleExcelUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            const errDiv = document.getElementById("excelErrors");
            if (errDiv) errDiv.style.display = "none";

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    let errors = [];
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, {type: 'array'});
                    
                    if (workbook.SheetNames.length === 0) {
                        errors.push("فایل اکسل خالی است و هیچ شیتی ندارد.");
                    } else {
                        const firstSheetName = workbook.SheetNames[0];
                        const mainSheet = workbook.Sheets[firstSheetName];
                        const rows = XLSX.utils.sheet_to_json(mainSheet, {header: 1});
                        
                        if (rows.length < 2) {
                            errors.push("شیت اول فایل اکسل خالی است یا فقط هدر دارد.");
                        } else {
                            let orgName = rows[1][0] ? String(rows[1][0]).trim() : "";
                            let campTitle = rows[1][1] ? String(rows[1][1]).trim() : "";
                            let logoUrl = rows[1][2] ? String(rows[1][2]).trim() : "";
                            
                            let stages = [];
                            let teams = [];
                            for (let i = 1; i < rows.length; i++) {
                                if (!rows[i]) continue;
                                if (rows[i][3]) {
                                    let stageName = String(rows[i][3]).trim();
                                    if (stageName) stages.push({ id: Date.now() + 's' + i, name: stageName });
                                }
                                if (rows[i][4]) {
                                    let teamName = String(rows[i][4]).trim();
                                    let teamColor = '#ffffff';
                                    if (rows[i][5]) {
                                        let inputColor = String(rows[i][5]).trim().toLowerCase();
                                        if (!inputColor.startsWith('#')) {
                                            inputColor = '#' + inputColor;
                                        }
                                        if (COLORS.includes(inputColor)) {
                                            teamColor = inputColor;
                                        }
                                    }
                                    if (teamName) teams.push({ id: Date.now() + 't' + i, name: teamName, color: teamColor, score: 0, stageScores: {} });
                                }
                            }

                            if (!campTitle) errors.push("عنوان مسابقه در شیت اول (ستون دوم، ردیف دوم) یافت نشد.");
                            if (teams.length === 0) errors.push("هیچ تیمی در شیت اول (ستون پنجم) یافت نشد. حداقل یک تیم وارد کنید.");
                            if (stages.length === 0) errors.push("هیچ مرحله‌ای در شیت اول (ستون چهارم) یافت نشد. حداقل یک مرحله وارد کنید.");
                            
                            let users = [];
                            let hasOp = false;
                            if (workbook.SheetNames.length > 1) {
                                const secondSheetName = workbook.SheetNames[1];
                                const usersSheet = workbook.Sheets[secondSheetName];
                                const rows2 = XLSX.utils.sheet_to_json(usersSheet, {header: 1});
                                
                                for (let i = 1; i < rows2.length; i++) {
                                    if (!rows2[i]) continue;
                                    
                                    let fullName = rows2[i][0] ? String(rows2[i][0]).trim() : "";
                                    let username = rows2[i][1] ? String(rows2[i][1]).trim() : "";
                                    let password = rows2[i][2] ? String(rows2[i][2]).trim() : "";
                                    let roleStr = rows2[i][3] ? String(rows2[i][3]).trim() : "";
                                    let profilePic = rows2[i][4] ? String(rows2[i][4]).trim() : "";
                                    
                                    // if username or password is provided but missing the other
                                    if ((username && !password) || (!username && password)) {
                                        errors.push(`در شیت دوم، ردیف ${i + 1}: هم نام کاربری و هم رمز عبور الزامی است.`);
                                        continue;
                                    }
                                    if (!username || !password) continue;
                                    
                                    let firstName = fullName;
                                    let lastName = "";
                                    const spaceIndex = fullName.indexOf(' ');
                                    if (spaceIndex !== -1) {
                                        firstName = fullName.substring(0, spaceIndex);
                                        lastName = fullName.substring(spaceIndex + 1);
                                    }
                                    
                                    let role = 'operator';
                                    if (roleStr.includes('سرداور') || roleStr.includes('ارشد')) role = 'head_referee';
                                    else if (roleStr.includes('داور') && !roleStr.includes('ارشد')) role = 'referee';
                                    
                                    if (role === 'operator' || role === 'head_referee') hasOp = true;

                                    users.push({
                                        id: 'u_' + Math.random().toString(36).substr(2, 9),
                                        firstName,
                                        lastName,
                                        username,
                                        password,
                                        role,
                                        profilePic
                                    });
                                }
                            }
                            
                            if (errors.length > 0) {
                                // show errors
                                if (errDiv) {
                                    errDiv.innerHTML = "<b>ایرادات یافت شده در فایل اکسل:</b><ul style='margin-top: 10px; margin-bottom: 0; padding-right: 20px;'>" + errors.map(e => "<li>" + e + "</li>").join('') + "</ul>";
                                    errDiv.style.display = "block";
                                }
                                return;
                            }

                            const firstOp = users.find(u => u.role === 'operator' || u.role === 'head_referee');
                            let opPassword = firstOp ? firstOp.password : "admin123";

                            const newCamp = {
                                orgName: orgName,
                                title: campTitle,
                campType: 'simple',
                                password: opPassword,
                                logo: logoUrl,
                                numLang: "fa",
                                dir: "rtl",
                                locked: false,
                                stages: stages,
                                teams: teams,
                                users: users
                            };

                            fetch('/setup', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(newCamp)
                            })
                            .then(res => res.json())
                            .then(resData => {
                                if (resData.success) {
                                    alert("مسابقه با موفقیت از اکسل ایجاد شد!");
                                    closeExcelGuide();
                                    loadCamps();
                                } else {
                                    alert("خطا در ایجاد مسابقه: " + resData.message);
                                }
                            });
                        }
                    }
                } catch (error) {
                    if (errDiv) {
                        errDiv.innerHTML = "<b>خطا در پردازش فایل:</b> " + error;
                        errDiv.style.display = "block";
                    } else {
                        alert("خطا در پردازش فایل اکسل: " + error);
                    }
                }
                event.target.value = "";
            };
            reader.readAsArrayBuffer(file);
        }
        function superadminLogin() {
            const pass = document.getElementById('saPassword').value;
            fetch('/superadmin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pass })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    document.getElementById('loginSection').style.display = 'none';
                    document.getElementById('dashboardSection').style.display = 'block';
                    loadCamps();
                } else {
                    document.getElementById('saErrorMsg').innerText = data.message;
                    document.getElementById('saErrorMsg').style.display = 'block';
                }
            });
        }

        
        function loadGlobalSettings() {
            fetch('/api/settings')
            .then(res => res.json())
            .then(data => {
                if (data.systemLogo) {
                    document.getElementById('sysLogoLink').value = data.systemLogo;
                    applySystemLogo(data.systemLogo);
                }
            });
        }
        
        function applySystemLogo(url) {
            const el = document.getElementById('mainSystemLogo');
            if (el && url) {
                el.src = url;
                el.style.display = 'block';
            } else if (el) {
                el.style.display = 'none';
            }
        }

        async function saveGlobalSettings() {
            let logoUrl = document.getElementById('sysLogoLink').value;
            const fileInput = document.getElementById('sysLogoFile');
            
            if (fileInput.files && fileInput.files[0]) {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    logoUrl = e.target.result;
                    document.getElementById('sysLogoLink').value = '';
                    await saveSetting('systemLogo', logoUrl);
                };
                reader.readAsDataURL(fileInput.files[0]);
            } else {
                await saveSetting('systemLogo', logoUrl);
            }
        }
        
        async function saveSetting(key, value) {
            await fetch('/api/settings', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ key, value })
            });
            alert('تنظیمات ذخیره شد');
            applySystemLogo(value);
        }
    
        function loadCamps() {
            fetch('/superadmin/camps')
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    renderCampsGrid(data.camps);
                }
            });
        }

        function renderCampsGrid(camps) {
            const grid = document.getElementById('campsGrid');
            grid.innerHTML = '';
            
            if (camps.length === 0) {
                grid.innerHTML = '<p>هیچ مسابقه‌ای وجود ندارد. یک مسابقه جدید ایجاد کنید.</p>';
                return;
            }

            camps.forEach(camp => {
                const card = document.createElement('div');
                card.className = 'camp-card';
                const isLocked = camp.locked === 1;
                const statusBadge = isLocked 
                    ? '<span class="camp-badge badge-locked"><i data-lucide="lock"></i> قفل شده</span>'
                    : '<span class="camp-badge badge-active"><i data-lucide="check-circle" style="width: 14px; height: 14px; margin-left: 5px;"></i> فعال</span>';

                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div>
                            <h3 style="margin: 0 0 5px 0;">${camp.title || 'بدون عنوان'}</h3>
                            <div style="font-size: 14px; opacity: 0.7;">سازمان: ${camp.orgName || '-'}</div>
                        </div>
                        ${statusBadge}
                    </div>
                    <div style="display: flex; gap: 10px; margin-top: 10px;">
                        <button onclick="openSetupMode('${camp.id}')" title="ویرایش تنظیمات این رویداد"  style="flex: 1; padding: 8px;">ویرایش <i data-lucide="edit-2" style="width: 14px; height: 14px; margin-right: 5px;"></i></button>
                        <button onclick="toggleLock('${camp.id}', ${!isLocked})" title="قفل یا باز کردن امکان ثبت امتیاز"  style="flex: 1; padding: 8px; background: rgba(255, 76, 76, 0.2);">
                            ${isLocked ? 'باز کردن' : 'قفل کردن <i data-lucide="lock"></i>'}
                        </button>
                    </div>
                    <a href="operator.html?id=${camp.id}" title="مشاهده پنل اپراتور این رویداد در تب جدید"  target="_blank" class="icon-btn" style="text-align: center; color: #4facfe; text-decoration: none; font-size: 14px; margin-top: 15px; width: 100%; box-sizing: border-box;">مشاهده پنل اپراتور ↗️</a>
                `;
                grid.appendChild(card);
            });
            if(typeof refreshIcons === 'function') refreshIcons();
        }

        function toggleLock(id, lockStatus) {
            fetch(`/superadmin/camps/${id}/lock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locked: lockStatus })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) loadCamps();
            });
        }

        function backToDashboard() {
            document.getElementById('setupSection').style.display = 'none';
            document.getElementById('dashboardSection').style.display = 'block';
            loadCamps();
        }


        function toggleUsersSection() {
            const campType = document.getElementById('campType').value;
            const usersSection = document.getElementById('usersSectionWrapper');
            if (campType === 'professional') {
                usersSection.style.display = 'block';
            } else {
                usersSection.style.display = 'none';
            }
        }

        function openSetupMode(campId) {
            document.getElementById('dashboardSection').style.display = 'none';
            document.getElementById('setupSection').style.display = 'block';
            document.getElementById('result').style.display = 'none';
            
            const listTeams = document.getElementById('teamsList');
            const listStages = document.getElementById('stagesList');
            const listUsers = document.getElementById('usersList');
            listTeams.innerHTML = '';
            listStages.innerHTML = '';
            listUsers.innerHTML = '';
            
            if (campId) {
                document.getElementById('setupFormTitle').innerText = 'ویرایش مسابقه';
                document.getElementById('saveCampBtn').innerText = 'ذخیره تغییرات';
                
                fetch(`/superadmin/camps/${campId}`)
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        const c = data.camp;
                        document.getElementById('editCampId').value = c.id;
                        document.getElementById('orgName').value = c.orgName;
                        document.getElementById('campTitle').value = c.title || '';
                        document.getElementById('opPassword').value = c.password;
                        document.getElementById('campType').value = c.campType || 'simple';
                        toggleUsersSection();
                        
                        // Handle Logo
                        if (c.logo && c.logo.startsWith('data:image')) {
                            setLogoMode('upload');
                            document.getElementById('logoBase64').value = c.logo;
                        } else {
                            setLogoMode('url');
                            document.getElementById('logoUrl').value = c.logo || '';
                        }
                        updatePreview();

                        c.teams.forEach(t => addTeam(t.name, t.color, t.id, t.score, t.stageScores));
                        c.stages.forEach(s => addStage(s.name, s.id));
                        if(c.users) c.users.forEach(u => addUser(u.firstName, u.lastName, u.username, u.password, u.role, u.profilePic, u.id));
                    }
                });
            } else {
                document.getElementById('setupFormTitle').innerText = 'مسابقه جدید';
                document.getElementById('saveCampBtn').innerText = 'ایجاد لینک اختصاصی';
                document.getElementById('editCampId').value = '';
                document.getElementById('campType').value = 'simple';
                toggleUsersSection();
                document.getElementById('orgName').value = '';
                document.getElementById('campTitle').value = '';
                document.getElementById('opPassword').value = '';
                document.getElementById('logoUrl').value = '';
                document.getElementById('logoBase64').value = '';
                setLogoMode('url');
                updatePreview();
                addTeam(); addStage(); addUser();
            }
        }

        function addTeam(name = '', color = COLORS[Math.floor(Math.random() * COLORS.length)], id = '', score = 0, stageScores = {}) {
            if(!id) id = 't_' + Math.random().toString(36).substr(2, 9);
            const list = document.getElementById('teamsList');
            const item = document.createElement('div');
            item.className = 'dynamic-item';
            item.dataset.id = id;
            item.dataset.score = score;
            item.dataset.stagescores = JSON.stringify(stageScores);
            item.innerHTML = `
                <input type="text" placeholder="نام تیم" value="${name}">
                <div class="color-btn" style="background-color: ${color};" data-value="${color}" onclick="openColorPicker(this)"></div>
                <button onclick="moveItemUp(this)" class="icon-btn" title="انتقال به بالا">▲</button><button onclick="moveItemDown(this)" class="icon-btn" title="انتقال به پایین">▼</button>
                <button onclick="this.parentElement.remove()" class="icon-btn remove-btn" title="حذف">×</button>
            `;
            list.appendChild(item);
        }

        function addStage(name = '', id = '') {
            if(!id) id = 's_' + Math.random().toString(36).substr(2, 9);
            const list = document.getElementById('stagesList');
            const item = document.createElement('div');
            item.className = 'dynamic-item';
            item.dataset.id = id;
            item.innerHTML = `
                <input type="text" placeholder="نام مرحله" value="${name}">
                <button onclick="moveItemUp(this)" class="icon-btn" title="انتقال به بالا">▲</button><button onclick="moveItemDown(this)" class="icon-btn" title="انتقال به پایین">▼</button>
                <button onclick="this.parentElement.remove()" class="icon-btn remove-btn" title="حذف">×</button>
            `;
            list.appendChild(item);
        }

        function addUser(firstName = '', lastName = '', username = '', password = '', role = 'operator', profilePic = '', id = '') {
            if(!id) id = 'u_' + Math.random().toString(36).substr(2, 9);
            const list = document.getElementById('usersList');
            const item = document.createElement('div');
            item.className = 'dynamic-item user-item';
            item.dataset.id = id;
            item.style.alignItems = 'flex-start';
            item.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; padding: 5px;">
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <input type="text" class="u-first" placeholder="نام" value="${firstName}" style="flex:1; min-width: 80px;">
                        <input type="text" class="u-last" placeholder="نام خانوادگی" value="${lastName}" style="flex:1; min-width: 80px;">
                        <select class="u-role settings-input" style="flex:1; min-width: 100px; margin-bottom: 0;">
                            <option value="operator" ${role === 'operator' ? 'selected' : ''}>اپراتور</option>
                            <option value="head_referee" ${role === 'head_referee' ? 'selected' : ''}>سرداور</option>
                            <option value="referee" ${role === 'referee' ? 'selected' : ''}>داور</option>
                        </select>
                    </div>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <input type="text" class="u-user" placeholder="نام کاربری" value="${username}" style="flex:1; min-width: 80px;">
                        <input type="password" class="u-pass" placeholder="رمز عبور" value="${password}" style="flex:1; min-width: 80px;">
                        <input type="text" class="u-pic" placeholder="لینک عکس پروفایل" value="${profilePic}" style="flex:1; min-width: 100px;">
                    </div>
                </div>
                <button onclick="this.parentElement.remove()" class="icon-btn remove-btn" title="حذف" style="height: auto; align-self: stretch;">×</button>
            `;
            list.appendChild(item);
        }

        function validateData(teams) {
            const names = new Set();
            const colors = new Set();
            for (let t of teams) {
                if (names.has(t.name)) return `نام تیم تکراری است: ${t.name}`;
                if (colors.has(t.color)) return `رنگ تکراری انتخاب شده برای تیم: ${t.name}`;
                names.add(t.name);
                colors.add(t.color);
            }
            return null;
        }

        function createCamp() {
            const campId = document.getElementById('editCampId').value;
            const orgName = document.getElementById('orgName').value;
            const campTitle = document.getElementById('campTitle').value;
            const campType = document.getElementById('campType').value;
            const password = document.getElementById('opPassword').value;
            const logo = logoMode === 'url' ? document.getElementById('logoUrl').value : document.getElementById('logoBase64').value;
            
            if(!orgName || !password) return alert("نام سازمان و رمز عبور الزامی است.");
            if(!campTitle) return alert("عنوان مسابقه الزامی است.");

            const teamElements = document.querySelectorAll('#teamsList .dynamic-item');
            const teams = Array.from(teamElements).map(el => {
                const inputs = el.querySelectorAll('input');
                const colorBtn = el.querySelector('.color-btn');
                return { 
                    id: el.dataset.id, 
                    name: inputs[0].value.trim(), 
                    color: colorBtn.dataset.value, 
                    score: parseInt(el.dataset.score) || 0,
                    stageScores: JSON.parse(el.dataset.stagescores || '{}')
                };
            }).filter(t => t.name !== '');

            const stageElements = document.querySelectorAll('#stagesList .dynamic-item');
            const stages = Array.from(stageElements).map(el => {
                const input = el.querySelector('input');
                return { id: el.dataset.id, name: input.value.trim() };
            }).filter(s => s.name !== '');

            const userElements = document.querySelectorAll('#usersList .dynamic-item');
            const users = Array.from(userElements).map(el => {
                return {
                    id: el.dataset.id,
                    firstName: el.querySelector('.u-first').value.trim(),
                    lastName: el.querySelector('.u-last').value.trim(),
                    username: el.querySelector('.u-user').value.trim(),
                    password: el.querySelector('.u-pass').value.trim(),
                    role: el.querySelector('.u-role').value,
                    profilePic: el.querySelector('.u-pic').value.trim()
                };
            }).filter(u => u.username !== '' && u.password !== '');

            if(teams.length < 2) return alert("حداقل ۲ تیم وارد کنید.");
            if(stages.length < 1) return alert("حداقل ۱ مرحله وارد کنید.");

            const validationError = validateData(teams);
            if (validationError) return alert(validationError);

            const campData = { 
                campId: campId || null,
                orgName: orgName, 
                title: campTitle,
                campType: campType,
                logo: logo,
                password: password, 
                teams: teams, 
                stages: stages,
                users: users
            };

            fetch('/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(campData)
            })
            .then(res => res.json())
            .then(data => {
                if(data.success) {
                    const link = `operator.html?id=${data.campId}`;
                    document.getElementById('result').style.display = 'block';
                    document.getElementById('operatorLink').href = link;
                    document.getElementById('operatorLink').innerText = window.location.origin + '/' + link;
                    
                    if (campId) {
                        alert("تغییرات با موفقیت ذخیره شد!");
                        backToDashboard();
                    }
                }
            });
        }

    <div class="asva-spacer" style="flex-grow: 1; min-height: 80px;"></div>
    <div class="asva-footer" ><span class="en-credit">Powered by Asva Studio</span><span class="credit-divider"> | </span><span class="fa-credit">توسعه یافته توسط شرکت داده‌پردازان اسوا</span></div>

    
        function refreshIcons() {
            if (window.lucide) {
                lucide.createIcons();
            }
        }
        document.addEventListener("DOMContentLoaded", refreshIcons);
    
</body>
</html>
