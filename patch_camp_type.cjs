const fs = require('fs');

let sa = fs.readFileSync('public/superadmin.html', 'utf8');

const usersSection = `
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
`;

sa = sa.replace(
    /<label>کاربران رویداد:<\/label>\s*<div id="usersList" class="dynamic-list"><\/div>\s*<button onclick="addUser\(\)" class="icon-btn add-dynamic-btn" style="width: 100%; margin-bottom: 20px; color:var\(--blue-color\);" title="افزودن کاربر جدید">\+ افزودن کاربر جدید<\/button>/,
    usersSection
);

fs.writeFileSync('public/superadmin.html', sa);
console.log('camp type UI added');
