const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: "new"
    });
    const page = await browser.newPage();
    try {
        await page.goto('http://localhost:3000/superadmin.html');
        // Let's just do a quick health check to make sure the app loads
        const title = await page.title();
        console.log("Superadmin Title:", title);
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
