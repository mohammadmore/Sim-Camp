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

    // PHP edition (cPanel): Node-style API paths become api.php actions (the build script sets SIMCAMP_PHP).
    const PHP_SPECIAL = { 'stage/close_tiered': 'close_tiered' };
    window.toPhpUrl = function (u) {
        const [path, qs = ''] = u.split('?');
        const params = new URLSearchParams(qs);
        let m;
        if (path === '/api') { if (!params.has('action')) params.set('action', 'update_camp'); }
        else if (path === '/login' || path === '/setup') params.set('action', path.slice(1));
        else if ((m = path.match(/^\/api\/(.+)$/))) params.set('action', PHP_SPECIAL[m[1]] || m[1].replace(/[/-]/g, '_'));
        else if ((m = path.match(/^\/superadmin\/camps\/([^/]+)\/(\w+)$/))) { params.set('action', 'superadmin_camp_' + m[2]); params.set('id', decodeURIComponent(m[1])); }
        else if ((m = path.match(/^\/superadmin\/camps\/([^/]+)$/))) { params.set('action', 'superadmin_camp'); params.set('id', decodeURIComponent(m[1])); }
        else if ((m = path.match(/^\/superadmin\/(\w+)$/))) params.set('action', 'superadmin_' + m[1]);
        else return u;
        return 'api.php?' + params.toString();
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        if (window.SIMCAMP_PHP && typeof input === 'string' && /^\/(api|login|setup|superadmin)(\/|\?|$)/.test(input)) input = window.toPhpUrl(input);
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

// ---------------------------------------------------------------------------
// Digits: Persian / Arabic keyboards type ۰-۹ / ٠-٩, which number fields reject.
// ---------------------------------------------------------------------------
window.toEnDigits = function (value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/[٫,]/g, '.')
        .replace(/[−–]/g, '-');
};

// Number in the camp's digit style (fa: ۱۲۳, en: 123); decimals kept up to 2 places.
window.fmtNum = function (n, lang) {
    const num = typeof n === 'number' ? Math.round(n * 100) / 100 : n;
    const s = String(num === undefined || num === null ? '' : num);
    return (lang || 'fa') === 'fa' ? s.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]).replace('.', '٫') : s;
};

