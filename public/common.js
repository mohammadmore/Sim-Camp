// Shared helpers for all pages: HTML escaping, session token handling and image compression.
(function () {
    // Escape text before putting it into innerHTML / HTML attributes.
    window.esc = function (value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    // A JS string literal that is safe inside an HTML attribute, e.g. onclick="fn(${jsArg(x)})".
    window.jsArg = function (value) {
        return window.esc(JSON.stringify(String(value === undefined || value === null ? '' : value)));
    };

    // Only allow image sources that cannot run script.
    window.safeUrl = function (url) {
        const u = String(url || '').trim();
        if (!u) return '';
        if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(u)) return u;
        if (/^(https?:)?\/\//i.test(u) || /^[\w\-./%?=&#]+$/.test(u)) return u;
        return '';
    };

    // CSS colour values coming from data.
    window.safeColor = function (color, fallback) {
        const c = String(color || '').trim();
        return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]{3,20})$/i.test(c) ? c : (fallback || '#ffffff');
    };

    // ---- Session token (sent as X-Auth-Token on same-origin requests) ----
    const storageKey = () => window.AUTH_STORAGE_KEY || 'auth_token';
    window.Auth = {
        get() { try { return sessionStorage.getItem(storageKey()) || ''; } catch (e) { return ''; } },
        set(token) { try { sessionStorage.setItem(storageKey(), token); } catch (e) { /* ignore */ } },
        clear() { try { sessionStorage.removeItem(storageKey()); } catch (e) { /* ignore */ } }
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const sameOrigin = !/^[a-z]+:\/\//i.test(url) || url.startsWith(window.location.origin);
        const token = window.Auth.get();
        if (sameOrigin && token) {
            init = Object.assign({}, init);
            const headers = new Headers(init.headers || {});
            if (!headers.has('X-Auth-Token')) headers.set('X-Auth-Token', token);
            init.headers = headers;
        }
        return originalFetch(input, init).then(res => {
            if (res.status === 401 && sameOrigin && token && typeof window.onAuthExpired === 'function') {
                window.onAuthExpired();
            }
            return res;
        });
    };

    // ---- Images: downscale before storing them as data URLs (keeps the camp document small) ----
    window.compressImageFile = function (file, maxDim, quality) {
        maxDim = maxDim || 800;
        quality = quality || 0.82;
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => {
                const dataUrl = reader.result;
                // Vector / animated images are kept as they are.
                if (/^data:image\/(svg\+xml|gif)/i.test(dataUrl)) return resolve(dataUrl);
                const img = new Image();
                img.onerror = () => resolve(dataUrl);
                img.onload = () => {
                    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(img.width * scale));
                    canvas.height = Math.max(1, Math.round(img.height * scale));
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    const webp = canvas.toDataURL('image/webp', quality);
                    const out = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality);
                    resolve(out.length < dataUrl.length ? out : dataUrl);
                };
                img.src = dataUrl;
            };
            reader.readAsDataURL(file);
        });
    };

    // Parse a JSON response and turn HTTP errors into rejected promises with the server's message.
    window.jsonOrThrow = function (res) {
        return res.json().catch(() => ({})).then(data => {
            if (!res.ok || data.success === false || data.status === 'error') {
                const err = new Error(data.message || data.error || ('HTTP ' + res.status));
                err.status = res.status;
                err.data = data;
                throw err;
            }
            return data;
        });
    };
})();

// One CSV cell: quoted, and text that a spreadsheet would treat as a formula is neutralised.
window.csvCell = function (value) {
    let v = String(value === undefined || value === null ? '' : value);
    if (/^[=+@\t\r]/.test(v) || /^-[^\d.]/.test(v)) v = "'" + v;
    return '"' + v.replace(/"/g, '""') + '"';
};
