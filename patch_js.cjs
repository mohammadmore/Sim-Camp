const fs = require('fs');

let sa = fs.readFileSync('public/superadmin.html', 'utf8');

const jsCode = `
        function toggleUsersSection() {
            const campType = document.getElementById('campType').value;
            const usersSection = document.getElementById('usersSectionWrapper');
            if (campType === 'professional') {
                usersSection.style.display = 'block';
            } else {
                usersSection.style.display = 'none';
            }
        }
`;

// Insert the toggle function before openSetupMode
sa = sa.replace('        function openSetupMode', jsCode + '\n        function openSetupMode');

// Patch openSetupMode to handle campType
sa = sa.replace(
    /document\.getElementById\('opPassword'\)\.value = c\.password;/,
    "document.getElementById('opPassword').value = c.password;\n                        document.getElementById('campType').value = c.campType || 'simple';\n                        toggleUsersSection();"
);

sa = sa.replace(
    /document\.getElementById\('editCampId'\)\.value = '';/,
    "document.getElementById('editCampId').value = '';\n                document.getElementById('campType').value = 'simple';\n                toggleUsersSection();"
);

// Patch createCamp to include campType
sa = sa.replace(
    /const campTitle = document\.getElementById\('campTitle'\)\.value;/,
    "const campTitle = document.getElementById('campTitle').value;\n            const campType = document.getElementById('campType').value;"
);

sa = sa.replace(
    /orgName, title: campTitle, password, logo, teams, stages, users, isLocked: false/,
    "orgName, title: campTitle, campType, password, logo, teams, stages, users, isLocked: false"
);
sa = sa.replace(
    /const payload = { orgName, title: campTitle, password, logo, teams, stages, users };/,
    "const payload = { orgName, title: campTitle, campType, password, logo, teams, stages, users };"
);


fs.writeFileSync('public/superadmin.html', sa);
console.log('JS patched');