(function () {
    // Numeric inputs become text inputs with a numeric keyboard, so Persian digits can be typed
    // and are converted on the fly.
    function upgradeNumberInput(el) {
        if (el.dataset.numUpgraded) return;
        el.dataset.numUpgraded = '1';
        const step = el.getAttribute('step');
        const min = el.getAttribute('min');
        el.type = 'text';
        el.setAttribute('inputmode', (step && step !== '1') || (min && parseFloat(min) < 1) ? 'decimal' : 'numeric');
        el.setAttribute('autocomplete', 'off');
    }
    function upgradeAll(root) {
        (root.querySelectorAll ? root : document).querySelectorAll('input[type="number"]').forEach(upgradeNumberInput);
    }
    document.addEventListener('input', e => {
        const el = e.target;
        if (!(el instanceof HTMLInputElement) || el.type === 'password') return;
        if (el.dataset.numUpgraded || /numeric|decimal/.test(el.getAttribute('inputmode') || '')) {
            const fixed = toEnDigits(el.value);
            if (fixed !== el.value) {
                const pos = el.selectionStart;
                el.value = fixed;
                try { el.setSelectionRange(pos, pos); } catch (err) { /* ignore */ }
            }
        }
    }, true);

    // ---------------------------------------------------------------------------
    // Accessibility: dialogs, labels, Esc to close, focus trap and restore.
    // ---------------------------------------------------------------------------
    function labelControls(root) {
        const scope = root.querySelectorAll ? root : document;
        scope.querySelectorAll('button:not([aria-label]), a.icon-btn:not([aria-label]), .close-btn:not([aria-label])').forEach(b => {
            const text = (b.textContent || '').replace(/[×✕\s]/g, '');
            if (!text) b.setAttribute('aria-label', b.getAttribute('title') || 'بستن');
        });
        scope.querySelectorAll('.close-btn').forEach(b => {
            if (!b.hasAttribute('role')) { b.setAttribute('role', 'button'); b.setAttribute('tabindex', '0'); }
        });
        scope.querySelectorAll('input:not([aria-label]), select:not([aria-label]), textarea:not([aria-label])').forEach(i => {
            if (i.id && document.querySelector(`label[for="${i.id}"]`)) return;
            const ph = i.getAttribute('placeholder') || i.getAttribute('title');
            if (ph) i.setAttribute('aria-label', ph);
        });
        scope.querySelectorAll('.modal-overlay, #fieldJudgingModal').forEach(m => {
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-modal', 'true');
            const h = m.querySelector('h2, h3');
            if (h && !m.hasAttribute('aria-label')) m.setAttribute('aria-label', h.textContent.trim().slice(0, 80));
        });
    }

    function isShown(el) {
        if (!el || !el.isConnected) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
    }
    function openDialogs() {
        return [...document.querySelectorAll('.modal-overlay, #fieldJudgingModal')].filter(isShown)
            .sort((a, b) => (parseInt(getComputedStyle(a).zIndex) || 0) - (parseInt(getComputedStyle(b).zIndex) || 0));
    }
    window.topDialog = function () {
        const list = openDialogs();
        return list[list.length - 1] || null;
    };
    const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    document.addEventListener('keydown', e => {
        const dlg = topDialog();
        if (e.key === 'Escape' && dlg && dlg.id !== 'fieldJudgingModal') { // the referee screen is a page, not a dialog
            const closer = dlg.querySelector('.close-btn, [id$="CloseBtn"], button[onclick^="close"]');
            if (closer) { e.preventDefault(); closer.click(); }
        } else if (e.key === 'Tab' && dlg) {
            const items = [...dlg.querySelectorAll(FOCUSABLE)].filter(isShown);
            if (!items.length) return;
            const first = items[0], last = items[items.length - 1];
            if (!dlg.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
            else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        } else if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('close-btn')) {
            e.preventDefault();
            e.target.click();
        }
    });

    // Move focus into a dialog when it opens and back to the opener when it closes.
    const lastOpener = new WeakMap();
    let wasOpen = new Set();
    function syncDialogFocus() {
        const now = new Set(openDialogs());
        now.forEach(d => {
            if (wasOpen.has(d)) return;
            lastOpener.set(d, document.activeElement);
            setTimeout(() => {
                if (!isShown(d) || d.contains(document.activeElement)) return;
                // Touch screens: focus the dialog itself, so the keyboard does not pop up on every dialog.
                const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
                const box = d.querySelector('.modal-content') || d;
                let target = touch ? null : (d.querySelector('input:not([type="hidden"]):not([readonly]), select, textarea')
                    || [...d.querySelectorAll(FOCUSABLE)].find(x => !x.classList.contains('close-btn')));
                if (!target || !isShown(target)) { if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1'); target = box; }
                target.focus({ preventScroll: true });
            }, 60);
        });
        wasOpen.forEach(d => {
            if (now.has(d)) return;
            const opener = lastOpener.get(d);
            if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
        });
        wasOpen = now;
    }

    // Only DOM insertions and dialog visibility changes matter; ignore the board's frequent style animations.
    let pendingLabels = false, pendingFocus = false;
    const isDialog = n => n.nodeType === 1 && (n.classList.contains('modal-overlay') || n.id === 'fieldJudgingModal');
    const observer = new MutationObserver(muts => {
        let added = false, dialogChanged = false;
        for (const m of muts) {
            if (m.type === 'childList' && m.addedNodes.length) {
                m.addedNodes.forEach(n => { if (n.nodeType === 1) { added = true; upgradeAll(n); if (n.matches && n.matches('input[type="number"]')) upgradeNumberInput(n); } });
            } else if (m.type === 'attributes' && isDialog(m.target)) {
                dialogChanged = true;
            }
        }
        if (added && !pendingLabels) {
            pendingLabels = true;
            setTimeout(() => { pendingLabels = false; labelControls(document); }, 250);
        }
        if ((added || dialogChanged) && !pendingFocus) {
            pendingFocus = true;
            requestAnimationFrame(() => { pendingFocus = false; syncDialogFocus(); });
        }
    });
    function start() {
        upgradeAll(document);
        labelControls(document);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

// ---------------------------------------------------------------------------
// Unsaved changes guard for long forms (camp setup, settings).
// ---------------------------------------------------------------------------
window.FormGuard = (function () {
    const dirty = new Set();
    function mark(e) {
        const host = e.target.closest && e.target.closest('[data-guard]');
        if (host) dirty.add(host.getAttribute('data-guard'));
    }
    document.addEventListener('input', mark, true);
    document.addEventListener('change', mark, true);
    window.addEventListener('beforeunload', e => {
        if (!dirty.size) return;
        e.preventDefault();
        e.returnValue = '';
    });
    return {
        // Call after (re)filling a form so that programmatic values do not count as edits.
        reset(name) { dirty.delete(name); },
        touch(name) { dirty.add(name); },
        isDirty(name) { return dirty.has(name); },
        confirmDiscard(name) {
            if (!dirty.has(name)) return true;
            if (!confirm('تغییرات ذخیره‌نشده از بین می‌رود. آیا مطمئن هستید؟')) return false;
            dirty.delete(name);
            return true;
        }
    };
})();

// ---------------------------------------------------------------------------
// Connection status pill: online / offline / stale data, and pending offline actions.
// ---------------------------------------------------------------------------
window.ConnectionStatus = (function () {
    let lastOk = 0, failing = false, el = null, pendingCount = 0, staleAfter = 12000;
    function render() {
        if (!el) return;
        const online = navigator.onLine !== false;
        const age = lastOk ? Math.round((Date.now() - lastOk) / 1000) : null;
        let cls = 'ok', text;
        if (!online) { cls = 'bad'; text = 'اینترنت قطع است'; }
        else if (failing || (lastOk && Date.now() - lastOk > staleAfter)) { cls = 'warn'; text = 'اتصال به سرور برقرار نیست'; }
        else if (!lastOk) { cls = 'warn'; text = 'در حال اتصال…'; }
        else text = age < 3 ? 'به‌روز' : `به‌روزرسانی ${fmtNum(age)} ثانیه پیش`;
        if (lastOk && cls !== 'ok') text += ` — آخرین داده: ${fmtNum(age)} ثانیه پیش`;
        el.className = 'conn-status conn-' + cls + (el.dataset.extra ? ' ' + el.dataset.extra : '');
        el.querySelector('.conn-text').textContent = text;
        const pend = el.querySelector('.conn-pending');
        pend.textContent = pendingCount ? `${fmtNum(pendingCount)} مورد در صف ارسال` : '';
        pend.style.display = pendingCount ? '' : 'none';
        el.setAttribute('aria-label', text + (pendingCount ? ` — ${pendingCount} مورد در صف ارسال` : ''));
    }
    return {
        mount(opts) {
            opts = opts || {};
            if (opts.staleAfter) staleAfter = opts.staleAfter;
            el = document.createElement('div');
            el.className = 'conn-status';
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'polite');
            el.innerHTML = '<span class="conn-dot"></span><span class="conn-text"></span><span class="conn-pending" style="display:none"></span>';
            if (opts.className) el.dataset.extra = opts.className;
            (opts.parent || document.body).appendChild(el);
            window.addEventListener('online', render);
            window.addEventListener('offline', render);
            setInterval(render, 1000);
            render();
            return el;
        },
        ok() { lastOk = Date.now(); failing = false; render(); },
        fail() { failing = true; render(); },
        setPending(n) { pendingCount = n; render(); },
        show(v) { if (el) el.style.display = v ? '' : 'none'; }
    };
})();

// ---------------------------------------------------------------------------
// Offline queue for scoring requests (they are idempotent on the server).
// ---------------------------------------------------------------------------
window.OfflineQueue = (function () {
    let key = 'offline_queue';
    let flushing = false;
    function load() { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } }
    function save(q) { try { localStorage.setItem(key, JSON.stringify(q)); } catch (e) { /* ignore */ } ConnectionStatus.setPending(q.length); }
    function post(item) {
        return fetch(item.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.body) });
    }
    async function flush() {
        if (flushing) return;
        flushing = true;
        try {
            let q = load();
            while (q.length) {
                const item = q[0];
                let res;
                try { res = await post(item); } catch (e) { break; } // still offline
                if (res.status >= 500) break;
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    if (window.showToast) showToast(`ارسال «${item.label || 'امتیاز'}» انجام نشد: ${data.message || data.error || res.status}`, 'error');
                }
                q = load().filter(x => x.qid !== item.qid);
                save(q);
                if (res.ok && typeof OfflineQueue.onSent === 'function') OfflineQueue.onSent(item);
            }
        } finally {
            flushing = false;
        }
    }
    window.addEventListener('online', flush);
    setInterval(flush, 10000);
    return {
        init(storageKey) { key = storageKey; ConnectionStatus.setPending(load().length); flush(); },
        size() { return load().length; },
        // Sends now; when the network is down the request is stored and retried later.
        send(url, body, label) {
            const item = { qid: 'q' + Date.now() + Math.random().toString(36).slice(2, 7), url, body, label };
            return post(item).then(res => {
                if (res.status >= 500) throw new TypeError('server unavailable');
                return jsonOrThrow(res);
            }).catch(err => {
                if (!(err instanceof TypeError)) throw err;
                const q = load();
                q.push(item);
                save(q);
                return { success: true, queued: true };
            });
        },
        // Removes a not-yet-sent instant score (undo while offline). Returns true when it was still queued.
        cancel(clientLogId) {
            const q = load();
            const rest = q.filter(x => !(x.body && x.body.clientLogId === clientLogId));
            if (rest.length === q.length) return false;
            save(rest);
            return true;
        },
        flush
    };
})();

