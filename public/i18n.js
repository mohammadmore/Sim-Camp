/*
 * Interface language (فارسی / English / العربية).
 *
 * The pages are written in Persian. For English and Arabic this file loads the matching
 * dictionary (lang/en.js, lang/ar.js) and translates the page as it is drawn: text nodes,
 * readable attributes, alert/confirm/prompt and Excel exports. Persian digits are shown as
 * 0-9 in English and ٠-٩ in Arabic, and English pages are laid out left-to-right.
 *
 * Which language a page uses:
 *   - ?lang=en|ar|fa in the address always wins (handy for a board link in another language);
 *   - panels (data-scope="panel": operator, referee, superadmin, analysis) then use the
 *     language the person picked in the panel, kept in this browser;
 *   - otherwise the competition's language (uiLang), remembered per competition after the
 *     first load. When it changes, the page reloads once in the new language.
 *
 * Anything inside an element with translate="no" is left as it is (names typed by people).
 */
(function () {
    'use strict';
    const LANGS = {
        fa: { name: 'فارسی', dir: 'rtl', locale: 'fa-IR' },
        en: { name: 'English', dir: 'ltr', locale: 'en-GB' },
        ar: { name: 'العربية', dir: 'rtl', locale: 'ar-EG' }
    };
    const keep = new Set();
    const memo = new Map();
    const me = document.currentScript;
    const scope = (me && me.dataset.scope) || 'public';
    const base = me && me.src ? me.src.replace(/[^/]*$/, '') : '';
    const params = new URLSearchParams(location.search);
    const valid = l => (Object.prototype.hasOwnProperty.call(LANGS, l) ? l : '');
    const store = {
        get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
        set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* private mode */ } }
    };
    const USER_KEY = 'simcamp_lang';
    const campKey = () => 'simcamp_camplang:' + (params.get('id') || location.pathname);

    const urlLang = valid(params.get('lang'));
    const userLang = scope === 'panel' ? valid(store.get(USER_KEY)) : '';
    const lang = urlLang || userLang || valid(store.get(campKey())) || 'fa';
    const info = LANGS[lang];

    const I18N = {
        LANGS, lang, scope,
        dir: info.dir,
        locale: info.locale,
        missing: new Set(),
        t: s => s,
        /** Pages call this with the competition's uiLang (and its data) when the data arrives. */
        campLang(l, data) {
            if (data) I18N.names(data);
            l = valid(l) || 'fa';
            const before = store.get(campKey());
            store.set(campKey(), l === 'fa' ? '' : l);
            if (urlLang || userLang || l === lang) return;
            // Reload once per change, never in a loop.
            const guard = 'simcamp_langreload:' + campKey();
            try {
                const [gl, at] = (sessionStorage.getItem(guard) || '').split('|');
                if (gl === l && Date.now() - (+at || 0) < 15000) return;
                sessionStorage.setItem(guard, l + '|' + Date.now());
            } catch (e) { if (before === l) return; }
            location.reload();
        },
        /** A typed confirmation word: the Persian word or its translation, any letter case. */
        typed(input, word) {
            const v = String(input == null ? '' : input).trim().toLowerCase();
            return !!v && (v === word || v === String(I18N.t(word)).trim().toLowerCase());
        },
        /** Page direction: English is left-to-right; Persian keeps the competition's own setting. */
        pageDir(campDir) { return lang === 'fa' ? (campDir === 'ltr' ? 'ltr' : 'rtl') : info.dir; },
        /** The language picked in a panel's language menu ('' = follow the competition). */
        userLang,
        setUserLang(l) {
            store.set(USER_KEY, valid(l));
            const u = new URL(location.href);
            if (u.searchParams.has('lang')) { u.searchParams.delete('lang'); location.replace(u.toString()); } else location.reload();
        },
        /** A small language menu for panels: <select> with the three languages. */
        picker(className) {
            const sel = document.createElement('select');
            sel.className = className || 'lang-picker';
            sel.setAttribute('translate', 'no');
            sel.setAttribute('aria-label', 'Language / زبان');
            Object.keys(LANGS).forEach(k => {
                const o = document.createElement('option');
                o.value = k;
                o.textContent = '🌐 ' + LANGS[k].name;
                if (k === lang) o.selected = true;
                sel.appendChild(o);
            });
            sel.addEventListener('change', () => I18N.setUserLang(sel.value));
            return sel;
        },
        register(l, dict) { if (l === lang) addDict(dict); },
        /** Names people typed (teams, members, stages, users, titles) are never translated. */
        names(data) {
            const add = v => { if (typeof v === 'string' && v.trim()) keep.add(v.trim().replace(/\s+/g, ' ')); };
            const before = keep.size;
            add(data.title); add(data.orgName);
            (data.teams || []).forEach(t => { add(t.name); (t.members || []).forEach(m => add(m && m.name)); });
            (data.stages || []).forEach(st => add(st.name));
            (data.users || []).forEach(u => { add(u.name); add([u.firstName, u.lastName].filter(Boolean).join(' ')); add(u.firstName); add(u.lastName); });
            (data.divisions || []).forEach(d => add(d.name));
            (data.chanceCards || []).forEach(c => add(c.title));
            (data.rounds || []).forEach(r => { add(r.title); (r.options || []).forEach(o => add(o.label)); });
            if (keep.size !== before) memo.clear();
        }
    };
    window.I18N = I18N;

    document.documentElement.lang = lang;
    document.documentElement.dir = info.dir;
    // Panels get a language menu next to the theme button.
    if (scope === 'panel') document.addEventListener('DOMContentLoaded', () => {
        const theme = document.querySelector('.theme-toggle');
        if (theme && !document.querySelector('.lang-picker')) theme.insertAdjacentElement('afterend', I18N.picker('lang-picker lang-fixed'));
    });
    if (lang === 'fa') return;

    // ---- dictionary + matching -----------------------------------------------------------------
    const FA_CHARS = /[\u0600-\u06FF]/;
    const FA_LETTER = /[\u0621-\u064A\u067E\u0686\u0698\u06A9\u06AF\u06CC\u06C0]/;
    const dict = Object.create(null);
    let patterns = [];

    // "· X", "X:", "(X)" and the like also answer for a bare "X".
    const EDGE = /^[\s·•\-—–:،,؛;(]+|[\s·•\-—–:،,؛;.)]+$/g;
    function addDict(d) {
        Object.assign(dict, d);
        Object.keys(d).forEach(k => {
            const bare = k.replace(EDGE, '');
            if (bare !== k && FA_LETTER.test(bare) && !(bare in dict)) dict[bare] = String(d[k]).replace(EDGE, '');
        });
        patterns = [];
        Object.keys(dict).forEach(k => {
            if (!/\{\d+\}/.test(k)) return;
            const parts = k.split(/\{(\d+)\}/);
            let src = '^';
            const order = [];
            parts.forEach((p, i) => {
                if (i % 2) { order.push(+p); src += '([\\s\\S]*?)'; }
                else src += p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
            });
            const lit = parts.filter((_, i) => !(i % 2)).join('').replace(/\s/g, '').length;
            if (!lit) return;
            patterns.push({ re: new RegExp(src + '$'), order, out: dict[k], lit });
        });
        patterns.sort((a, b) => b.lit - a.lit);
        memo.clear();
    }

    const toDigits = lang === 'ar'
        ? s => s.replace(/[۰-۹]/g, d => '٠١٢٣٤٥٦٧٨٩'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])
        : s => s.replace(/[۰-۹٠-٩]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d) >= 0 ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(d) : '٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
            .replace(/(\d)٫(\d)/g, '$1.$2').replace(/(\d)٬(\d)/g, '$1,$2').replace(/،\s?/g, ', ').replace(/؛/g, ';').replace(/؟/g, '?').replace(/«/g, '“').replace(/»/g, '”');

    // Translates one trimmed string; returns null when nothing matched. Several strategies may
    // apply (a pattern, separators, brackets, single phrases); the one leaving the least Persian wins.
    const words = t => (t.match(/[\u0600-\u06FF\u200c]+/g) || []).filter(w => FA_LETTER.test(w));
    function lookup(s, depth) {
        if (keep.has(s)) return s;
        if (s in dict) return dict[s];
        if (depth > 4) return null;
        // How many of the source's Persian words a candidate still shows (works for Arabic too).
        const src = words(s);
        const leftover = t => { const have = new Set(words(t)); return src.filter(w => have.has(w)).length; };
        let best = null, bestLeft = Infinity;
        const offer = t => {
            if (t === null || t === s) return false;
            const left = leftover(t);
            if (left < bestLeft) { best = t; bestLeft = left; }
            return left === 0;
        };
        for (const p of patterns) {
            const m = p.re.exec(s);
            if (!m) continue;
            const t = p.out.replace(/\{(\d+)\}/g, (_, n) => {
                const g = m[p.order.indexOf(+n) + 1];
                return g === undefined ? '' : translateCore(g, depth + 1);
            });
            if (offer(t)) return best;
            break;
        }
        // Leading symbols / ending colon or punctuation around a known phrase.
        let m = /^([^\u0600-\u06FF«(\[{]*)([\s\S]*?)([\s:.!؟?…،—–·]*)$/.exec(s);
        if (m && (m[1] || m[3]) && m[2] && m[2] !== s && m[2] in dict && offer(m[1] + dict[m[2]] + m[3])) return best;
        // «quoted» text.
        m = /^«([^«»]+)»$/.exec(s);
        if (m && offer('«' + translateCore(m[1], depth + 1) + '»')) return best;
        // Pieces joined by separators: "مرحله ۲ · ۳ تیم", "رمز: ...", lines.
        const parts = s.split(/(\s*[·•|—–]\s*|\s+-\s+|:\s+|،\s*|\n+|\s*\/\s+)/);
        if (parts.length > 1 && offer(parts.map((p, i) => (i % 2 || !FA_LETTER.test(p) ? p : translateCore(p, depth + 1))).join(''))) return best;
        // Parenthesised tail: "پل‌سازی (زمانی)", or the whole text in brackets.
        m = /^([\s\S]*?)\s*\(([^()]+)\)$/.exec(s);
        if (m) {
            const a = m[1] ? translateCore(m[1], depth + 1) : '', b = translateCore(m[2], depth + 1);
            if (offer((a ? a + ' ' : '') + '(' + b + ')')) return best;
        }
        // Last resort: known phrases between numbers and symbols ("خلاقیت × ۲", "۲ بازیکن").
        const runs = s.split(/([\u0600-\u06FF\u200c]+(?:\s+[\u0600-\u06FF\u200c]+)*)/);
        if (runs.length > 1) offer(runs.map((p, i) => (i % 2 && p in dict ? dict[p] : p)).join(''));
        return best;
    }

    function translateCore(s, depth) {
        const lead = /^\s*/.exec(s)[0], trail = /\s*$/.exec(s)[0];
        const core = s.trim().replace(/\s+/g, ' ');
        if (!FA_LETTER.test(core)) return toDigits(s);
        let t = memo.get(core);
        if (t === undefined) {
            t = lookup(core, depth || 0);
            if (t === null) {
                t = core;
                if (I18N.missing.size < 2000) I18N.missing.add(core);
            }
            t = toDigits(t);
            memo.set(core, t);
        }
        return lead + t + trail;
    }

    I18N.t = s => (typeof s === 'string' && s && FA_CHARS.test(s) ? translateCore(s, 0) : s);

    // ---- DOM -----------------------------------------------------------------------------------
    const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-title', 'label'];
    const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1 };
    const skipped = el => !el || SKIP_TAGS[el.tagName] || el.isContentEditable || !!el.closest('[translate="no"]');
    const attrSkipped = el => !el || el.isContentEditable || !!el.closest('[translate="no"]');

    function trText(node) {
        const v = node.data;
        if (!v || !FA_CHARS.test(v) || skipped(node.parentElement)) return;
        const t = translateCore(v, 0);
        if (t !== v) node.data = t;
    }
    function trAttrs(el) {
        if (attrSkipped(el)) return;
        for (const a of ATTRS) {
            const v = el.getAttribute(a);
            if (v && FA_CHARS.test(v)) { const t = translateCore(v, 0); if (t !== v) el.setAttribute(a, t); }
        }
        if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && FA_CHARS.test(el.value)) el.value = translateCore(el.value, 0);
    }
    function walk(root) {
        if (root.nodeType === 3) return trText(root);
        if (root.nodeType !== 1) return;
        trAttrs(root);
        if (skipped(root)) return;
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
            acceptNode: n => {
                if (n.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
                if (n.getAttribute('translate') === 'no') return NodeFilter.FILTER_REJECT;
                if (SKIP_TAGS[n.tagName]) { trAttrs(n); return NodeFilter.FILTER_REJECT; }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let n;
        while ((n = w.nextNode())) {
            if (n.nodeType === 3) { if (FA_CHARS.test(n.data)) { const t = translateCore(n.data, 0); if (t !== n.data) n.data = t; } }
            else trAttrs(n);
        }
    }

    const obs = new MutationObserver(list => {
        for (const m of list) {
            if (m.type === 'characterData') trText(m.target);
            else if (m.type === 'attributes') { if (m.target.nodeType === 1) trAttrs(m.target); }
            else m.addedNodes.forEach(walk);
        }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['value']) });
    document.addEventListener('DOMContentLoaded', () => {
        walk(document.documentElement);
        hookXlsx();
    });

    // ---- dialogs and exports -------------------------------------------------------------------
    ['alert', 'confirm', 'prompt'].forEach(fn => {
        const orig = window[fn];
        if (typeof orig !== 'function') return;
        window[fn] = function (msg, def) {
            return fn === 'prompt' ? orig.call(window, I18N.t(String(msg == null ? '' : msg)), def) : orig.call(window, I18N.t(String(msg == null ? '' : msg)));
        };
    });
    function hookXlsx() {
        const X = window.XLSX;
        if (!X || !X.utils || X.utils.__i18n) return;
        X.utils.__i18n = true;
        const cell = v => (typeof v === 'string' ? I18N.t(v) : v);
        const aoa = X.utils.aoa_to_sheet, json = X.utils.json_to_sheet, append = X.utils.book_append_sheet;
        X.utils.aoa_to_sheet = (data, o) => aoa.call(X.utils, (data || []).map(r => (Array.isArray(r) ? r.map(cell) : r)), o);
        X.utils.json_to_sheet = (rows, o) => json.call(X.utils, (rows || []).map(r => {
            const out = {};
            Object.keys(r).forEach(k => { out[I18N.t(k)] = cell(r[k]); });
            return out;
        }), o && o.header ? Object.assign({}, o, { header: o.header.map(h => I18N.t(h)) }) : o);
        X.utils.book_append_sheet = (wb, ws, name, roll) => append.call(X.utils, wb, ws, name ? String(I18N.t(name)).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) : name, roll);
    }

    // The dictionary itself; it calls I18N.register(lang, {...}).
    document.write('<script src="' + base + 'lang/' + lang + '.js"><\/script>');
})();
