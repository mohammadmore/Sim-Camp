// Operator console of the live team draw («قرعه‌کشی»), opened with OPF.tool('draw').
// The participants come from an Excel file (parsed here with SheetJS), the groups are the camp's
// teams, every action goes through POST /api/draw and the console re-renders from the returned
// draw (the server is the source of truth). The hall display is the scoreboard (draw-board.js).
(function () {
    'use strict';

    // =========================================================================================
    // Core (no DOM): Persian normalisation, search, Excel input, pots, capacity, export
    // =========================================================================================
    const toEn = s => String(s == null ? '' : s)
        .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
        .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));

    // ی/ي، ک/ك، ه/ة، الف‌ها، اعراب، کشیده، نیم‌فاصله و کاراکترهای نامرئی، ارقام فارسی/عربی، حروف لاتین کوچک
    function normalize(s) {
        return toEn(s)
            .replace(/[يىئ]/g, 'ی')
            .replace(/ك/g, 'ک')
            .replace(/[ةۀھ]/g, 'ه')
            .replace(/[أإٱآ]/g, 'ا')
            .replace(/ؤ/g, 'و')
            .replace(/[ً-ٰٟـ]/g, '')
            .replace(/[‌‍‎‏﻿]/g, '')
            .replace(/[  -​  　]/g, ' ')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }
    const compact = s => normalize(s).replace(/\s+/g, '');

    const normCache = new Map();
    function norms(name) {
        let e = normCache.get(name);
        if (!e) {
            const n = normalize(name);
            e = { n, c: n.replace(/\s+/g, ''), words: n.split(' ') };
            if (normCache.size > 20000) normCache.clear();
            normCache.set(name, e);
        }
        return e;
    }

    function parseSeed(v) {
        if (v == null) return null;
        const m = /-?\d+(?:\.\d+)?/.exec(toEn(v));
        if (!m) return null;
        const x = parseFloat(m[0]);
        if (!isFinite(x) || x < 0 || Math.abs(x - Math.round(x)) > 1e-9) return null;
        return Math.round(x);
    }
    const isNumericCell = s => /^[\d۰-۹٠-٩\s.]+$/.test(s) && parseSeed(s) != null;

    const MAX_PEOPLE = 3000, MAX_NAME = 80, MAX_SEED = 999;

    // rows: array of arrays (first two columns used); base: sheet row index of rows[0] (0-based).
    // Returns { people:[{name,seed,row}], skipped:[{row,name,reason}], header:{row,text}|null,
    //           swapped, seeds:[{seed,count}], duplicates:[{name,seed,rows}] }.
    function parseRows(rows, base) {
        base = base || 0;
        const cell = (r, i) => { const v = rows[r] && rows[r][i]; return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); };
        // Swapped columns? (column A numbers, column B text)
        let aNum = 0, bNum = 0, cnt = 0;
        for (let r = 0; r < rows.length; r++) {
            const a = cell(r, 0), b = cell(r, 1);
            if (!a && !b) continue;
            cnt++;
            if (a && isNumericCell(a)) aNum++;
            if (b && isNumericCell(b)) bNum++;
        }
        const swapped = cnt > 1 && aNum > cnt * 0.6 && bNum < cnt * 0.4;
        const nc = swapped ? 1 : 0, sc = swapped ? 0 : 1;
        const at = r => { const seedRaw = cell(r, sc); return { name: cell(r, nc), seedRaw, seed: parseSeed(seedRaw) }; };
        const ok = x => !!x.name && x.seed != null && x.seed <= MAX_SEED;
        const people = [], skipped = [];
        let header = null, headerChecked = false;
        for (let r = 0; r < rows.length; r++) {
            const x = at(r);
            if (!x.name && !x.seedRaw) continue;
            const row = base + r + 1;
            // Header row: the first row whose seed cell is text (not a number), if it comes before any
            // participant and the next non-empty row is a valid participant. Anything else is reported
            // as a skipped row, never dropped silently.
            if (!headerChecked && x.seedRaw && x.seed == null && !/^[-+]?[\d۰-۹٠-٩.,٫\s]+$/.test(x.seedRaw)) {
                headerChecked = true;
                let n = r + 1;
                while (n < rows.length) { const y = at(n); if (y.name || y.seedRaw) break; n++; }
                if (!people.length && n < rows.length && ok(at(n))) { header = { row, text: [x.name, x.seedRaw].filter(Boolean).join(' | ') }; continue; }
            }
            if (!x.name) { skipped.push({ row, name: '', reason: 'نام خالی است' }); continue; }
            if (x.seed == null) { skipped.push({ row, name: x.name, reason: 'سید معتبر نیست' }); continue; }
            if (x.seed > MAX_SEED) { skipped.push({ row, name: x.name, reason: 'سید باید بین ۰ تا ۹۹۹ باشد' }); continue; }
            people.push({ name: x.name.slice(0, MAX_NAME), seed: x.seed, row });
        }
        const seedMap = new Map();
        people.forEach(p => seedMap.set(p.seed, (seedMap.get(p.seed) || 0) + 1));
        const seeds = [...seedMap.entries()].sort((a, b) => a[0] - b[0]).map(([seed, count]) => ({ seed, count }));
        const seen = new Map(), duplicates = [];
        people.forEach(p => {
            const k = p.seed + '|' + compact(p.name);
            if (seen.has(k)) duplicates.push({ name: p.name, seed: p.seed, rows: [seen.get(k), p.row] });
            else seen.set(k, p.row);
        });
        return { people, skipped, header, swapped, seeds, duplicates };
    }

    // SheetJS workbook → parse result of the first sheet that has data.
    function parseWorkbook(wb) {
        const X = window.XLSX;
        for (const name of wb.SheetNames) {
            const ws = wb.Sheets[name];
            if (!ws || !ws['!ref']) continue;
            const rows = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
            if (!rows.some(r => r && r.some(c => String(c).trim() !== ''))) continue;
            const base = X.utils.decode_range(ws['!ref']).s.r;
            const res = parseRows(rows, base);
            res.sheetName = name;
            if (!res.people.length) throw new Error('هیچ ردیف معتبری (نام + سید) در فایل پیدا نشد');
            if (res.people.length > MAX_PEOPLE) throw new Error(`حداکثر ${fmt(MAX_PEOPLE)} شرکت‌کننده مجاز است (این فایل ${fmt(res.people.length)} نفر دارد)`);
            return res;
        }
        throw new Error('فایل اکسل خالی است');
    }

    let xlsxLoading = null;
    function loadXlsx() {
        if (window.XLSX) return Promise.resolve(window.XLSX);
        if (!xlsxLoading) xlsxLoading = new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'vendor/xlsx-0.18.5.full.min.js';
            s.onload = () => (window.XLSX ? res(window.XLSX) : rej(new Error('کتابخانه اکسل بارگذاری نشد')));
            s.onerror = () => { xlsxLoading = null; rej(new Error('کتابخانه اکسل بارگذاری نشد')); };
            document.head.appendChild(s);
        });
        return xlsxLoading;
    }
    async function parseFile(file) {
        const X = await loadXlsx();
        const buf = await file.arrayBuffer();
        let wb;
        try { wb = X.read(new Uint8Array(buf), { type: 'array' }); } catch (e) { throw new Error('فایل اکسل خوانده نشد'); }
        return parseWorkbook(wb);
    }

    // ---- Draw helpers (work on the server's draw object + camp teams) ----
    const defaultPotName = seed => 'گلدان ' + fmt(seed, 'fa');
    function capacityOf(d, teams) {
        const T = Math.max(1, teams.length);
        return Math.max(Math.ceil(d.people.length / T), d.capacity || 0, 1);
    }
    const minCapacity = (d, teams) => Math.max(Math.ceil(d.people.length / Math.max(1, teams.length)), 1);
    const potName = (d, seed) => (d.potNames && d.potNames[String(seed)]) || defaultPotName(seed);
    function validPlaced(d, teams) {
        const ids = new Set(teams.map(t => t.id));
        return (d.placed || []).filter(x => ids.has(x.team));
    }
    function countsOf(d, teams) {
        const c = {};
        teams.forEach(t => { c[t.id] = 0; });
        validPlaced(d, teams).forEach(x => { c[x.team]++; });
        return c;
    }
    function potsOf(d, placedIds) {
        const m = new Map();
        d.people.forEach(p => {
            let e = m.get(p.seed);
            if (!e) { e = { seed: p.seed, total: 0, remaining: 0 }; m.set(p.seed, e); }
            e.total++;
            if (!placedIds.has(p.id)) e.remaining++;
        });
        return [...m.values()].sort((a, b) => a.seed - b.seed);
    }
    // Team for auto mode: fewest placements, ties → earlier in team order; -1 when all are full.
    function autoTeam(d, teams) {
        const cap = capacityOf(d, teams), c = countsOf(d, teams);
        let best = null;
        teams.forEach(t => { if (c[t.id] < cap && (best == null || c[t.id] < c[best.id])) best = t; });
        return best;
    }
    function searchPeople(d, placedIds, query, seed, limit) {
        limit = limit || 80;
        const q = normalize(query);
        if (!q) return { list: [], total: 0 };
        const qc = q.replace(/\s+/g, '');
        const toks = q.split(' ').filter(Boolean);
        const out = [];
        for (const p of d.people) {
            if (placedIds.has(p.id)) continue;
            if (seed != null && p.seed !== seed) continue;
            const e = norms(p.name);
            let score = -1;
            if (e.c.startsWith(qc)) score = 0;
            else if (toks.every(t => e.c.includes(t))) score = e.words.some(w => w.startsWith(toks[0])) ? 1 : 2;
            else if (e.c.includes(qc)) score = 3;
            if (score >= 0) out.push({ p, score, n: e.n });
        }
        out.sort((a, b) => a.score - b.score || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0) || a.p.id - b.p.id);
        return { list: out.slice(0, limit).map(x => x.p), total: out.length };
    }
    // Team typed as its number (1-based, in camp order) or (part of) its name.
    function findTeams(teams, q) {
        const t = compact(q);
        if (!t) return [];
        const names = teams.map(x => compact(x.name));
        const exact = teams.filter((x, i) => names[i] === t);
        if (exact.length) return exact;
        if (/^\d+$/.test(t)) { const n = parseInt(t, 10); return n >= 1 && n <= teams.length ? [teams[n - 1]] : []; }
        const pre = teams.filter((x, i) => names[i].startsWith(t));
        if (pre.length) return pre;
        return teams.filter((x, i) => names[i].includes(t));
    }

    const pad2 = n => String(n).padStart(2, '0');
    const stamp = t => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };

    // Results workbook: «تیم‌ها» (one column per team), «ترتیب قرعه» (log), «شرکت‌کننده‌ها».
    function exportSheets(d, teams) {
        const cap = capacityOf(d, teams), byId = new Map(d.people.map(p => [p.id, p]));
        const placed = validPlaced(d, teams);
        const grid = teams.map(() => new Array(cap).fill(''));
        const tIdx = new Map(teams.map((t, i) => [t.id, i]));
        placed.forEach(x => { const p = byId.get(x.pid); if (p && x.s < cap) grid[tIdx.get(x.team)][x.s] = p.name; });
        const tRows = [teams.map(t => t.name)];
        const filled = grid.map(col => col.reduce((m, v, i) => (v ? i + 1 : m), 0));
        const depth = Math.max(0, ...filled);
        for (let s = 0; s < depth; s++) tRows.push(grid.map(col => col[s]));
        tRows.push([]);
        tRows.push(grid.map(col => col.filter(Boolean).length));
        const log = [['ترتیب', 'نام', 'سید', 'گلدان', 'تیم', 'شماره تیم', 'خانه', 'شناسه', 'زمان']];
        placed.slice().sort((a, b) => a.o - b.o).forEach(x => {
            const p = byId.get(x.pid); if (!p) return;
            const ti = tIdx.get(x.team);
            log.push([x.o, p.name, p.seed, potName(d, p.seed), teams[ti].name, ti + 1, x.s + 1, p.id, x.t ? stamp(x.t) : '']);
        });
        const at = new Map(placed.map(x => [x.pid, x]));
        const ppl = [['شناسه', 'نام', 'سید', 'ردیف ورودی', 'وضعیت']];
        d.people.forEach(p => {
            const x = at.get(p.id);
            ppl.push([p.id, p.name, p.seed, p.row || '', x ? 'تیم ' + teams[tIdx.get(x.team)].name : 'در گلدان']);
        });
        return [
            { name: 'تیم‌ها', rows: tRows, widths: teams.map(() => 24) },
            { name: 'ترتیب قرعه', rows: log, widths: [8, 28, 8, 14, 20, 10, 8, 8, 20] },
            { name: 'شرکت‌کننده‌ها', rows: ppl, widths: [8, 28, 8, 12, 22] }
        ];
    }
    async function exportXlsx(d, teams) {
        const X = await loadXlsx();
        const wb = X.utils.book_new();
        exportSheets(d, teams).forEach(sh => {
            const ws = X.utils.aoa_to_sheet(sh.rows);
            ws['!cols'] = sh.widths.map(w => ({ wch: w }));
            X.utils.book_append_sheet(wb, ws, sh.name);
        });
        wb.Workbook = { Views: [{ RTL: true }] };
        const base = String(d.title || 'draw').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'draw';
        X.writeFile(wb, base + '.xlsx');
    }

    // =========================================================================================
    // UI
    // =========================================================================================
    const lang = () => (window.OPF && OPF.state && OPF.state.numLang) || 'fa';
    function fmt(v, l) { return window.fmtNum ? fmtNum(v, l || lang()) : String(v); }
    const E = s => (window.esc ? esc(s) : String(s));
    const color = (t, i) => (window.safeColor ? safeColor(t.color, '') : t.color) || ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2'][i % 6];

    const D = {
        draw: null,          // server draw object (or null)
        teams: [],           // camp teams (order = draw order)
        view: 'main',        // 'main' | 'settings' | 'upload'
        busy: false,
        parsed: null,        // upload result waiting for «ذخیره و شروع»
        fileName: '',
        built: '',           // which skeleton is in the DOM
        loadedAt: 0
    };
    const UI = { sel: null, q: '', all: false, hi: 0, results: [], total: 0, pick: null, matches: [], setQ: '' };
    let ov = null;   // overlay element
    const $ = s => ov && ov.querySelector(s);

    function api(op, body) {
        return fetch(`/api/draw?id=${encodeURIComponent(campId)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ op }, body || {}))
        }).then(jsonOrThrow);
    }

    function msg(text, kind) {
        if (!ov) return;
        let box = ov.querySelector('.dr-toasts');
        if (!box) { box = document.createElement('div'); box.className = 'dr-toasts'; box.setAttribute('aria-live', 'polite'); ov.appendChild(box); }
        const t = document.createElement('div');
        t.className = 'dr-toast ' + (kind || 'ok');
        t.textContent = text;
        box.appendChild(t);
        while (box.children.length > 3) box.firstChild.remove();
        setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 300); }, kind === 'bad' ? 5000 : 2600);
    }
    const fail = e => msg((e && e.message) || String(e), 'bad');

    // Runs an op; re-renders from the returned draw. Returns the response (or null on error).
    async function run(op, body, opts) {
        if (D.busy && !(opts && opts.force)) return null;
        D.busy = true;
        ov && ov.classList.add('dr-busy');
        try {
            const r = await api(op, body);
            setDraw(r.draw === undefined ? D.draw : r.draw);
            return r;
        } catch (e) { fail(e); return null; }
        finally { D.busy = false; ov && ov.classList.remove('dr-busy'); }
    }

    function setDraw(d) {
        D.draw = d || null;
        if (D.draw && UI.sel != null && placedIds().has(UI.sel)) UI.sel = null;
        render();
        syncStrip();
    }

    // The control strip button is "active" while the draw is on the board.
    function syncStrip() {
        if (!window.OPF || !OPF.state) return;
        const live = !!(D.draw && D.draw.live);
        const cur = !!(OPF.state.draw && OPF.state.draw.live);
        if (live === cur) return;
        OPF.state.draw = live ? Object.assign({}, OPF.state.draw || {}, { live: true }) : undefined;
        try { OPF.onData(OPF.state); } catch (e) { /* strip not on this page */ }
    }

    function placedIds() { return new Set(validPlaced(D.draw, D.teams).map(x => x.pid)); }
    function personById(id) { return D.draw && D.draw.people.find(p => p.id === id); }
    const teamById = id => D.teams.find(t => t.id === id);

    // ---------------------------------------------------------------------------------------
    // Open / load
    // ---------------------------------------------------------------------------------------
    function ensureOverlay() {
        if (ov) return ov;
        ov = document.createElement('div');
        ov.id = 'drawConsole';
        ov.className = 'modal-overlay dr-overlay';
        ov.innerHTML = `<div class="modal-content glass dr-console" role="dialog" aria-modal="true" aria-labelledby="drTitle">
            <button type="button" class="close-btn" title="بستن">&times;</button>
            <header class="dr-head">
                <h2 class="tool-title dr-title" id="drTitle">🎲 قرعه‌کشی</h2>
                <div class="dr-head-info"></div>
            </header>
            <div class="dr-body"></div></div>`;
        ov.querySelector('.close-btn').onclick = close;
        ov.addEventListener('click', e => { if (e.target === ov) close(); });
        ov.addEventListener('click', onClick);
        ov.addEventListener('change', onChange);
        ov.addEventListener('input', onInput);
        ov.addEventListener('keydown', onKey);
        document.body.appendChild(ov);
        return ov;
    }
    function close() { if (ov) ov.style.display = 'none'; }
    const isOpen = () => !!ov && ov.style.display === 'flex';

    async function load() {
        const cfg = await fetch(`/api/manage?id=${encodeURIComponent(campId)}`).then(jsonOrThrow);
        D.teams = (cfg.teams || []).filter(t => t && t.id);
        D.loadedAt = Date.now();
        return cfg.draw || null;
    }

    async function open() {
        ensureOverlay();
        ov.style.display = 'flex';
        if (!D.built) { ov.querySelector('.dr-body').innerHTML = '<p class="manage-note">در حال بارگذاری…</p>'; }
        try {
            const d = await load();
            D.view = 'main';
            D.built = '';
            setDraw(d);
            focusSearch();
        } catch (e) {
            ov.querySelector('.dr-body').innerHTML = `<p class="manage-note">${E(e.message || e)}</p>`;
        }
    }

    // Another manager changed the draw (visible through the public state while it is live): reload.
    function onState(s) {
        if (!isOpen() || D.busy || !D.draw || !s || !s.draw) return;
        const lastO = (D.draw.placed || []).reduce((m, x) => Math.max(m, x.o), 0);
        const pubO = (s.draw.placed || []).reduce((m, x) => Math.max(m, x.o), 0);
        if (s.draw.placedCount !== (D.draw.placed || []).length || pubO !== lastO || s.draw.title !== D.draw.title) {
            if (Date.now() - D.loadedAt < 1500) return;
            load().then(d => { if (!D.busy) setDraw(d); }).catch(() => {});
        }
    }

    // ---------------------------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------------------------
    function render() {
        if (!ov) return;
        const d = D.draw;
        renderHead();
        let kind;
        if (!d || D.view === 'upload') kind = 'upload';
        else if (D.view === 'settings') kind = 'settings';
        else if (d.status === 'setup') kind = 'ready';
        else if (d.status === 'done') kind = 'done';
        else kind = 'run';
        const body = ov.querySelector('.dr-body');
        ov.querySelector('.dr-console').dataset.view = kind;
        if (kind === 'run') {
            if (D.built !== 'run') { body.innerHTML = runSkeleton(); D.built = 'run'; }
            renderRun();
            return;
        }
        D.built = kind;
        if (kind === 'upload') body.innerHTML = uploadHtml();
        else if (kind === 'settings') { body.innerHTML = settingsHtml(); renderPeopleList(); }
        else if (kind === 'ready') body.innerHTML = readyHtml();
        else body.innerHTML = doneHtml();
    }

    function renderHead() {
        const d = D.draw, box = ov.querySelector('.dr-head-info');
        ov.querySelector('.dr-title').textContent = d ? '🎲 ' + (d.title || 'قرعه‌کشی') : '🎲 قرعه‌کشی';
        if (!d) { box.innerHTML = ''; return; }
        const n = validPlaced(d, D.teams).length, total = d.people.length;
        const st = d.status === 'done' ? 'پایان‌یافته' : d.status === 'setup' ? 'آماده شروع' : 'در حال اجرا';
        box.innerHTML = `
            <span class="dr-chip dr-st-${E(d.status)}">${st}</span>
            <span class="dr-chip">${fmt(n)} از ${fmt(total)} ثبت شده</span>
            <span class="dr-chip">ظرفیت هر تیم: ${fmt(capacityOf(d, D.teams))}</span>
            <label class="sw-row dr-live${d.live ? ' on' : ''}" title="مراسم قرعه‌کشی روی تابلوی زنده نمایش داده شود">
                <input type="checkbox" data-act="live" ${d.live ? 'checked' : ''}>
                <span class="sw-track"><span class="sw-knob"></span></span>
                <span class="sw-label">${d.live ? '<i class="dr-live-dot"></i>' : ''}نمایش روی تابلو</span></label>
            <a class="dr-chip dr-link" href="${E(boardUrl())}" target="_blank" rel="noopener">📺 باز کردن تابلو</a>`;
    }
    const boardUrl = () => (window.appUrl ? appUrl('board.html?id=' + encodeURIComponent(campId)) : 'board.html?id=' + encodeURIComponent(campId));

    // ---- Upload (no draw yet, or replacing one that has no placements) ----
    function uploadHtml() {
        const replacing = !!D.draw;
        return `<section class="dr-card dr-upload">
            <p class="manage-note">شرکت‌کننده‌ها از یک فایل اکسل خوانده می‌شوند و بین تیم‌های مسابقه تقسیم می‌شوند. هر نفری که در قرعه به تیمی می‌رود، عضو همان تیم می‌شود. گروه‌بندی بر اساس «سید» انجام می‌شود: هر سید یک گلدان است.</p>
            <div class="dr-drop" data-drop>
                <label class="file-pick dr-file">📄 انتخاب فایل اکسل<input type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv" data-act="file"><span class="file-name">${E(D.fileName || '')}</span></label>
                <span class="dr-drop-hint">ستون اول: نام — ستون دوم: سید (عدد). سطر عنوان اختیاری است.</span>
            </div>
            ${replacing ? `<div class="manage-row dr-row-end"><button type="button" data-act="back">بازگشت</button></div>` : ''}
        </section>
        <div class="dr-sum">${D.parsed ? summaryHtml() : ''}</div>`;
    }

    function summaryHtml() {
        const P = D.parsed, n = P.people.length, T = D.teams.length;
        const cap = Math.max(Math.ceil(n / Math.max(1, T)), 1);
        const skipped = P.skipped.length ? `<details class="dr-warn"><summary>${fmt(P.skipped.length)} ردیف نادیده گرفته شد (برای دیدن جزئیات بزنید)</summary>
            <ul>${P.skipped.map(s => `<li>ردیف ${fmt(s.row)}: ${E(s.reason)}${s.name ? ' — ' + E(s.name) : ''}</li>`).join('')}</ul></details>` : '';
        const dups = P.duplicates.length ? `<div class="dr-warn">${fmt(P.duplicates.length)} نام تکراری در یک گلدان هست (در جستجو با شماره ردیف ورودی تفکیک می‌شوند): ${P.duplicates.slice(0, 8).map(x => `${E(x.name)} (ردیف ${fmt(x.rows[0])} و ${fmt(x.rows[1])})`).join('، ')}${P.duplicates.length > 8 ? '، …' : ''}</div>` : '';
        const header = P.header ? `<div class="dr-info">سطر عنوان نادیده گرفته شد (ردیف ${fmt(P.header.row)}: «${E(P.header.text)}»)</div>` : '';
        const swapped = P.swapped ? `<div class="dr-info">ستون نام و سید جابه‌جا بود و خودکار تشخیص داده شد.</div>` : '';
        const teamsInfo = T
            ? `<div class="dr-capline"><b>${fmt(T)} تیم</b> · ظرفیت هر تیم: ${fmt(cap)} <span class="manage-note">(${fmt(T * cap)} جایگاه برای ${fmt(n)} شرکت‌کننده)</span></div>`
            : `<div class="dr-warn">ابتدا تیم‌ها را در تنظیمات مسابقه تعریف کنید</div>`;
        return `<section class="dr-card">
            <h3>${fmt(n)} شرکت‌کننده در ${fmt(P.seeds.length)} گلدان خوانده شد</h3>
            <p class="manage-note">شیت «${E(P.sheetName || '')}»${D.fileName ? ' — ' + E(D.fileName) : ''}</p>
            ${header}${swapped}${skipped}${dups}
            <div class="dr-table-wrap"><table class="dr-table"><thead><tr><th>سید</th><th>تعداد</th><th>نام گلدان (اختیاری)</th></tr></thead><tbody>
            ${P.seeds.map(s => `<tr><td>${fmt(s.seed)}</td><td>${fmt(s.count)}</td><td><input type="text" class="dr-input" data-potname="${s.seed}" maxlength="60" placeholder="${E(defaultPotName(s.seed))}"></td></tr>`).join('')}
            </tbody></table></div>
            <label class="dr-field"><span>عنوان مراسم (روی تابلو)</span><input type="text" class="dr-input" id="drSetTitle" maxlength="120" value="مراسم قرعه‌کشی"></label>
            ${teamsInfo}
            <div class="manage-row dr-row-end"><button type="button" class="btn-primary" data-act="setup" ${T ? '' : 'disabled'}>ذخیره و شروع</button></div>
        </section>`;
    }

    // ---- Draw exists but not started ----
    function readyHtml() {
        const d = D.draw, pots = potsOf(d, placedIds());
        return `<section class="dr-card">
            <h3>${fmt(d.people.length)} شرکت‌کننده در ${fmt(pots.length)} گلدان آماده است</h3>
            ${d.fileName ? `<p class="manage-note">فایل: ${E(d.fileName)}</p>` : ''}
            ${D.teams.length ? `<div class="dr-capline">${fmt(D.teams.length)} تیم · ظرفیت هر تیم: ${fmt(capacityOf(d, D.teams))}</div>` : '<div class="dr-warn">ابتدا تیم‌ها را در تنظیمات مسابقه تعریف کنید</div>'}
            <div class="manage-row dr-row-end">
                <button type="button" class="btn-primary" data-act="start" ${D.teams.length ? '' : 'disabled'}>▶ شروع قرعه‌کشی</button>
                <button type="button" data-act="settings">⚙ تنظیمات</button>
                <button type="button" data-act="upload">📄 فایل دیگر</button>
                <button type="button" class="btn-danger" data-act="clear">🗑 حذف قرعه‌کشی</button></div>
        </section>`;
    }

    // ---- Done ----
    function doneHtml() {
        const d = D.draw, n = validPlaced(d, D.teams).length;
        return `<section class="dr-card dr-done">
            <h3>✓ قرعه‌کشی به پایان رسید</h3>
            <p class="manage-note">${fmt(n)} از ${fmt(d.people.length)} شرکت‌کننده در ${fmt(D.teams.length)} تیم قرار گرفتند. اعضای تیم‌ها تا پایان مسابقه باقی می‌مانند.</p>
            <div class="manage-row">
                <button type="button" class="btn-primary" data-act="start">↺ بازگشایی قرعه‌کشی</button>
                <button type="button" data-act="export">⬇ خروجی اکسل</button>
                <button type="button" class="btn-danger" data-act="clear">🗑 حذف قرعه‌کشی</button></div>
        </section>
        <div class="dr-board dr-board-ro">${boardHtml(false)}</div>`;
    }

    // ---- Running ----
    function runSkeleton() {
        return `<div class="dr-run">
            <aside class="dr-side">
                <section class="dr-card dr-potcard"><h3>گلدان‌ها</h3><div class="dr-pots" role="group" aria-label="گلدان‌ها"></div></section>
                <section class="dr-card dr-searchcard">
                    <h3>جستجوی نام</h3>
                    <input type="search" class="dr-input dr-q" id="drQ" placeholder="بخشی از نام را تایپ کنید…" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="جستجوی نام" aria-controls="drResults">
                    <label class="dr-check"><input type="checkbox" data-act="all"> جستجو در همه گلدان‌ها</label>
                    <ul class="dr-results" id="drResults" role="listbox" aria-label="نتیجه‌ها"></ul>
                    <div class="dr-resinfo"></div>
                </section>
                <section class="dr-card dr-sel" hidden>
                    <h3>شرکت‌کننده انتخاب‌شده</h3>
                    <div class="dr-who"></div>
                    <div class="dr-pickrow">
                        <input type="text" class="dr-input dr-tq" id="drTeamQ" placeholder="شماره یا نام تیم، سپس Enter" autocomplete="off" enterkeyhint="done" aria-label="شماره یا نام تیم">
                        <button type="button" class="btn-primary" data-act="ok">تأیید</button>
                        <button type="button" data-act="cancel">انصراف</button>
                    </div>
                    <div class="dr-pickinfo"></div>
                    <div class="dr-picker" role="group" aria-label="تیم‌ها"></div>
                </section>
                <section class="dr-card dr-autocard">
                    <label class="sw-row dr-auto"><input type="checkbox" data-act="auto"><span class="sw-track"><span class="sw-knob"></span></span>
                        <span class="sw-label"><b>حالت خودکار</b><small>با انتخاب هر نام، مستقیم به تیم بعدی (کم‌جمعیت‌ترین) می‌رود</small></span></label>
                    <div class="dr-autoinfo"></div>
                </section>
            </aside>
            <section class="dr-main">
                <div class="dr-boardhead"><b>تیم‌ها</b><span class="dr-boardinfo"></span>
                    <button type="button" class="dr-btn" data-act="undo">↩ لغو آخرین</button></div>
                <div class="dr-board"></div>
            </section>
        </div>
        <footer class="dr-foot">
            <button type="button" data-act="settings">⚙ تنظیمات</button>
            <button type="button" data-act="export">⬇ خروجی اکسل</button>
            <span class="dr-spacer"></span>
            <button type="button" class="btn-primary" data-act="finish">✓ پایان قرعه‌کشی</button>
            <button type="button" class="btn-danger" data-act="reset">↺ شروع دوباره</button>
            <button type="button" class="btn-danger" data-act="clear">🗑 حذف قرعه‌کشی</button>
        </footer>`;
    }

    function renderRun() {
        const q = $('#drQ');
        if (q && q.value !== UI.q) q.value = UI.q;
        const all = $('[data-act="all"]'); if (all) all.checked = UI.all;
        renderPots(); renderResults(); renderSel(); renderAuto(); renderBoard();
    }

    function renderPots() {
        const d = D.draw, pots = potsOf(d, placedIds());
        $('.dr-pots').innerHTML = pots.map(p => `<button type="button" class="dr-pot${p.seed === d.curPot ? ' act' : ''}${p.remaining === 0 ? ' done' : ''}" data-pot="${p.seed}" aria-pressed="${p.seed === d.curPot}">
            <span>${E(potName(d, p.seed))}</span> <bdi dir="ltr"><b>${fmt(p.remaining)}</b><small>/${fmt(p.total)}</small></bdi></button>`).join('')
            || '<p class="manage-note">—</p>';
    }

    function renderResults() {
        const d = D.draw, ul = $('.dr-results'), info = $('.dr-resinfo');
        if (!ul) return;
        const ids = placedIds();
        const r = searchPeople(d, ids, UI.q, UI.all ? null : d.curPot, 80);
        UI.results = r.list; UI.total = r.total;
        if (UI.hi >= r.list.length) UI.hi = Math.max(0, r.list.length - 1);
        if (!UI.q.trim()) {
            ul.innerHTML = '';
            const pot = potsOf(d, ids).find(p => p.seed === d.curPot);
            const left = d.people.length - ids.size;
            info.textContent = !left ? 'همه شرکت‌کننده‌ها در تیم‌ها قرار گرفته‌اند 🎉'
                : pot ? `${fmt(pot.remaining)} نفر در ${potName(d, d.curPot)} باقی مانده` : '';
            return;
        }
        ul.innerHTML = r.list.map((p, i) => `<li role="option" class="${i === UI.hi ? 'hi' : ''}" aria-selected="${i === UI.hi}" data-pid="${p.id}">
            <span class="dr-nm">${E(p.name)}</span><span class="dr-badge">${E(potName(d, p.seed))}</span>${p.row ? `<span class="dr-row">ردیف ${fmt(p.row)}</span>` : ''}</li>`).join('');
        info.textContent = r.total
            ? (r.total > r.list.length ? `${fmt(r.list.length)} از ${fmt(r.total)} نتیجه — جستجو را دقیق‌تر کنید` : `${fmt(r.total)} نتیجه`)
            : (UI.all ? 'نتیجه‌ای پیدا نشد' : 'نتیجه‌ای پیدا نشد (فقط در گلدان جاری)');
        const hi = ul.children[UI.hi];
        if (hi && hi.scrollIntoView) hi.scrollIntoView({ block: 'nearest' });
    }

    function renderSel() {
        const card = $('.dr-sel');
        if (!card) return;
        const p = UI.sel != null ? personById(UI.sel) : null;
        if (!p) { UI.sel = null; card.hidden = true; return; }
        card.hidden = false;
        $('.dr-who').innerHTML = `<b>${E(p.name)}</b><span class="dr-badge">${E(potName(D.draw, p.seed))}</span>${p.row ? `<span class="dr-row">ردیف ${fmt(p.row)}</span>` : ''}`;
        const t = UI.pick ? teamById(UI.pick) : null;
        $('.dr-pickinfo').textContent = t ? `تیم انتخابی: ${t.name} — Enter یا «تأیید»` : 'تیم را از فهرست زیر بزنید یا شماره/نام آن را تایپ کنید';
        $('[data-act="ok"]').disabled = !t;
        renderPicker();
    }

    // Fewest placements among the teams that are not full; -1 when it would mark every open team.
    function hintMin(c, cap) {
        const open = D.teams.filter(t => c[t.id] < cap).map(t => c[t.id]);
        if (!open.length) return -1;
        const min = Math.min(...open);
        return open.every(n => n === min) && open.length > 1 ? -1 : min;
    }

    function renderPicker() {
        const d = D.draw, cap = capacityOf(d, D.teams), c = countsOf(d, D.teams);
        const min = hintMin(c, cap);
        const matches = new Set(UI.matches.map(t => t.id));
        $('.dr-picker').innerHTML = D.teams.map((t, i) => {
            const full = c[t.id] >= cap;
            const cls = ['dr-tbtn', !full && c[t.id] === min ? 'hint' : '', matches.size && matches.has(t.id) ? 'match' : '', UI.pick === t.id ? 'pick' : ''].filter(Boolean).join(' ');
            return `<button type="button" class="${cls}" data-team="${E(t.id)}" style="--tc:${E(color(t, i))}" ${full ? 'disabled' : ''} aria-pressed="${UI.pick === t.id}">
                <span class="dr-tnum">${fmt(i + 1)}</span><i class="dr-dot"></i><b>${E(t.name)}</b><small>${fmt(c[t.id])}/${fmt(cap)}</small></button>`;
        }).join('');
    }

    function renderAuto() {
        const d = D.draw, cb = $('[data-act="auto"]'), info = $('.dr-autoinfo');
        if (!cb) return;
        const auto = !!(d.settings && d.settings.auto);
        cb.checked = auto;
        const t = autoTeam(d, D.teams);
        info.textContent = auto ? (t ? `تیم بعدی: ${t.name}` : 'همه تیم‌ها پر هستند') : '';
        $('.dr-autocard').classList.toggle('on', auto);
    }

    function boardHtml(editable) {
        const d = D.draw, cap = capacityOf(d, D.teams), c = countsOf(d, D.teams);
        const min = editable ? hintMin(c, cap) : -1;
        const byId = new Map(d.people.map(p => [p.id, p]));
        const byTeam = {};
        validPlaced(d, D.teams).forEach(x => { (byTeam[x.team] = byTeam[x.team] || []).push(x); });
        const lastO = (d.placed || []).reduce((m, x) => Math.max(m, x.o), 0);
        return D.teams.map((t, i) => {
            const mem = (byTeam[t.id] || []).sort((a, b) => a.s - b.s);
            const free = cap - mem.length;
            return `<div class="dr-team${c[t.id] === min ? ' hint' : ''}${c[t.id] >= cap ? ' full' : ''}" style="--tc:${E(color(t, i))}">
                <header class="dr-team-head"><span class="dr-tnum">${fmt(i + 1)}</span><b>${E(t.name)}</b><span class="dr-count">${fmt(c[t.id])}/${fmt(cap)}</span></header>
                <ol class="dr-mem">${mem.map(x => { const p = byId.get(x.pid); return p ? `<li class="${x.o === lastO ? 'last' : ''}"><i>${fmt(x.s + 1)}</i><span class="dr-nm" title="${E(potName(d, p.seed))}">${E(p.name)}</span>${editable ? `<button type="button" class="dr-x" data-remove="${p.id}" title="حذف از تیم و بازگشت به گلدان" aria-label="حذف ${E(p.name)} از تیم">✕</button>` : ''}</li>` : ''; }).join('')}</ol>
                ${free > 0 ? `<div class="dr-free">${fmt(free)} جای خالی</div>` : ''}
            </div>`;
        }).join('') || '<p class="manage-note">ابتدا تیم‌ها را در تنظیمات مسابقه تعریف کنید</p>';
    }

    function renderBoard() {
        const d = D.draw, board = $('.dr-main .dr-board');
        const scroll = board.scrollTop;
        board.innerHTML = boardHtml(true);
        board.scrollTop = scroll;
        $('.dr-boardinfo').textContent = `${fmt(validPlaced(d, D.teams).length)} از ${fmt(d.people.length)} نفر`;
        $('[data-act="undo"]').disabled = !(d.placed || []).length;
    }

    // ---- Settings ----
    function settingsHtml() {
        const d = D.draw, placedAny = (d.placed || []).length > 0, pots = potsOf(d, placedIds());
        const hold = (d.settings && d.settings.holdMs) || 2600;
        const minCap = minCapacity(d, D.teams);
        return `<div class="dr-settings">
            <section class="dr-card">
                <h3>مراسم</h3>
                <label class="dr-field"><span>عنوان مراسم (روی تابلو)</span><input type="text" class="dr-input" id="drTitleInp" maxlength="120" value="${E(d.title || '')}"></label>
                <label class="dr-field"><span>مدت نمایش نام در وسط تابلو: <b id="drHoldTxt">${fmt(hold / 1000)} ثانیه</b></span>
                    <input type="range" id="drHold" min="1" max="8" step="0.5" value="${hold / 1000}"></label>
                <label class="dr-field"><span>ظرفیت هر تیم (خالی = خودکار)</span>
                    <input type="text" inputmode="numeric" class="dr-input dr-num" id="drCap" value="${d.capacity ? E(d.capacity) : ''}" placeholder="خودکار: ${fmt(minCap)}" ${placedAny ? 'disabled' : ''}></label>
                <p class="manage-note">${placedAny ? 'ظرفیت بعد از اولین ثبت قابل تغییر نیست (برای تغییر، «شروع دوباره» بزنید).' : `ظرفیت فعلی: ${fmt(capacityOf(d, D.teams))} نفر برای هر تیم`}</p>
            </section>
            <section class="dr-card">
                <h3>نام گلدان‌ها</h3>
                <div class="dr-potnames">${pots.map(p => `<label class="dr-field"><span>سید ${fmt(p.seed)} (${fmt(p.total)} نفر)</span><input type="text" class="dr-input" maxlength="60" data-potname="${p.seed}" value="${E(potName(d, p.seed))}"></label>`).join('')}</div>
            </section>
            <div class="manage-row dr-row-end"><button type="button" class="btn-primary" data-act="savesettings">ذخیره تنظیمات</button><button type="button" data-act="back">بازگشت</button></div>
            <section class="dr-card">
                <h3>شرکت‌کننده‌ها</h3>
                <p class="manage-note">برای اصلاح نام، آن را تغییر دهید و از خانه بیرون بیایید (یا Enter بزنید).</p>
                <input type="search" class="dr-input" id="drPeopleQ" placeholder="جستجو برای ویرایش نام…" autocomplete="off" value="${E(UI.setQ)}">
                <div class="dr-people"></div>
                <div class="dr-addrow">
                    <input type="text" class="dr-input" id="drAddName" maxlength="80" placeholder="نام شرکت‌کننده جدید">
                    <input type="text" inputmode="numeric" class="dr-input dr-num" id="drAddSeed" placeholder="سید">
                    <button type="button" data-act="add">＋ افزودن</button>
                </div>
            </section>
            <div class="manage-row dr-row-end"><button type="button" data-act="back">بازگشت</button></div>
        </div>`;
    }
    function renderPeopleList() {
        const box = $('.dr-people');
        if (!box) return;
        const d = D.draw, nq = normalize(UI.setQ), at = new Map(validPlaced(d, D.teams).map(x => [x.pid, x]));
        let shown = 0, total = 0, html = '';
        for (const p of d.people) {
            if (nq && !norms(p.name).n.includes(nq) && !norms(p.name).c.includes(nq.replace(/\s+/g, ''))) continue;
            total++;
            if (shown >= 60) continue;
            shown++;
            const x = at.get(p.id), t = x && teamById(x.team);
            html += `<div class="dr-prow"><span class="dr-badge">${E(potName(d, p.seed))}</span>
                <input type="text" class="dr-input" maxlength="80" data-rename="${p.id}" value="${E(p.name)}" aria-label="نام">
                <span class="dr-row">${t ? E(t.name) : 'در گلدان'}</span></div>`;
        }
        if (total > shown) html += `<p class="manage-note">${fmt(shown)} از ${fmt(total)} مورد نمایش داده شد؛ جستجو را دقیق‌تر کنید</p>`;
        if (!total) html += '<p class="manage-note">موردی پیدا نشد</p>';
        box.innerHTML = html;
    }

    // ---------------------------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------------------------
    function focusSearch(select) {
        const q = $('#drQ');
        if (!q || !isShownEl(q)) return;
        // Touch screens: do not pop the keyboard up on every placement unless the field was in use.
        const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
        if (touch && document.activeElement !== q && !UI.q && !select) return;
        q.focus({ preventScroll: true });
        if (select) q.select();
    }
    const isShownEl = el => !!el && el.getClientRects().length > 0;

    function choosePerson(pid) {
        const d = D.draw;
        if (d.settings && d.settings.auto) {
            const t = autoTeam(d, D.teams);
            if (!t) { msg('همه تیم‌ها پر هستند', 'bad'); return; }
            placed(run('auto', { pid }));
            return;
        }
        UI.sel = pid; UI.pick = null; UI.matches = [];
        const tq = $('#drTeamQ'); if (tq) tq.value = '';
        renderSel();
        const card = $('.dr-sel');
        if (card && card.scrollIntoView && window.innerWidth < 900) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        if (tq) tq.focus({ preventScroll: true });
    }
    function cancelSel() {
        UI.sel = null; UI.pick = null; UI.matches = [];
        renderSel();
        focusSearch(true);
    }
    function confirmSel() {
        if (UI.sel == null) return;
        if (!UI.pick) { msg('ابتدا تیم را انتخاب کنید', 'bad'); const tq = $('#drTeamQ'); tq && tq.focus(); return; }
        placed(run('place', { pid: UI.sel, team: UI.pick }));
    }
    // After a place/auto response: clear the search, tell what happened, focus the search box.
    async function placed(promise) {
        const prevPot = D.draw && D.draw.curPot;
        const r = await promise;
        if (!r) return;
        const pl = r.placement || (r.draw.placed || []).reduce((b, x) => (!b || x.o > b.o ? x : b), null);
        UI.sel = null; UI.pick = null; UI.matches = []; UI.q = ''; UI.hi = 0;
        const tq = $('#drTeamQ'); if (tq) tq.value = '';
        render();
        if (pl) {
            const p = personById(pl.pid), t = teamById(pl.team);
            if (p && t) msg(`«${p.name}» ← تیم ${t.name}`, 'ok');
        }
        if (r.draw && r.draw.curPot !== prevPot && prevPot != null) {
            const left = potsOf(r.draw, placedIds()).find(x => x.seed === prevPot);
            if (left && !left.remaining) msg(`${potName(r.draw, prevPot)} تمام شد؛ ادامه با ${potName(r.draw, r.draw.curPot)}`, 'info');
        }
        focusSearch(true);
    }

    async function removePerson(pid) {
        const x = (D.draw.placed || []).find(y => y.pid === pid);
        const p = personById(pid);
        if (!x || !p) return;
        const t = teamById(x.team);
        const r = await run('remove', { pid });
        if (!r) return;
        const text = `«${p.name}» از تیم ${t ? t.name : ''} حذف شد`;
        if (window.undoToast && t) undoToast(text, () => run('place', { pid, team: t.id }, { force: true }), 8);
        else msg(text, 'info');
    }
    async function undoLast() {
        const last = (D.draw.placed || []).reduce((b, x) => (!b || x.o > b.o ? x : b), null);
        if (!last) { msg('چیزی برای لغو نیست', 'info'); return; }
        const p = personById(last.pid), t = teamById(last.team);
        const r = await run('undo');
        if (r && p) msg(`«${p.name}» از تیم ${t ? t.name : ''} برداشته شد و به گلدان برگشت`, 'info');
        focusSearch(true);
    }

    async function handleFile(file) {
        if (!file) return;
        D.fileName = file.name || '';
        const sum = $('.dr-sum');
        if (sum) sum.innerHTML = '<p class="manage-note">در حال خواندن فایل…</p>';
        try {
            D.parsed = await parseFile(file);
        } catch (e) {
            D.parsed = null;
            if (sum) sum.innerHTML = `<div class="dr-warn">خطا: ${E(e.message || e)}</div>`;
            return;
        }
        render();
    }

    async function doSetup() {
        const P = D.parsed;
        if (!P) return;
        const potNames = {};
        ov.querySelectorAll('[data-potname]').forEach(i => { const v = i.value.trim(); if (v) potNames[i.dataset.potname] = v.slice(0, 60); });
        const title = (($('#drSetTitle') || {}).value || '').trim().slice(0, 120) || 'مراسم قرعه‌کشی';
        const r = await run('setup', { people: P.people, title, potNames, fileName: D.fileName });
        if (!r) return;
        D.parsed = null; D.view = 'main';
        const s = await run('start');
        if (s) { msg('قرعه‌کشی شروع شد. «نمایش روی تابلو» را برای مراسم روشن کنید.', 'ok'); focusSearch(true); }
    }

    async function saveSettings() {
        const d = D.draw, body = {};
        const title = ($('#drTitleInp').value || '').trim();
        if (title) body.title = title.slice(0, 120);
        body.holdMs = Math.round(parseFloat($('#drHold').value) * 1000);
        const potNames = {};
        ov.querySelectorAll('.dr-potnames [data-potname]').forEach(i => { potNames[i.dataset.potname] = i.value.trim().slice(0, 60) || defaultPotName(i.dataset.potname); });
        body.potNames = potNames;
        const capInp = $('#drCap');
        if (capInp && !capInp.disabled) {
            const v = parseInt(toEn(capInp.value), 10);
            if (capInp.value.trim() && !(v >= minCapacity(d, D.teams))) { msg(`ظرفیت باید حداقل ${fmt(minCapacity(d, D.teams))} باشد`, 'bad'); return; }
            body.capacity = v > minCapacity(d, D.teams) ? v : null;
        }
        const r = await run('settings', body);
        if (r) msg('تنظیمات ذخیره شد', 'ok');
    }

    async function addPerson() {
        const name = ($('#drAddName').value || '').replace(/\s+/g, ' ').trim();
        const seed = parseSeed($('#drAddSeed').value);
        if (!name || seed == null || seed > MAX_SEED) { msg('نام و سید معتبر را وارد کنید', 'bad'); return; }
        const r = await run('add', { name: name.slice(0, MAX_NAME), seed });
        if (r) msg(`«${name}» به ${potName(D.draw, seed)} اضافه شد`, 'ok');
    }

    // ---------------------------------------------------------------------------------------
    // Events (delegated on the overlay)
    // ---------------------------------------------------------------------------------------
    function onClick(e) {
        const el = e.target.closest('[data-act], [data-pot], [data-pid], [data-team], [data-remove]');
        if (!el || !ov.contains(el) || el.disabled) return;
        if (el.matches('input')) return; // checkboxes are handled in onChange
        if (el.dataset.pot != null) { const seed = parseInt(el.dataset.pot, 10); if (seed !== D.draw.curPot) run('pot', { seed }).then(() => focusSearch()); else focusSearch(); return; }
        if (el.dataset.pid != null) { choosePerson(parseInt(el.dataset.pid, 10)); return; }
        if (el.dataset.remove != null) { removePerson(parseInt(el.dataset.remove, 10)); return; }
        if (el.dataset.team != null) {
            if (UI.sel == null) { msg('ابتدا یک شرکت‌کننده انتخاب کنید', 'info'); return; }
            const t = teamById(el.dataset.team);
            UI.pick = t.id; UI.matches = [t];
            const tq = $('#drTeamQ'); if (tq) tq.value = t.name;
            renderSel();
            const ok = $('[data-act="ok"]'); ok && ok.focus({ preventScroll: true });
            return;
        }
        const act = el.dataset.act;
        if (el.tagName === 'LABEL' || act === 'live' || act === 'auto' || act === 'all' || act === 'file') return;
        switch (act) {
            case 'ok': confirmSel(); break;
            case 'cancel': cancelSel(); break;
            case 'undo': undoLast(); break;
            case 'setup': doSetup(); break;
            case 'start': run('start').then(r => { if (r) { D.view = 'main'; render(); focusSearch(true); } }); break;
            case 'finish':
                if (confirm('قرعه‌کشی پایان یابد؟ اعضای تیم‌ها باقی می‌مانند و نمایش روی تابلو خاموش می‌شود.')) run('finish').then(r => r && msg('قرعه‌کشی به پایان رسید', 'ok'));
                break;
            case 'reset':
                if (confirm('همه قرعه‌ها پاک شوند و همه شرکت‌کننده‌ها به گلدان برگردند؟ اعضایی که با قرعه به تیم‌ها اضافه شده‌اند هم حذف می‌شوند.')) run('reset').then(r => r && msg('قرعه‌کشی از نو شروع شد', 'ok'));
                break;
            case 'clear':
                if (confirm('قرعه‌کشی حذف شود؟ اعضایی که به تیم‌ها اضافه شده‌اند در تیم‌ها می‌مانند.')) run('clear').then(r => { if (r) { D.view = 'main'; D.parsed = null; render(); msg('قرعه‌کشی حذف شد', 'ok'); } });
                break;
            case 'export': exportXlsx(D.draw, D.teams).catch(fail); break;
            case 'settings': D.view = 'settings'; render(); break;
            case 'upload': D.view = 'upload'; D.parsed = null; render(); break;
            case 'back': D.view = 'main'; D.parsed = null; render(); focusSearch(); break;
            case 'savesettings': saveSettings(); break;
            case 'add': addPerson(); break;
        }
    }

    function onChange(e) {
        const el = e.target;
        const act = el.dataset && el.dataset.act;
        if (act === 'live') { const on = el.checked; run('live', { on }).then(r => { if (r) msg(on ? 'مراسم قرعه‌کشی روی تابلو نمایش داده می‌شود' : 'نمایش روی تابلو خاموش شد', 'ok'); else el.checked = !on; }); return; }
        if (act === 'auto') { const on = el.checked; run('settings', { auto: on }).then(r => { if (!r) el.checked = !on; focusSearch(); }); return; }
        if (act === 'all') { UI.all = el.checked; UI.hi = 0; renderResults(); focusSearch(); return; }
        if (act === 'file') { handleFile(el.files && el.files[0]); return; }
        if (el.dataset && el.dataset.rename != null) {
            const pid = parseInt(el.dataset.rename, 10), p = personById(pid);
            const name = el.value.replace(/\s+/g, ' ').trim();
            if (!p || name === p.name) return;
            if (!name) { el.value = p.name; return; }
            run('rename', { pid, name: name.slice(0, MAX_NAME) }).then(r => { if (r) msg('نام تغییر کرد', 'ok'); else el.value = p.name; });
        }
    }

    function onInput(e) {
        const el = e.target;
        if (el.id === 'drQ') { UI.q = el.value; UI.hi = 0; renderResults(); return; }
        if (el.id === 'drTeamQ') {
            UI.matches = findTeams(D.teams, el.value);
            const cap = capacityOf(D.draw, D.teams), c = countsOf(D.draw, D.teams);
            const free = UI.matches.filter(t => c[t.id] < cap);
            UI.pick = free.length ? free[0].id : null;
            renderSel();
            return;
        }
        if (el.id === 'drHold') { $('#drHoldTxt').textContent = fmt(parseFloat(el.value)) + ' ثانیه'; return; }
        if (el.id === 'drPeopleQ') { UI.setQ = el.value; renderPeopleList(); }
    }

    function onKey(e) {
        const el = e.target;
        if (el.id === 'drQ') {
            if (e.key === 'ArrowDown') { e.preventDefault(); UI.hi = Math.min(UI.results.length - 1, UI.hi + 1); renderResults(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); UI.hi = Math.max(0, UI.hi - 1); renderResults(); }
            else if (e.key === 'Enter') { e.preventDefault(); const p = UI.results[UI.hi]; if (p) choosePerson(p.id); }
            else if (e.key === 'Escape' && el.value) { e.preventDefault(); e.stopPropagation(); el.value = ''; UI.q = ''; renderResults(); }
            return;
        }
        if (el.id === 'drTeamQ') {
            if (e.key === 'Enter') { e.preventDefault(); confirmSel(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelSel(); }
            return;
        }
        if (el.dataset && el.dataset.rename != null && e.key === 'Enter') { e.preventDefault(); el.blur(); return; }
        if (el.id === 'drAddSeed' && e.key === 'Enter') { e.preventDefault(); addPerson(); return; }
        if (e.key === 'Escape' && UI.sel != null && ov.querySelector('.dr-sel:not([hidden])')) { e.preventDefault(); e.stopPropagation(); cancelSel(); }
    }

    // Drag and drop of the Excel file onto the upload card.
    document.addEventListener('dragover', e => { const z = ov && e.target.closest && e.target.closest('[data-drop]'); if (z) { e.preventDefault(); z.classList.add('over'); } });
    document.addEventListener('dragleave', e => { const z = ov && e.target.closest && e.target.closest('[data-drop]'); if (z) z.classList.remove('over'); });
    document.addEventListener('drop', e => {
        const z = ov && e.target.closest && e.target.closest('[data-drop]');
        if (!z) return;
        e.preventDefault(); z.classList.remove('over');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleFile(f);
    });

    window.DRAW = {
        open, close, onState, isOpen,
        // exposed for tests
        core: { normalize, compact, parseSeed, parseRows, parseWorkbook, parseFile, loadXlsx, capacityOf, potsOf, searchPeople, findTeams, autoTeam, exportSheets, defaultPotName },
        get state() { return { draw: D.draw, teams: D.teams, view: D.view, parsed: D.parsed, ui: UI }; },
        handleFile
    };
})();