// Bottom toast with an "undo" button and a countdown.
window.undoToast = function (text, onUndo, seconds) {
    let left = seconds || 8;
    document.querySelectorAll('.undo-toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'undo-toast';
    t.setAttribute('role', 'status');
    t.innerHTML = '<span class="undo-toast-text"></span><button type="button" class="undo-toast-btn"></button>';
    t.querySelector('.undo-toast-text').textContent = text;
    const btn = t.querySelector('.undo-toast-btn');
    const label = () => { btn.textContent = `لغو (${fmtNum(left)})`; };
    label();
    document.body.appendChild(t);
    const timer = setInterval(() => { left--; if (left <= 0) close(); else label(); }, 1000);
    function close() { clearInterval(timer); t.classList.add('hide'); setTimeout(() => t.remove(), 300); }
    btn.onclick = () => { close(); onUndo(); };
    return { close };
};

window.newClientLogId = function () {
    const r = (window.crypto && crypto.getRandomValues) ? Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('') : Math.random().toString(36).slice(2) + Date.now().toString(36);
    return 'log_c' + r;
};

// Pages with the round theme button in the top corner keep their content below it on phones.
document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.theme-toggle:not(.board-theme-toggle)')) document.body.classList.add('corner-controls');
});

// Styled file picker: fills the file name next to a .file-pick label.
document.addEventListener('change', e => {
    const i = e.target;
    if (!i || i.type !== 'file' || !i.closest('.file-pick')) return;
    const n = i.closest('.file-pick').querySelector('.file-name');
    if (n) n.textContent = i.files && i.files[0] ? i.files[0].name : '';
});

