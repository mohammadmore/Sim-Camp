const fs = require('fs');

let css = fs.readFileSync('public/style.css', 'utf8');
if(!css.includes('@keyframes modalFadeIn')) {
css += `
/* Modal Animations */
@keyframes modalFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}
@keyframes modalFadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
}
@keyframes modalPopIn {
    from { opacity: 0; transform: scale(0.9) translateY(20px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes modalPopOut {
    from { opacity: 1; transform: scale(1) translateY(0); }
    to { opacity: 0; transform: scale(0.9) translateY(20px); }
}

.modal-overlay {
    animation: modalFadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
.modal-overlay.closing {
    animation: modalFadeOut 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
.modal-overlay .glass {
    animation: modalPopIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}
.modal-overlay.closing .glass {
    animation: modalPopOut 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

#setupSection {
    animation: modalPopIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}
#setupSection.closing {
    animation: modalPopOut 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

#dashboardSection {
    animation: modalFadeIn 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
#dashboardSection.closing {
    animation: modalFadeOut 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
`;
fs.writeFileSync('public/style.css', css);
}

let html = fs.readFileSync('public/superadmin.html', 'utf8');

// Insert the helper functions right after // --- Superadmin Logic ---
const helperFunctions = `
        function showModal(id, displayType = 'flex') {
            const el = document.getElementById(id);
            if(el) {
                el.style.display = displayType;
                el.classList.remove('closing');
            }
        }
        function hideModal(id) {
            const el = document.getElementById(id);
            if(el) {
                el.classList.add('closing');
                setTimeout(() => {
                    el.style.display = 'none';
                    el.classList.remove('closing');
                }, 280);
            }
        }
`;
html = html.replace(/\/\/\s*---\s*Superadmin Logic\s*---/, '// --- Superadmin Logic ---\n' + helperFunctions);

// Patch global settings
html = html.replace(
    /document\.getElementById\('globalSettingsModal'\)\.style\.display = 'flex';/g,
    `showModal('globalSettingsModal', 'flex');`
);
html = html.replace(
    /document\.getElementById\('globalSettingsModal'\)\.style\.display = 'none';/g,
    `hideModal('globalSettingsModal');`
);

// Patch excel guide
html = html.replace(
    /document\.getElementById\("excelGuideModal"\)\.style\.display = "flex";/g,
    `showModal('excelGuideModal', 'flex');`
);
html = html.replace(
    /document\.getElementById\("excelGuideModal"\)\.style\.display = "none";/g,
    `hideModal('excelGuideModal');`
);

// Patch setupMode and backToDashboard
html = html.replace(
    /document\.getElementById\('dashboardSection'\)\.style\.display = 'none';\n\s*document\.getElementById\('setupSection'\)\.style\.display = 'block';/,
    `hideModal('dashboardSection');\n            setTimeout(() => { showModal('setupSection', 'block'); }, 280);`
);

html = html.replace(
    /document\.getElementById\('setupSection'\)\.style\.display = 'none';\n\s*document\.getElementById\('dashboardSection'\)\.style\.display = 'block';/,
    `hideModal('setupSection');\n            setTimeout(() => { showModal('dashboardSection', 'block'); }, 280);`
);


fs.writeFileSync('public/superadmin.html', html);
console.log('Patched modal animations!');
