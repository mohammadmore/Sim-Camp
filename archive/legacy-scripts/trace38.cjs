const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });
    
    await page.goto('http://localhost:3000/superadmin.html');
    await new Promise(r => setTimeout(r, 1000));
    
    await page.evaluate(async () => {
        addTeam('t1', '#111111');
        addTeam('t1', '#222222');
        addTeam('t2', '#ff0000');
        addTeam('t3', '#ff0000');
        triggerValidation();
    });
    
    await new Promise(r => setTimeout(r, 1000));
    const svgHTML = await page.evaluate(() => {
        const svg = document.querySelector('#conflict-lines-container svg');
        return svg ? svg.outerHTML : null;
    });
    console.log(svgHTML);
    
    const itemRect = await page.evaluate(() => {
        const items = document.querySelectorAll('.dynamic-item');
        if (items.length > 0) {
            const rect = items[0].getBoundingClientRect();
            return {left: rect.left, right: rect.right, width: rect.width};
        }
        return null;
    });
    console.log("Item rect:", itemRect);
    
    const removeBtnRect = await page.evaluate(() => {
        const items = document.querySelectorAll('.dynamic-item');
        if (items.length > 0) {
            const btn = items[0].querySelector('.remove-btn');
            if (btn) {
                const rect = btn.getBoundingClientRect();
                return {left: rect.left, right: rect.right, width: rect.width};
            }
        }
        return null;
    });
    console.log("Remove btn rect:", removeBtnRect);
    
    await page.screenshot({ path: 'lines3.png' });
    
    await browser.close();
})();