// ---------------------------------------------------------------------------
// Help dialog, clipboard and QR code
// ---------------------------------------------------------------------------
window.Help = {
    // opts.ok: label of the bottom button ('متوجه شدم' by default); false hides it (dialogs with their own buttons).
    show(title, html, opts) {
        opts = opts || {};
        let m = document.getElementById('helpModal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'helpModal';
            m.className = 'modal-overlay';
            m.style.zIndex = '20000';
            m.innerHTML = `<div class="modal-content glass help-content">
                <button type="button" class="close-btn" title="بستن" onclick="document.getElementById('helpModal').style.display='none'">&times;</button>
                <h2 class="help-title"></h2><div class="help-body"></div>
                <button type="button" class="help-ok" onclick="document.getElementById('helpModal').style.display='none'">متوجه شدم</button></div>`;
            m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
            document.body.appendChild(m);
        }
        m.querySelector('.help-title').textContent = title;
        m.querySelector('.help-body').innerHTML = html; // trusted, static help text
        const ok = m.querySelector('.help-ok');
        ok.style.display = opts.ok === false ? 'none' : '';
        ok.textContent = typeof opts.ok === 'string' ? opts.ok : 'متوجه شدم';
        m.style.display = 'flex';
    },
    // Shows the help automatically the first time this browser opens the page.
    once(key, title, html) {
        let seen = false;
        try { seen = localStorage.getItem('help_seen_' + key) === '1'; localStorage.setItem('help_seen_' + key, '1'); } catch (e) { seen = true; }
        if (!seen) setTimeout(() => Help.show(title, html), 600);
    }
};

