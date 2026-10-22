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
            if (first && out[first.teamId]) out[first.teamId].push({ icon: '🏅', label: 'قهرمان مرحله ' + (stage ? stage.name : '') });
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
    F.lineChart = function (series, opts) {
        opts = opts || {};
        const W = opts.width || 800, H = opts.height || 320, P = 36;
        const all = series.flatMap(s => s.points);
        if (!all.length) return `<div class="chart-empty">${esc(opts.empty || 'هنوز داده‌ای برای نمودار نیست.')}</div>`;
        const xs = all.map(p => p[0]), ys = all.map(p => p[1]).concat([0]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) || 1;
        const sx = x => P + ((x - x0) / Math.max(1, x1 - x0)) * (W - 2 * P);
        const sy = y => H - P - ((y - y0) / Math.max(1e-9, y1 - y0)) * (H - 2 * P);
        const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
            const y = y0 + f * (y1 - y0);
            return `<line x1="${P}" x2="${W - P}" y1="${sy(y)}" y2="${sy(y)}" class="chart-grid"/><text x="${P - 6}" y="${sy(y) + 4}" class="chart-axis" text-anchor="end">${fmtNum(Math.round(y), opts.lang)}</text>`;
        }).join('');
        const lines = series.filter(s => s.points.length).map(s => {
            const pts = [[x0, 0], ...s.points];
            const d = pts.map((p, i) => (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1)).join(' ');
            const last = pts[pts.length - 1];
            return `<path d="${d}" fill="none" stroke="${safeColor(s.color, '#3b82f6')}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>` +
                (opts.labels === false ? '' : `<text x="${Math.min(W - 4, sx(last[0]) + 4)}" y="${sy(last[1]) - 6}" class="chart-label" fill="${safeColor(s.color, '#3b82f6')}">${esc(s.name)}</text>`);
        }).join('');
        return `<svg viewBox="0 0 ${W} ${H}" class="line-chart" role="img" aria-label="${esc(opts.title || 'نمودار روند امتیاز')}">${grid}${lines}</svg>`;
    };

    F.radarChart = function (labels, values, color, opts) {
        opts = opts || {};
        const S = opts.size || 260, C = S / 2, R = S / 2 - 46, n = labels.length;
        if (n < 3) return '';
        const pt = (i, r) => [C + r * Math.sin((2 * Math.PI * i) / n), C - r * Math.cos((2 * Math.PI * i) / n)];
        const rings = [0.25, 0.5, 0.75, 1].map(f => `<polygon points="${labels.map((_, i) => pt(i, R * f).join(',')).join(' ')}" class="radar-ring"/>`).join('');
        const axes = labels.map((l, i) => {
            const [x, y] = pt(i, R), [lx, ly] = pt(i, R + 22);
            return `<line x1="${C}" y1="${C}" x2="${x}" y2="${y}" class="radar-axis"/><text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" class="radar-label">${esc(l)}</text>`;
        }).join('');
        const shape = values.map((v, i) => pt(i, (R * Math.max(0, Math.min(100, v))) / 100).join(',')).join(' ');
        const c = safeColor(color, '#3b82f6');
        return `<svg viewBox="0 0 ${S} ${S}" class="radar-chart" role="img" aria-label="${esc(opts.title || 'نمودار مهارت‌ها')}">${rings}${axes}<polygon points="${shape}" fill="${c}" fill-opacity="0.3" stroke="${c}" stroke-width="2.5"/></svg>`;
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

    // ---- English strings for the public pages (uiLang = 'en') ---------------------------------------
    const EN = {
        'مرحله در حال اجرا': 'Now playing', 'نتایج نهایی': 'Final results', 'امتیاز': 'points', 'تیم': 'Team', 'رتبه': 'Rank',
        'بودجه': 'Budget', 'بهترین بازیکن': 'Best player', 'کاپیتان': 'Captain', 'جدول مخفی است': 'Standings are hidden',
        'بررسی اعتراض': 'VAR check', 'کارت شانس': 'Chance card', 'مرحله بعد': 'Next', 'نمودار روند امتیاز': 'Score trend',
        'جدول حذفی': 'Knockout', 'تصمیم تیم‌ها': 'Team decisions', 'مراسم اهدای جوایز': 'Award ceremony', 'برنده': 'Winner',
        'تاریخچه امتیازها': 'Score history', 'مهارت‌ها': 'Skills', 'اعضای تیم': 'Members', 'نشان‌ها': 'Badges', 'کد تیم': 'Team code',
        'ورود': 'Enter', 'ارسال': 'Submit', 'گروه': 'Group', 'مسابقه‌ای با این لینک پیدا نشد.': 'No competition found for this link.',
        'ثبت‌نام تیم': 'Team registration', 'نام تیم': 'Team name', 'اعضا (هر نفر در یک خط)': 'Members (one per line)',
        'راه ارتباطی (اختیاری)': 'Contact (optional)', 'لیگ': 'League', 'مجموع': 'Total', 'بازی': 'Played'
    };
    F.t = (s, lang) => (lang === 'en' && EN[s]) || s;

    window.Feat = F;
})();
