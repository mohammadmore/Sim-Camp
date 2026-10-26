// «قرعه‌کشی» on the scoreboard: the hall display of the live team draw.
// board.html hands every new public state to DRAWBOARD.update(state). While state.draw.live is true a
// full-screen overlay shows the teams in two bands (top / bottom) with their slots and, in the middle,
// the camp logo, the title, the current pot and a big name card. New placements (o greater than the
// last one seen) play: name card in → hold → fly to the slot → pop. A plain state object is enough to
// drive it: { teams:[{id,name,color}], logo, numLang, display, draw:{live,title,cap,holdMs,total,
// placedCount,pot,placed:[{pid,team,s,o,name}]} }.
(function () {
    'use strict';
    const MAX_QUEUE = 6;          // more queued than this → placed without animation
    const NAME_LEN = 14;          // typical name length used for the layout (long names are shrunk to fit)
    const MIN_TV_FONT = 11;       // smaller than this → compact, scrollable layout
    const D = {
        on: false, state: null, draw: null, teams: [], placed: [], lastO: null, queue: [], hidden: new Set(), cur: null,
        busy: false, gen: 0, slotEls: {}, slotVal: {}, lay: null, sig: '', compact: false, el: null, confetti: null, nameFont: 40
    };

    const L = s => (window.Feat && Feat.t ? Feat.t(s) : s);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const num = n => ((D.state && D.state.numLang && D.state.numLang !== 'fa') ? String(n) : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]));
    const color = c => (window.safeColor ? safeColor(c, '#6366f1') : (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '#6366f1'));
    const shown = (st, k) => (window.Feat && Feat.shown ? Feat.shown(st, k) : true);
    function h(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    // Shrinks the text of el until it fits its box (one line).
    function fit(el, px) {
        el.style.fontSize = px + 'px';
        let i = 0;
        while (el.scrollWidth > el.clientWidth + 1 && i++ < 40 && px > 4) { px *= 0.94; el.style.fontSize = px + 'px'; }
    }

    /* Layout of the hall display (from the original tool): the teams in two bands, top and bottom,
       an empty area in the middle. Picks the combination (rows of cards × columns inside a card)
       that gives the largest font. */
    function computeLayout(o) {
        const W = o.W, H = o.H, G = o.G, cap = o.cap;
        const L = Math.min(Math.max(o.nameLen || 12, 6), 36);
        const m = Math.max(4, Math.round(Math.min(W, H) * 0.0085));
        const p = Math.max(2, m * 0.5);
        const Gt = Math.ceil(G / 2), Gb = G - Gt;
        const hcMin = Math.max(H * 0.3, 220);
        let best = null;
        for (let R = 1; R <= 5; R++) {
            const rt = Math.min(R, Gt), ct = Math.ceil(Gt / rt);
            const rb = Gb ? Math.min(R, Gb) : 0, cb = Gb ? Math.ceil(Gb / rb) : 0;
            const cols = Math.max(ct, cb), Rmax = Math.max(rt, rb);
            for (let c = 1; c <= 8 && c <= cap; c++) {
                const cw = (W - m * (cols + 1)) / cols;
                const sw = (cw - 2 * p - (c - 1) * p) / c;
                if (sw <= 6) continue;
                const rowsIn = Math.ceil(cap / c);
                const bandAvail = (H - hcMin - (Gb ? 4 : 3) * m) / (Gb ? 2 : 1);
                const ch = (bandAvail - (Rmax - 1) * m) / Rmax;
                const shH = (ch - 2 * p) / (rowsIn + 1.3);
                if (shH <= 4) continue;
                const f = Math.min(shH * 0.68, sw / (0.5 * L + 1.7), H * 0.05);
                if (!best || f > best.f * 1.03) best = { f, R, c, cw, sw, rowsIn, shH, rt, ct, rb, cb };
            }
        }
        if (!best) { // very crowded
            const cols = Math.ceil(G / 2);
            const cw = (W - m * (cols + 1)) / cols;
            const rowsIn = cap;
            const shH = Math.max(4, ((H - hcMin - 4 * m) / 2 - 2 * p) / (rowsIn + 1.3));
            best = { f: Math.max(4, shH * 0.68), R: 1, c: 1, cw, sw: cw - 2 * p, rowsIn, shH, rt: 1, ct: Gt, rb: Gb ? 1 : 0, cb: Gb };
        }
        const f = Math.max(4, Math.round(best.f * 10) / 10);
        const sh = Math.min(best.shH, f * 1.6);
        const hh = sh * 1.3;
        const cardH = 2 * p + hh + best.rowsIn * sh;
        const cards = [];
        const bandCards = (from, count, cols) => {
            // rows from right to left; a shorter last row is centred
            const res = [];
            let left = count, idx = from, r = 0;
            while (left > 0) {
                const nn = Math.min(cols, left);
                const totalW = nn * best.cw + (nn - 1) * m;
                const x0 = (W - totalW) / 2;
                for (let k = 0; k < nn; k++) res.push({ g: idx + k, r, x: x0 + (nn - 1 - k) * (best.cw + m) });
                idx += nn; left -= nn; r++;
            }
            return { items: res, rows: r };
        };
        const top = bandCards(0, Gt, best.ct);
        const topBandH = top.rows * cardH + (top.rows - 1) * m;
        top.items.forEach(c => cards.push({ g: c.g, x: c.x, y: m + c.r * (cardH + m), w: best.cw, h: cardH }));
        let botTop = H - m;
        if (Gb) {
            const bot = bandCards(Gt, Gb, best.cb);
            const botBandH = bot.rows * cardH + (bot.rows - 1) * m;
            botTop = H - m - botBandH;
            bot.items.forEach(c => cards.push({ g: c.g, x: c.x, y: botTop + c.r * (cardH + m), w: best.cw, h: cardH }));
        }
        const cy = m + topBandH + m;
        const center = { x: m, y: cy, w: W - 2 * m, h: Math.max(60, botTop - m - cy) };
        cards.sort((a, b) => a.g - b.g);
        return { m, p, cols: best.c, rowsIn: best.rowsIn, sh, hh, font: f, cards, center, cardH, cw: best.cw };
    }

    function build() {
        if (D.el) return;
        const el = D.el = {
            ov: h('div', 'drb-overlay'),
            stage: h('div', 'drb-stage'),
            board: h('div', 'drb-board'),
            center: h('div', 'drb-center'),
            logo: h('img', 'drb-logo'),
            title: h('div', 'drb-title'),
            pot: h('span', 'drb-pot'),
            count: h('span', 'drb-count'),
            wrap: h('div', 'drb-namewrap'),
            card: h('div', 'drb-namecard'),
            name: h('span', 'drb-name'),
            team: h('div', 'drb-team'),
            cf: h('canvas', 'drb-cf')
        };
        el.ov.setAttribute('translate', 'no'); // names are data; UI strings are translated in code
        el.ov.setAttribute('role', 'region');
        el.ov.setAttribute('aria-live', 'polite');
        el.ov.style.display = 'none';
        el.logo.alt = '';
        el.logo.style.display = 'none';
        el.card.append(el.name);
        el.wrap.append(el.card, el.team);
        const head = h('div', 'drb-head'); head.append(el.logo, el.title);
        const meta = h('div', 'drb-meta'); meta.append(el.pot, el.count);
        el.center.append(head, meta, el.wrap);
        el.stage.append(el.board, el.center);
        el.ov.append(el.stage, el.cf);
        document.body.append(el.ov);
        let rz;
        window.addEventListener('resize', () => {
            clearTimeout(rz);
            rz = setTimeout(() => { if (D.on) { D.sig = ''; rebuild(); fillSlots(); } }, 120);
        });
    }

    function show() {
        build();
        D.on = true;
        D.lastO = null;
        D.el.ov.style.display = '';
        document.body.classList.add('drb-on');
    }

    function hide() {
        if (!D.on) return;
        D.on = false; D.gen++;
        D.queue = []; D.hidden.clear(); D.cur = null; D.lastO = null; D.sig = '';
        D.el.ov.style.display = 'none';
        D.el.card.classList.remove('in', 'out'); D.el.card.style.display = 'none'; D.el.team.classList.remove('show');
        D.el.ov.classList.remove('drb-anim');
        document.querySelectorAll('.drb-fly').forEach(f => f.remove());
        document.body.classList.remove('drb-on');
        if (D.confetti && D.confetti.reset) try { D.confetti.reset(); } catch (e) { /* ignore */ }
    }

    function teamName(id) { const t = D.teams.find(x => x.id === id); return t ? t.name : ''; }
    function teamColor(id) { const t = D.teams.find(x => x.id === id); return t ? t.color : '#6366f1'; }

    function rebuild() {
        const d = D.draw; if (!d) return;
        const W = window.innerWidth, H = window.innerHeight;
        const G = D.teams.length, cap = Math.max(1, parseInt(d.cap, 10) || 1);
        const sig = [W, H, cap, D.teams.map(t => t.id + '\u0002' + t.name + '\u0002' + t.color).join('\u0001'), document.documentElement.dir].join('|');
        if (sig === D.sig) return;
        D.sig = sig;
        let lay = null, compact = W < 640 || !G;
        if (!compact) { lay = computeLayout({ W, H, G, cap, nameLen: NAME_LEN }); if (lay.font < MIN_TV_FONT) compact = true; }
        D.compact = compact;
        D.lay = compact ? { font: 14 } : lay;
        const el = D.el;
        el.ov.classList.toggle('drb-compact', compact);
        el.board.innerHTML = ''; D.slotEls = {}; D.slotVal = {};
        const ltr = getComputedStyle(document.documentElement).direction === 'ltr';
        const frag = document.createDocumentFragment();
        D.teams.forEach((t, g) => {
            const card = h('div', 'drb-card');
            card.style.setProperty('--team', t.color);
            const head = h('div', 'drb-ghead', t.name);
            head.title = t.name;
            const body = h('div', 'drb-gbody');
            if (!compact) {
                const cd = lay.cards[g];
                const x = ltr ? W - cd.x - cd.w : cd.x;
                card.style.cssText += `left:${x}px;top:${cd.y}px;width:${cd.w}px;height:${cd.h}px;font-size:${lay.font}px;border-radius:${Math.max(6, lay.font * 0.55)}px;`;
                head.style.height = lay.hh + 'px';
                head.style.fontSize = (lay.font * 1.08) + 'px';
                body.style.cssText = `padding:${lay.p}px;grid-template-columns:repeat(${lay.cols},minmax(0,1fr));grid-template-rows:repeat(${lay.rowsIn},${lay.sh}px);column-gap:${lay.p}px`;
            }
            for (let s = 0; s < cap; s++) {
                const slot = h('div', 'drb-slot');
                slot.append(h('span', 'drb-n', num(s + 1)), h('span', 'drb-t'));
                D.slotEls[t.id + '-' + s] = slot;
                body.append(slot);
            }
            card.append(head, body);
            frag.append(card);
        });
        el.board.append(frag);
        D.teams.forEach((t, g) => { const hd = el.board.children[g].firstChild; fit(hd, parseFloat(hd.style.fontSize) || (compact ? 16 : lay.font)); });
        const cs = el.center.style;
        if (compact) {
            cs.left = cs.top = cs.width = cs.height = '';
            D.nameFont = Math.min(W * 0.09, 44);
            el.title.style.fontSize = Math.min(W * 0.06, 26) + 'px';
            el.logo.style.height = '48px';
            el.pot.style.fontSize = el.count.style.fontSize = '14px';
            el.team.style.fontSize = Math.min(W * 0.05, 22) + 'px';
        } else {
            const c = lay.center;
            Object.assign(cs, { left: c.x + 'px', top: c.y + 'px', width: c.w + 'px', height: c.h + 'px' });
            D.nameFont = Math.min(c.h * 0.22, W * 0.07);
            el.title.style.fontSize = Math.min(c.h * 0.13, W * 0.035) + 'px';
            el.logo.style.height = Math.min(c.h * 0.16, W * 0.045) + 'px';
            el.pot.style.fontSize = el.count.style.fontSize = Math.min(c.h * 0.085, W * 0.022) + 'px';
            el.team.style.fontSize = Math.min(c.h * 0.09, W * 0.03) + 'px';
        }
        el.card.style.fontSize = D.nameFont + 'px';
        el.name.style.fontSize = D.nameFont + 'px';
    }

    function fillSlots() {
        const d = D.draw; if (!d || !D.lay) return;
        const want = {};
        (D.placed || []).forEach(x => { if (!D.hidden.has(x.pid)) want[x.team + '-' + x.s] = x.name; });
        for (const key in D.slotEls) {
            const nm = want[key] || '';
            if ((D.slotVal[key] || '') === nm) continue;
            D.slotVal[key] = nm;
            const slot = D.slotEls[key], t = slot.lastChild;
            t.textContent = nm;
            t.title = nm;
            slot.classList.toggle('filled', !!nm);
            if (nm) fit(t, D.lay.font); else t.style.fontSize = '';
        }
    }

    function renderCenter() {
        const st = D.state, d = D.draw, el = D.el;
        const brand = (shown(st, 'brand') && st.brand) || {};
        const logo = (window.safeUrl ? safeUrl(st.logo || brand.clientLogo || '') : (st.logo || ''));
        if (logo) { if (el.logo.getAttribute('src') !== logo) el.logo.src = logo; el.logo.style.display = ''; } else el.logo.style.display = 'none';
        const title = String(d.title || st.title || 'مراسم قرعه‌کشی');
        el.title.textContent = title === 'مراسم قرعه‌کشی' ? L(title) : title;
        const pot = String(d.pot || '');
        el.pot.textContent = /^گلدان\s*[۰-۹0-9]+$/.test(pot) ? L(pot) : pot;
        el.pot.style.display = pot ? '' : 'none';
        const total = parseInt(d.total, 10) || 0, placed = d.placedCount != null ? d.placedCount : D.placed.length;
        el.count.textContent = L(`${num(placed)} از ${num(total)} نفر`);
        el.count.style.display = total ? '' : 'none';
        el.ov.setAttribute('aria-label', L('قرعه‌کشی تیم‌ها'));
    }

    async function pump() {
        if (D.busy) return;
        D.busy = true;
        const gen = D.gen;
        try {
            while (D.queue.length && gen === D.gen) {
                const ev = D.queue.shift();
                if (D.queue.length > MAX_QUEUE) { D.hidden.delete(ev.pid); fillSlots(); continue; }
                D.cur = ev;
                await playPlace(ev, D.queue.length >= 1, gen);
                D.cur = null;
            }
        } catch (e) { console.error(e); }
        D.busy = false;
        if (gen === D.gen) { D.hidden.clear(); fillSlots(); }
        if (D.on && D.queue.length) pump();
    }

    function burst(teamCol) {
        if (!shown(D.state, 'confetti') || typeof window.confetti !== 'function') return;
        try {
            if (!D.confetti) D.confetti = window.confetti.create ? window.confetti.create(D.el.cf, { resize: true, useWorker: false }) : window.confetti;
            const r = D.el.card.getBoundingClientRect();
            const x = (r.left + r.width / 2) / window.innerWidth, y = (r.top + r.height / 2) / window.innerHeight;
            const colors = ['#ffffff', '#facc15', '#60a5fa', '#f472b6', '#34d399'];
            if (/^#[0-9a-f]{6}$/i.test(teamCol)) colors.unshift(teamCol, teamCol);
            D.confetti({ particleCount: 110, spread: 100, startVelocity: 38, origin: { x, y }, colors, disableForReducedMotion: true });
        } catch (e) { /* no confetti */ }
    }

    async function playPlace(ev, fast, gen) {
        const el = D.el;
        const col = teamColor(ev.team);
        el.ov.classList.add('drb-anim');
        el.card.style.setProperty('--team', col);
        el.team.style.setProperty('--team', col);
        el.name.textContent = ev.name;
        el.card.style.display = 'flex'; el.card.classList.remove('out', 'in'); void el.card.offsetWidth; el.card.classList.add('in');
        fit(el.name, D.nameFont);
        const tn = teamName(ev.team);
        el.team.textContent = /^(تیم|گروه)[\s\u200c]/.test(tn) ? tn : L('تیم') + ' ' + tn;
        el.team.classList.add('show');
        if (!fast) burst(col);
        await sleep(fast ? 450 : Math.min(8000, Math.max(1000, parseInt(D.draw.holdMs, 10) || 2600)));
        if (gen !== D.gen) return;
        let slot = D.slotEls[ev.team + '-' + ev.s];
        if (slot && D.compact) {
            const r = slot.getBoundingClientRect();
            if (r.top < 0 || r.bottom > window.innerHeight) { slot.scrollIntoView({ block: 'center', behavior: fast ? 'auto' : 'smooth' }); await sleep(fast ? 60 : 550); }
            if (gen !== D.gen) return;
            slot = D.slotEls[ev.team + '-' + ev.s];
        }
        if (slot && slot.isConnected) {
            const from = el.name.getBoundingClientRect(), to = slot.getBoundingClientRect();
            const fs0 = getComputedStyle(el.name).fontSize;
            const fly = h('div', 'drb-fly', ev.name);
            fly.setAttribute('translate', 'no');
            fly.style.cssText = `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;font-size:${fs0};--team:${col}`;
            document.body.append(fly);
            el.card.classList.remove('in'); el.card.classList.add('out'); el.team.classList.remove('show');
            const dur = fast ? 450 : 950;
            const toFont = Math.min(D.lay.font, to.height * 0.7);
            if (fly.animate) {
                const a = fly.animate([
                    { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px', fontSize: fs0 },
                    { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px', fontSize: toFont + 'px' }
                ], { duration: dur, easing: 'cubic-bezier(.55,0,.15,1)', fill: 'forwards' });
                await a.finished.catch(() => {});
            } else await sleep(dur);
            fly.remove();
            if (gen !== D.gen) return;
            D.hidden.delete(ev.pid); fillSlots();
            const live = D.slotEls[ev.team + '-' + ev.s];
            if (live) { live.classList.remove('pop'); void live.offsetWidth; live.classList.add('pop'); setTimeout(() => live.classList.remove('pop'), 900); }
            el.card.style.display = 'none';
        } else {
            D.hidden.delete(ev.pid); fillSlots();
            el.card.classList.remove('in'); el.card.classList.add('out'); el.team.classList.remove('show');
            await sleep(250); el.card.style.display = 'none';
        }
        if (!D.queue.length) el.ov.classList.remove('drb-anim');
    }

    function update(state) {
        const d = state && state.draw;
        if (!d || !d.live || !Array.isArray(state.teams)) { hide(); return; }
        D.state = state;
        D.draw = d;
        // Teams in the camp's order (a copy: the board sorts its own array by score).
        D.teams = state.teams.map(t => ({ id: t.id, name: String(t.name || ''), color: color(t.color) }));
        const ids = new Set(D.teams.map(t => t.id));
        if (!D.on) show();
        const placed = (Array.isArray(d.placed) ? d.placed : []).filter(x => ids.has(x.team));
        D.placed = placed;
        const maxO = placed.reduce((a, x) => Math.max(a, x.o || 0), 0);
        if (D.lastO !== null) {
            placed.filter(x => (x.o || 0) > D.lastO).sort((a, b) => a.o - b.o)
                .forEach(x => { D.queue.push(Object.assign({}, x)); D.hidden.add(x.pid); });
        }
        // Removed (or moved) while still waiting: forget them; renamed: take the new name.
        const byPid = new Map(placed.map(x => [x.pid, x]));
        D.queue = D.queue.filter(ev => {
            const x = byPid.get(ev.pid);
            if (!x || x.o !== ev.o) { D.hidden.delete(ev.pid); return false; }
            ev.name = x.name; ev.team = x.team; ev.s = x.s;
            return true;
        });
        D.hidden.forEach(pid => { if (!D.queue.some(ev => ev.pid === pid) && !(D.cur && D.cur.pid === pid)) D.hidden.delete(pid); });
        D.lastO = maxO;
        rebuild();
        renderCenter();
        fillSlots();
        pump();
        // board.html sets the page direction right after this call: follow it (no-op when unchanged)
        setTimeout(() => { if (D.on) { rebuild(); fillSlots(); } }, 0);
    }

    window.DRAWBOARD = { update, hide, computeLayout, get debug() { return D; } };
})();
