
        function refreshIcons() {
            if (window.lucide) {
                lucide.createIcons();
            }
        }
        document.addEventListener("DOMContentLoaded", refreshIcons);
    