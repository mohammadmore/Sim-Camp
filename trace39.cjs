const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    
    await page.goto('http://localhost:3000/superadmin.html');
    await new Promise(r => setTimeout(r, 1000));
    
    await page.evaluate(async () => {
        addTeam('t1', '#111111');
        addTeam('t2', '#111111');
        triggerValidation();
    });
    
    await new Promise(r => setTimeout(r, 1000));
    
    const rects = await page.evaluate(() => {
        const item = document.querySelector('.dynamic-item');
        const r = item.getBoundingClientRect();
        
        const children = Array.from(item.children).map(c => {
            const cr = c.getBoundingClientRect();
            return { tag: c.tagName, class: c.className, left: cr.left, right: cr.right, width: cr.width };
        });
        
        return { item: { left: r.left, right: r.right, width: r.width }, children };
    });
    
    console.log(JSON.stringify(rects, null, 2));
    await browser.close();
})();
