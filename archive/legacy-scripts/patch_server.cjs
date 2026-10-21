const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

code = code.replace(
    /app\.get\('\/api\/settings', async \(req, res\) => \{\s*try \{\s*const adminPassVal = await getSetting\('admin_password'\);\s*res\.json\(\{ admin_password: adminPassVal \}\);\s*\} catch \(error\) \{/g,
    `app.get('/api/settings', async (req, res) => {
    try {
        const adminPassVal = await getSetting('admin_password');
        const systemLogoVal = await getSetting('systemLogo');
        res.json({ admin_password: adminPassVal, systemLogo: systemLogoVal });
    } catch (error) {`
);

fs.writeFileSync('server.js', code);
console.log("Patched server API!");
