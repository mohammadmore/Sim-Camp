const fs = require('fs');

const iconMap = {
    'ph-fill ph-medal': 'medal',
    'ph-light ph-moon': 'moon',
    'ph-light ph-sun': 'sun',
    'ph-light ph-gear': 'settings',
    'ph-light ph-lock-key': 'lock',
    'ph-light ph-trash': 'trash-2',
    'ph-light ph-clock-counter-clockwise': 'history',
    'ph-light ph-sign-out': 'log-out',
    'ph-light ph-trend-up': 'trending-up',
    'ph-light ph-camera': 'camera',
    'ph-light ph-info': 'info',
    'ph-light ph-arrow-up': 'arrow-up',
    'ph-light ph-arrow-down': 'arrow-down',
    'ph-light ph-plus': 'plus'
};

const files = ['public/board.html', 'public/operator.html', 'public/superadmin.html'];

for (const file of files) {
    let html = fs.readFileSync(file, 'utf8');
    
    // Replace script tag
    html = html.replace(
        /<script src="https:\/\/unpkg\.com\/@phosphor-icons\/web"><\/script>/,
        '<script src="https://unpkg.com/lucide@latest"></script>'
    );

    // Replace <i class="..."> with <i data-lucide="...">
    for (const [phClass, lucideName] of Object.entries(iconMap)) {
        const regex = new RegExp(`class="${phClass}"`, 'g');
        html = html.replace(regex, `data-lucide="${lucideName}"`);
        
        // Also sometimes it might have other classes, but based on grep we only have exact class="..."
    }
    
    // Replace emojis
    html = html.replace(/✅ ثبت شد/g, '<i data-lucide="check-circle" style="width: 18px; height: 18px; margin-left: 5px;"></i> ثبت شد');
    html = html.replace(/✅ فعال/g, '<i data-lucide="check-circle" style="width: 14px; height: 14px; margin-left: 5px;"></i> فعال');
    html = html.replace(/ویرایش ✏️/g, 'ویرایش <i data-lucide="edit-2" style="width: 14px; height: 14px; margin-right: 5px;"></i>');

    // Add initialization logic right before </body>
    if (!html.includes('lucide.createIcons()')) {
        const initScript = `
    <script>
        if (window.lucide) {
            lucide.createIcons();
            // Automatically create icons for dynamically added elements
            const observer = new MutationObserver((mutations) => {
                let shouldUpdate = false;
                for (let m of mutations) {
                    if (m.addedNodes.length > 0) {
                        shouldUpdate = true;
                        break;
                    }
                }
                if (shouldUpdate) {
                    lucide.createIcons();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    </script>
</body>`;
        html = html.replace(/<\/body>/, initScript);
    }
    
    fs.writeFileSync(file, html);
    console.log(`Updated ${file}`);
}