window.copyText = function (text) {
    const done = () => window.showToast ? showToast('کپی شد', 'success') : null;
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done);
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } finally { ta.remove(); }
    return Promise.resolve();
};

// SVG markup of a QR code (needs vendor/qrcode-generator).
window.qrSvg = function (text, cellSize) {
    if (typeof qrcode !== 'function') return '';
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag(cellSize || 5, 8);
};

// Absolute URL of another page of this app (works from a sub-folder too).
window.appUrl = function (page) {
    const base = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
    return window.location.origin + base + page;
};

// Remove a row of a form list (team / stage / user / history entry) after confirmation.
window.confirmRemoveItem = function (btn, kind) {
    const item = btn.closest('.dynamic-item, .log-item');
    if (!item) return;
    const field = item.querySelector('.t-name, .stage-name-input, .u-user, input[type="text"]');
    const name = field && field.value ? field.value.trim() : '';
    const msgs = {
        team: `تیم «${name || 'بدون نام'}» حذف شود؟\nبا ذخیره، همه امتیازها و سوابق این تیم برای همیشه پاک می‌شود.`,
        stage: `مرحله «${name || 'بدون نام'}» حذف شود؟\nنمرات ثبت‌شده برای این مرحله دیگر نمایش داده نمی‌شوند.`,
        user: `کاربر «${name || 'بدون نام'}» حذف شود؟ این کاربر دیگر نمی‌تواند وارد شود.`,
        log: 'این ردیف از تاریخچه حذف شود؟ (پس از زدن «ذخیره تغییرات» اعمال می‌شود)'
    };
    if (!confirm(msgs[kind] || 'این مورد حذف شود؟')) return;
    const guard = item.closest('[data-guard]');
    if (guard && window.FormGuard) FormGuard.touch(guard.getAttribute('data-guard'));
    item.remove();
};

// Score / time typed by a referee: "83.5", "۸۳٫۵", "1:23.5" (min:sec) or "1:02:03" (h:min:sec) -> number.
window.parseScoreInput = function (raw) {
    const v = toEnDigits(raw).trim();
    if (v === '') return NaN;
    if (v.includes(':')) {
        const parts = v.split(':').map(p => p.trim());
        if (parts.length > 3 || parts.some(p => p === '' || isNaN(Number(p)))) return NaN;
        return Math.round(parts.reduce((acc, p) => acc * 60 + Number(p), 0) * 100) / 100;
    }
    const n = Number(v);
    return isFinite(n) ? n : NaN;
};

// 83.45 -> "1:23.45"
window.formatSeconds = function (sec) {
    const total = Math.max(0, Number(sec) || 0);
    const m = Math.floor(total / 60);
    const s = total - m * 60;
    const sStr = s.toFixed(2).padStart(5, '0').replace(/\.00$/, '');
    return m > 0 ? `${m}:${sStr}` : String(Math.round(total * 100) / 100);
};

// Installable app + offline app shell (service worker needs HTTPS or localhost).
if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
