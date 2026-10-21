const fs = require('fs');
let html = fs.readFileSync('public/superadmin.html', 'utf8');

const modalReplacement = `
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

            <div style="display: flex; gap: 10px; margin-top: 25px; align-items: center; justify-content: flex-end;">
                <input type="file" id="excelUpload" accept=".xlsx, .xls" style="display: none;" onchange="handleExcelUpload(event); closeExcelGuide();">
                <button onclick="document.getElementById('excelUpload').click()" style="flex: 2; padding: 12px; background: var(--blue-bg); color: var(--blue-color); border: 1px solid var(--blue-border); cursor: pointer; border-radius: 10px;">
                    <i data-lucide="upload" style="width: 18px; height: 18px; vertical-align: middle; margin-left: 5px;"></i> انتخاب فایل اکسل
                </button>
                <button onclick="closeExcelGuide()" style="flex: 1; padding: 12px; background: var(--input-bg); border-radius: 10px; cursor: pointer;">بستن</button>
            </div>
        </div>
    </div>
`;

const functionReplacement = `
        function handleExcelUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, {type: 'array'});
                    
                    if (workbook.SheetNames.length === 0) {
                        alert("فایل اکسل خالی است.");
                        return;
                    }
                    
                    const firstSheetName = workbook.SheetNames[0];
                    const mainSheet = workbook.Sheets[firstSheetName];
                    const rows = XLSX.utils.sheet_to_json(mainSheet, {header: 1});
                    
                    if (rows.length < 2) {
                        alert("شیت اول فایل اکسل خالی است یا فقط هدر دارد.");
                        return;
                    }

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

                    if (!campTitle) {
                        alert("عنوان مسابقه در شیت اول، ستون دوم، ردیف دوم یافت نشد.");
                        return;
                    }
                    if (teams.length === 0) {
                        alert("هیچ تیمی در شیت اول، ستون پنجم یافت نشد.");
                        return;
                    }

                    let users = [];
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

                    const firstOp = users.find(u => u.role === 'operator' || u.role === 'head_referee');
                    let opPassword = firstOp ? firstOp.password : "admin123";

                    const newCamp = {
                        orgName: orgName,
                        title: campTitle,
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
                            loadDashboard();
                        } else {
                            alert("خطا در ایجاد مسابقه: " + resData.message);
                        }
                    });

                } catch (error) {
                    alert("خطا در پردازش فایل اکسل: " + error);
                }
                event.target.value = "";
            };
            reader.readAsArrayBuffer(file);
        }
`;

// regex replace modal
html = html.replace(/<div id="excelGuideModal"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, modalReplacement.trim());

// regex replace function
html = html.replace(/function handleExcelUpload\(event\) \{[\s\S]*?reader\.readAsArrayBuffer\(file\);\s*\}/, functionReplacement.trim());

fs.writeFileSync('public/superadmin.html', html);
console.log('patched');
