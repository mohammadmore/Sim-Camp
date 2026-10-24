// Shared front-end helpers for the optional features: labels, switches UI, timer, skills,
// badges, charts and the English strings of the public pages.
(function () {
    const F = {};

    // ---- Labels (Persian) -------------------------------------------------------------------
    F.DISPLAY = {
        board: {
            title: 'تابلوی زنده',
            items: {
                splash: 'انیمیشن امتیاز (نمایش بزرگ هر امتیاز)', confetti: 'کاغذرنگی', moodImages: 'عکس شاد و ناراحت تیم', sound: 'صدا',
                ranks: 'رتبه، مدال و جام', trendChart: 'نمودار روند امتیاز', badges: 'نشان‌ها (مثل «آتش‌به‌اختیار»)', ticker: 'نوار خبری',
                timer: 'تایمر مرحله', schedule: 'برنامه زمانی مراحل', individual: 'بهترین بازیکن هر تیم', roles: 'کاپیتان و پست‌ها',
                budget: 'بودجه تیم‌ها', varBanner: 'اعلان بررسی اعتراض (VAR)', chanceCards: 'کارت شانس', decisions: 'نتیجه دورهای تصمیم‌گیری',
                brand: 'لوگو و رنگ سازمان مشتری', divisions: 'گروه هر تیم', bracket: 'جدول حذفی'
            }
        },
        judge: { title: 'صفحه داور', items: { judgeTimer: 'تایمر مرحله', judgeRemaining: 'یادآور «تیم‌های مانده»', judgeMessages: 'پیام اپراتور به داورها', notes: 'یادداشت و عکس با لمس طولانی' } },
        team: { title: 'صفحه تیم', items: { teamPage: 'صفحه اختصاصی هر تیم', teamHistory: 'تاریخچه امتیازها', teamSkills: 'نمودار مهارت‌ها' } }
    };
    F.FEATURES = {
        assignments: ['تقسیم داورها بین تیم‌ها و مراحل', 'هر داور فقط تیم‌ها و مراحل خودش را می‌بیند.'],
        rubric: ['داوری چندمعیاره', 'نمره مرحله از چند معیار وزن‌دار ساخته می‌شود.'],
        individual: ['امتیاز فردی بازیکن‌ها', 'داور می‌تواند امتیاز را به یک بازیکن هم نسبت دهد (اختیاری).'],
        scoreCap: ['سقف امتیاز داور در ساعت', 'از امتیازدهی بیش از حد جلوگیری می‌کند.'],
        appeals: ['اعتراض و بازبینی (VAR)', 'داورها اعتراض ثبت می‌کنند و اپراتور/سرداور رسیدگی می‌کند.'],
        divisions: ['گروه‌ها و رده‌ها', 'رتبه‌بندی جدا برای هر گروه.'],
        bracket: ['جدول حذفی', 'بازی‌های رودررو و صعود برنده.'],
        roles: ['کاپیتان و پست‌های تیمی', 'نقش هر بازیکن در تیم.'],
        budget: ['بودجه و بازار تیم‌ها', 'پول مجازی جدا از امتیاز؛ خرید، جریمه و انتقال.'],
        decisions: ['دورهای تصمیم‌گیری (انتخاب تاکتیک)', 'تیم‌ها در صفحه تیم گزینه انتخاب می‌کنند.'],
        secretCards: ['کارت‌های محرمانه', 'هر تیم در صفحه خودش اطلاعات اختصاصی می‌بیند.'],
        peerReview: ['رأی هم‌تیمی‌ها و خودارزیابی', 'بازیکن‌ها در صفحه تیم به هم امتیاز می‌دهند.'],
        chanceCards: ['کارت شانس', 'رویداد غافلگیرانه روی تابلو، با امتیاز یا بودجه.'],
        calibration: ['کارگاه هماهنگی داورها', 'داورها قبل از مسابقه به نمونه‌ها نمره می‌دهند.'],
        registration: ['ثبت‌نام آنلاین تیم‌ها', 'فرم عمومی ثبت‌نام؛ تیم پس از تأیید اضافه می‌شود.']
    };

    F.display = state => Object.assign({}, (state && state.display) || {});
    F.shown = (state, key) => !state || !state.display || state.display[key] !== false;
    F.on = (state, key) => !!(state && state.features && state.features[key]);

    // ---- Switches UI (operator advanced settings, superadmin form) ----------------------------
    F.renderSwitches = function (el, display, features, opts) {
        opts = opts || {};
        const d = display || {}, f = features || {};
        const box = (name, key, label, checked, hint) => `
            <label class="sw-row" title="${esc(hint || '')}">
                <input type="checkbox" data-${name}="${key}" ${checked ? 'checked' : ''}>
                <span class="sw-track"><span class="sw-knob"></span></span>
                <span class="sw-label">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span>
            </label>`;
        let html = '';
        if (!opts.hideFeatures) {
            html += `<div class="sw-group"><h4>امکانات اختیاری <small>(به‌طور پیش‌فرض خاموش؛ با روشن کردن، فقط همان بخش اضافه می‌شود)</small></h4><div class="sw-grid">` +
                Object.entries(F.FEATURES).map(([k, [label, hint]]) => box('feature', k, label, f[k] === true, hint)).join('') + '</div></div>';
        }
        html += Object.values(F.DISPLAY).map(g => `<div class="sw-group"><h4>${esc(g.title)} <small>(نمایش؛ به‌طور پیش‌فرض روشن)</small></h4><div class="sw-grid">` +
            Object.entries(g.items).map(([k, label]) => box('display', k, label, d[k] !== false)).join('') + '</div></div>').join('');
        el.innerHTML = html;
    };
    F.readSwitches = function (el) {
        const display = {}, features = {};
        el.querySelectorAll('[data-display]').forEach(i => { display[i.dataset.display] = i.checked; });
        el.querySelectorAll('[data-feature]').forEach(i => { features[i.dataset.feature] = i.checked; });
        return { display, features };
    };

    // ---- Server clock (timers must not depend on the device clock) ---------------------------
    let clockOffset = 0;
    F.syncClock = function () {
        const url = window.SIMCAMP_TIME_URL || '/api/time';
        const t0 = Date.now();
        return fetch(url, { cache: 'no-store' }).then(r => r.json()).then(d => {
            if (d && d.now) clockOffset = d.now - Math.round((t0 + Date.now()) / 2);
        }).catch(() => {});
    };
    F.now = () => Date.now() + clockOffset;
    F.timerRemaining = function (timer) {
        if (!timer) return null;
        return timer.running ? Math.max(0, timer.endsAt - F.now()) : Math.max(0, timer.remainingMs || 0);
    };
    F.fmtClock = function (ms, lang) {
        const s = Math.ceil(ms / 1000);
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        const txt = (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
        return (lang || 'fa') === 'fa' ? txt.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]) : txt;
    };

    // ---- Scores, skills, players, badges ---------------------------------------------------------
    const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
    F.instantLogs = team => (team.scoreLogs || []).filter(l => l && l.type === 'instant');

    // Points per skill from the tags of instant scores (tag → skills mapping of the camp).
    F.skillPoints = function (team, state) {
        const map = (state && state.tagSkills) || {};
        const out = {};
        (state.skills || []).forEach(s => { out[s.id] = 0; });
        F.instantLogs(team).forEach(l => {
            (map[l.tag] || []).forEach(sk => { if (sk in out) out[sk] += num(l.value); });
        });
        return out;
    };
    // 0..100 per skill, relative to the best team of the camp (so the chart shows strengths, not raw sizes).
    F.skillProfile = function (team, state) {
        const all = (state.teams || []).map(t => F.skillPoints(t, state));
        const mine = F.skillPoints(team, state);
        const out = {};
        (state.skills || []).forEach(s => {
            const vals = all.map(x => x[s.id]);
            const max = Math.max(...vals, 0), min = Math.min(...vals, 0);
            out[s.id] = max === min ? 50 : Math.round(((mine[s.id] - min) / (max - min)) * 100);
        });
        return out;
    };

    // Player points (instant scores given to a player) → best player.
    F.memberPoints = function (team) {
        const pts = {};
        (team.members || []).forEach(m => { pts[m.id] = 0; });
        F.instantLogs(team).forEach(l => { if (l.memberId && l.memberId in pts) pts[l.memberId] += num(l.value); });
        return pts;
    };
    F.mvp = function (team) {
        const pts = F.memberPoints(team);
        let best = null;
        (team.members || []).forEach(m => { if (pts[m.id] > 0 && (!best || pts[m.id] > pts[best.id])) best = m; });
        return best ? { member: best, points: pts[best.id] } : null;
    };
    F.captain = team => (team.members || []).find(m => /کاپیتان|captain/i.test(m.role || '')) || null;

    // Small fun badges computed from the scores (no setup needed).
    F.badges = function (state) {
        const teams = state.teams || [];
        const out = {};
        teams.forEach(t => { out[t.id] = []; });
        const now = F.now();
        const recent = t => F.instantLogs(t).filter(l => now - (l.createdAt || l.timestamp || 0) < 10 * 60000).reduce((s, l) => s + num(l.value), 0);
        const best = (fn, min) => {
            let top = null, v = min;
            teams.forEach(t => { const x = fn(t); if (x > v) { v = x; top = t; } });
            return top;
        };
        const hot = best(recent, 0);
        if (hot) out[hot.id].push({ icon: '🔥', label: 'داغ‌ترین تیم ۱۰ دقیقه اخیر' });
        const positives = t => F.instantLogs(t).filter(l => num(l.value) > 0).length;
        const fair = best(t => F.instantLogs(t).filter(l => num(l.value) > 0 && l.tag).length, 2);
        if (fair) out[fair.id].push({ icon: '🤝', label: 'بیشترین برچسب مثبت' });
        const clean = teams.filter(t => positives(t) >= 3 && !F.instantLogs(t).some(l => num(l.value) < 0));
        clean.forEach(t => out[t.id].push({ icon: '🛡️', label: 'بدون امتیاز منفی' }));
        Object.entries(state.closedStages || {}).forEach(([sid, closed]) => {
            if (!closed) return;
            const res = ((state.stageTieredResults || {})[sid] || {}).results || [];
            const first = res.find(r => r.rank === 1);
            const stage = (state.stages || []).find(s => s.id === sid);
            if (first && out[first.teamId]) out[first.teamId].push({ icon: '🏅', label: `قهرمان مرحله ${stage ? stage.name : ''}` });
        });
        return out;
    };

    // Cumulative score over time for the trend chart (instant scores + stage values when recorded).
    F.trendSeries = function (state) {
        return (state.teams || []).map(t => {
            const events = [];
            F.instantLogs(t).forEach(l => events.push([l.createdAt || l.timestamp || 0, num(l.value)]));
            const stageVals = t.stageScores || {};
            Object.keys(stageVals).forEach(sid => {
                const entries = Object.values((t.judgeStageScores || {})[sid] || {});
                const at = entries.reduce((m, e) => Math.max(m, (e && e.timestamp) || 0), 0)
                    || (((state.stageTieredResults || {})[sid] || {}).closedAt) || 0;
                events.push([at, num(stageVals[sid])]);
            });
            events.sort((a, b) => a[0] - b[0]);
            let sum = 0;
            const pts = events.filter(e => e[0]).map(([x, v]) => { sum += v; return [x, Math.round(sum * 100) / 100]; });
            return { id: t.id, name: t.name, color: t.color || '#3b82f6', points: pts };
        });
    };

    // ---- SVG charts ------------------------------------------------------------------------------
    // Chart width that matches the screen when the caller gives none (text then stays readable on phones).
    F.chartWidth = () => Math.round(Math.max(340, Math.min(900, ((window.innerWidth || 900) - 48))));
    // Round tick steps (1, 2, 5 × 10^k) for about `count` ticks between lo and hi.
    const niceTicks = function (lo, hi, count) {
        const span = Math.max(1e-9, hi - lo), raw = span / Math.max(1, count);
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
        const out = [];
        const top = Math.ceil(hi / step - 1e-9) * step;
        for (let v = Math.floor(lo / step + 1e-9) * step; v <= top + step * 1e-6; v += step) out.push(Math.round(v * 1e6) / 1e6);
        return out;
    };
    const pageDir = () => (document.documentElement.getAttribute('dir') === 'ltr' ? 'ltr' : 'rtl');
    // Cuts a name to about `px` wide (Persian glyphs ≈ 0.56 em); the full name stays in the tooltip.
    const fitText = (s, px, font) => {
        const max = Math.max(3, Math.floor(px / (font * 0.56)));
        s = String(s || '');
        return s.length > max ? s.slice(0, max - 1).trim() + '…' : s;
    };
    const clockText = (ts, lang, withDay) => {
        const d = new Date(ts);
        const t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        return fmtNum(withDay ? (d.getMonth() + 1) + '/' + d.getDate() + ' ' + t : t, lang).replace('٫', '.');
    };

    // Cumulative score over time: one stepped line per team, from its first event to the latest event
    // of the camp (the score holds between events). Team names sit in a column beside the line ends.
    F.lineChart = function (series, opts) {
        opts = opts || {};
        // A width wider than the screen would shrink every label; draw at screen width instead.
        const fit = F.chartWidth(), shrink = opts.width && opts.width > fit && opts.width > (window.innerWidth || 1e9) - 48;
        const W = shrink ? fit : (opts.width || fit);
        const H = opts.height && !shrink ? opts.height : Math.round(Math.max(240, Math.min(420, W * (opts.height && opts.width ? opts.height / opts.width : 0.5))));
        const font = opts.font || Math.round(Math.max(12, Math.min(16, W / 62)));
        const lang = opts.lang;
        const list = series.filter(s => s.points.length);
        if (!list.length) return `<div class="chart-empty">${esc(opts.empty || 'هنوز داده‌ای برای نمودار نیست.')}</div>`;
        const all = list.flatMap(s => s.points);
        const xs = all.map(p => p[0]), ys = all.map(p => p[1]).concat([0]);
        let x0 = Math.min(...xs), x1 = Math.max(...xs);
        if (x1 - x0 < 60000) { x0 -= 30000; x1 += 30000; }
        const ticksY = niceTicks(Math.min(...ys), Math.max(...ys, 1), 5);
        const y0 = ticksY[0], y1 = ticksY[ticksY.length - 1];
        const rtl = (opts.dir || pageDir()) === 'rtl';
        const showLabels = opts.labels !== false;
        // Plot area: numbers on the left, team names on the right, clock times below.
        const yLabW = Math.max(...ticksY.map(v => fmtNum(v, lang).length)) * font * 0.62 + 12;
        const gut = showLabels ? Math.round(Math.min(W * 0.3, font * 14)) : 12;
        const L = Math.round(yLabW), R = W - gut, T = Math.round(font * 0.9), B = H - Math.round(font * 2.2);
        const sx = x => L + ((x - x0) / Math.max(1, x1 - x0)) * (R - L);
        const sy = y => B - ((y - y0) / Math.max(1e-9, y1 - y0)) * (B - T);
        const f = n => n.toFixed(1);
        const axisStyle = `style="font-size:${font - 1}px" fill="currentColor" fill-opacity="0.75"`;
        let svg = ticksY.map(v => `<line x1="${L}" x2="${R}" y1="${f(sy(v))}" y2="${f(sy(v))}" class="chart-grid" stroke="currentColor" stroke-opacity="${v === 0 ? 0.35 : 0.12}"/>` +
            `<text x="${L - 8}" y="${f(sy(v) + font * 0.35)}" text-anchor="end" direction="ltr" class="chart-axis" ${axisStyle}>${esc(fmtNum(v, lang))}</text>`).join('');
        // Time axis: round clock steps, at most about one label per 90px.
        const withDay = x1 - x0 > 20 * 3600000;
        const want = Math.max(2, Math.floor((R - L) / (withDay ? 110 : 64)));
        const stepMin = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080].find(m => (x1 - x0) / (m * 60000) <= want) || 10080;
        const step = stepMin * 60000, tz = new Date(x0).getTimezoneOffset() * 60000;
        for (let t = Math.ceil((x0 - tz) / step) * step + tz; t <= x1; t += step) {
            svg += `<line x1="${f(sx(t))}" x2="${f(sx(t))}" y1="${B}" y2="${B + 5}" stroke="currentColor" stroke-opacity="0.35"/>` +
                `<text x="${f(sx(t))}" y="${B + font + 6}" text-anchor="middle" direction="ltr" class="chart-axis" ${axisStyle}>${esc(clockText(t, lang, withDay))}</text>`;
        }
        // Lines: start at the team's first event (from zero), hold the score until the next event.
        const ends = [];
        svg += list.map(s => {
            const c = safeColor(s.color, '#3b82f6');
            let d = `M${f(sx(s.points[0][0]))} ${f(sy(0))}`;
            s.points.forEach(p => { d += ` H${f(sx(p[0]))} V${f(sy(p[1]))}`; });
            const last = s.points[s.points.length - 1];
            d += ` H${f(sx(x1))}`;
            ends.push({ s, c, y: sy(last[1]), v: last[1] });
            return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${Math.max(2.5, font / 5)}" stroke-linejoin="round" stroke-linecap="round"><title>${esc(s.name)}: ${esc(fmtNum(last[1], lang))}</title></path>` +
                `<circle cx="${f(sx(x1))}" cy="${f(sy(last[1]))}" r="${Math.max(3.5, font / 3.5)}" fill="${c}"/>`;
        }).join('');
        // Names beside the line ends, pushed apart so they never overlap.
        if (showLabels) {
            const gap = font * 1.25;
            ends.sort((a, b) => a.y - b.y);
            ends.forEach((e, i) => { e.ly = Math.max(e.y, i ? ends[i - 1].ly + gap : T + font * 0.4); });
            const over = ends.length ? ends[ends.length - 1].ly - (H - font * 0.5) : 0;
            if (over > 0) {
                ends[ends.length - 1].ly -= over;
                for (let i = ends.length - 2; i >= 0; i--) ends[i].ly = Math.min(ends[i].ly, ends[i + 1].ly - gap);
            }
            const lx = R + 14, tx = rtl ? W - 2 : lx + 4;
            svg += ends.map(e => {
                const name = fitText(e.s.name, gut - 22, font);
                const lead = Math.abs(e.ly - e.y) > 1 ? `<path d="M${f(R + 4)} ${f(e.y)} L${lx} ${f(e.ly)}" stroke="${e.c}" stroke-opacity="0.6" fill="none"/>` : '';
                return `${lead}<text x="${tx}" y="${f(e.ly + font * 0.35)}" text-anchor="start" direction="${rtl ? 'rtl' : 'ltr'}" class="chart-label" style="font-size:${font}px" fill="${e.c}" ` +
                    `stroke="#fff" stroke-opacity="0.75" stroke-width="3" paint-order="stroke" font-weight="800"><title>${esc(e.s.name)}</title>${esc(name)}</text>`;
            }).join('');
        }
        return `<svg viewBox="0 0 ${W} ${H}" class="line-chart" role="img" aria-label="${esc(opts.title || 'نمودار روند امتیاز')}">${svg}</svg>`;
    };

    // Skill radar (0..100 per label). Long labels wrap on two lines; the drawing leaves room for them.
    F.radarChart = function (labels, values, color, opts) {
        opts = opts || {};
        const S = opts.size || 260, C = S / 2, R = S / 2 - 40, n = labels.length;
        const font = opts.font || 13, padX = Math.round(font * 3.4);
        if (n < 3) return '';
        const pt = (i, r) => [C + r * Math.sin((2 * Math.PI * i) / n), C - r * Math.cos((2 * Math.PI * i) / n)];
        const rings = [0.25, 0.5, 0.75, 1].map(f => `<polygon points="${labels.map((_, i) => pt(i, R * f).join(',')).join(' ')}" class="radar-ring" fill="none" stroke="currentColor" stroke-opacity="0.18"/>`).join('');
        const wrap = s => {
            const words = String(s || '').split(/\s+/).filter(Boolean), lines = [''];
            words.forEach(w => { const cur = lines[lines.length - 1]; if (cur && (cur + ' ' + w).length > 12 && lines.length < 2) lines.push(w); else lines[lines.length - 1] = cur ? cur + ' ' + w : w; });
            return lines.map(l => fitText(l, padX * 2 + 30, font));
        };
        const axes = labels.map((l, i) => {
            const [x, y] = pt(i, R), [lx, ly] = pt(i, R + font * 1.3);
            const lines = wrap(l), y0 = ly - ((lines.length - 1) * font * 1.15) / 2;
            return `<line x1="${C}" y1="${C}" x2="${x}" y2="${y}" class="radar-axis" stroke="currentColor" stroke-opacity="0.18"/>` +
                `<text text-anchor="middle" class="radar-label" style="font-size:${font}px" fill="currentColor" font-weight="700"><title>${esc(l)}</title>${lines.map((t, k) =>
                    `<tspan x="${lx.toFixed(1)}" y="${(y0 + k * font * 1.15 + font * 0.35).toFixed(1)}">${esc(t)}</tspan>`).join('')}</text>`;
        }).join('');
        const shape = values.map((v, i) => pt(i, (R * Math.max(0, Math.min(100, v))) / 100).join(',')).join(' ');
        const c = safeColor(color, '#3b82f6');
        return `<svg viewBox="${-padX} -6 ${S + 2 * padX} ${S + 12}" class="radar-chart" role="img" aria-label="${esc(opts.title || 'نمودار مهارت‌ها')}">${rings}${axes}<polygon points="${shape}" fill="${c}" fill-opacity="0.3" stroke="${c}" stroke-width="2.5"/></svg>`;
    };

    // ---- Ranking helpers ---------------------------------------------------------------------------
    F.rankMap = function (teams) {
        const sorted = [...teams].sort((a, b) => b.score - a.score);
        const r = {};
        sorted.forEach((t, i) => { r[t.id] = i > 0 && t.score === sorted[i - 1].score ? r[sorted[i - 1].id] : i + 1; });
        return r;
    };
    F.divisionRanks = function (state) {
        const out = {};
        (state.divisions || []).forEach(d => {
            const r = F.rankMap((state.teams || []).filter(t => t.division === d.id));
            Object.assign(out, r);
        });
        return out;
    };

    // ---- Interface language: the page's language comes from i18n.js (lang/en.js, lang/ar.js) ------
    F.t = s => (window.I18N ? window.I18N.t(s) : s);

    window.Feat = F;
})();
