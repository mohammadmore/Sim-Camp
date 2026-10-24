// Service worker: keeps the app shell available offline. API calls are never cached.
const CACHE = 'simcamp-shell-v4';
const MEDIA_CACHE = 'simcamp-media-v1';
const SHELL = [
    './', 'operator.html', 'board.html', 'superadmin.html', 'results.html', 'team.html', 'live.html', 'analysis.html',
    'style.css?v=14', 'i18n.js', 'lang/en.js', 'lang/ar.js', 'common.js', 'features.js', 'advanced.js', 'operator-features.js', 'tooltip.js', 'validateRealTime.js?v=5',
    'favicon.svg', 'favicon.png', 'icon-192.png', 'manifest.webmanifest',
    'vendor/lucide-1.61.0.min.js', 'vendor/canvas-confetti-1.9.4.js', 'vendor/html2canvas-1.4.1.min.js',
    'vendor/qrcode-generator-1.4.4.js', 'vendor/vazirmatn/Vazirmatn-font-face.css',
    'vendor/vazirmatn/fonts/webfonts/Vazirmatn-Regular.woff2', 'vendor/vazirmatn/fonts/webfonts/Vazirmatn-Bold.woff2'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== MEDIA_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function isApi(url) {
    const p = url.pathname;
    return /\/api(\/|$)|\/api\.php$|\/login$|\/setup$|\/superadmin\//.test(p) || url.searchParams.has('action') || p.endsWith('.zip');
}

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    // Uploaded images never change (the name is the hash of the content): cache first.
    if (/\/media\/[a-f0-9]{32}\.\w+$/.test(url.pathname) || /\/media\.php$/.test(url.pathname)) {
        event.respondWith(caches.open(MEDIA_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
            if (res.ok) c.put(req, res.clone());
            return res;
        }))));
        return;
    }
    if (isApi(url)) return;

    // Pages: network first (always fresh), cached copy when offline.
    if (req.mode === 'navigate' || req.destination === 'document') {
        event.respondWith(
            fetch(req).then(res => {
                const copy = res.clone();
                caches.open(CACHE).then(c => c.put(url.pathname, copy));
                return res;
            }).catch(() => caches.match(url.pathname).then(r => r || caches.match('operator.html')))
        );
        return;
    }
    // Static files: network first so updates arrive immediately; cached copy when offline.
    event.respondWith(
        fetch(req).then(res => {
            if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
            return res;
        }).catch(() => caches.match(req))
    );
});
