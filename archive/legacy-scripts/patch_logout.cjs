const fs = require('fs');
let html = fs.readFileSync('public/superadmin.html', 'utf8');

// 1. Add the logout button
html = html.replace(
    /<button onclick="openGlobalSettings\(\)"/,
    `<button onclick="superadminLogout()" style="background: rgba(255, 76, 76, 0.15); color: var(--danger-color); border: 1px solid rgba(255, 76, 76, 0.3); padding: 15px 30px; border-radius: 15px; font-size: 16px; display: flex; align-items: center; gap: 8px;" title="خروج از حساب سوپرادمین">
                <i data-lucide="log-out"></i> خروج
            </button>
            <button onclick="openGlobalSettings()"`
);

// 2. Add the logout function
const logoutFunction = `
        function superadminLogout() {
            // Clear password field
            const passInput = document.getElementById('saPassword');
            if(passInput) passInput.value = '';
            
            // Clear error message just in case
            const errMsg = document.getElementById('saErrorMsg');
            if(errMsg) {
                errMsg.style.display = 'none';
                errMsg.innerText = '';
            }

            // Animate transition back to login
            hideModal('dashboardSection');
            setTimeout(() => { showModal('loginSection', 'block'); }, 280);
        }
`;

html = html.replace(
    /\/\/\s*---\s*Superadmin Logic\s*---/,
    '// --- Superadmin Logic ---\n' + logoutFunction
);

fs.writeFileSync('public/superadmin.html', html);
console.log("Logout functionality added");
