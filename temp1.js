
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        function toggleTheme() {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            updateThemeIcon();
        }
        function updateThemeIcon() {
            const current = document.documentElement.getAttribute('data-theme');
            const icon = document.querySelector('.theme-toggle i, .theme-toggle svg');
            if (icon) {
                icon.outerHTML = current === 'dark' ? '<i data-lucide="sun"></i>' : '<i data-lucide="moon"></i>'; if(typeof refreshIcons === 'function') refreshIcons();
            }
        }
        document.addEventListener('DOMContentLoaded', () => { updateThemeIcon(); fetch('/api/settings').then(r=>r.json()).then(d=>{if(d.systemLogo)applySystemLogo(d.systemLogo)}); });

        const COLORS = [
            '#000000', '#ffffff', '#808080', '#c0c0c0', '#a9a9a9', // Black, White, Grays
            '#ff0000', '#800000', '#ff5733', '#ffa500', '#ff8c00', // Reds & Oranges
            '#ffff00', '#ffd700', '#bdb76b', '#f0e68c', '#eee8aa', // Yellows
            '#008000', '#00ff00', '#32cd32', '#228b22', '#006400', // Greens
            '#0000ff', '#000080', '#00bfff', '#1e90ff', '#4169e1', // Blues
            '#800080', '#ff00ff', '#8b008b', '#9400d3', '#9932cc', // Purples
            '#ffc0cb', '#ff69b4', '#ff1493', '#c71585', '#db7093', // Pinks
            '#8b4513', '#a0522d', '#d2691e', '#cd853f', '#f4a460', // Browns
            '#00ffff', '#20b2aa', '#008080', '#40e0d0', '#48d1cc', // Cyans/Teals
            '#e6e6fa', '#fff0f5', '#f5fffa', '#f0f8ff', '#f5f5dc'  // Off-whites/Pastels
        ];
    
        function moveItemUp(btn) {
            const item = btn.parentElement;
            if (item.previousElementSibling) {
                item.parentElement.insertBefore(item, item.previousElementSibling);
            }
        }
        function moveItemDown(btn) {
            const item = btn.parentElement;
            if (item.nextElementSibling) {
                item.parentElement.insertBefore(item.nextElementSibling, item);
            }
        }
        
    