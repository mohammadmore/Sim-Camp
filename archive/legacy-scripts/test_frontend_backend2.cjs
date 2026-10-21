const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: "new"
    });
    const page = await browser.newPage();
    try {
        await page.goto('http://localhost:3000/superadmin.html');
        await new Promise(r => setTimeout(r, 2000)); // Wait for initialization

        // Try to login as superadmin
        await page.type('#superadminPass', 'admin123'); // the default pass
        await page.click('button[onclick="superadminLogin()"]');
        
        await new Promise(r => setTimeout(r, 2000));
        
        // Wait for the camp creation section to appear, which means login was successful
        const sectionVisible = await page.evaluate(() => {
            const el = document.getElementById('manageSection');
            return el && el.style.display !== 'none';
        });
        
        console.log("Login successful:", sectionVisible);
        
        // See if the camps table populated
        const campsCount = await page.evaluate(() => {
            return document.querySelectorAll('#campsTableBody tr').length;
        });
        console.log("Camps loaded:", campsCount);
        
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
