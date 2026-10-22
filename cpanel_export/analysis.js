// Analysis room ("اتاق آنالیز و کارنامه‌ها"): post-game review, FIFA-style report cards,
// competition stats, referee agreement / calibration, Excel export and comparison of two editions.
// Data: GET /api/analysis (managers, superadmin / organizer, or the client report key).
(function () {
    'use strict';

    // ---- Access ----------------------------------------------------------------------------------
    const params = new URLSearchParams(location.search);
    const campId = (params.get('id') || '').trim();
    const clientKey = (params.get('key') || '').trim();
    (function takeHashToken() {
        const h = new URLSearchParams(location.hash.replace(/^#/, ''));
        const t = h.get('t');
        if (t) {
            Auth.set(t);
            history.replaceState(null, '', location.pathname + location.search);
        }
    })();

    function loadAnalysis(id, key) {
        return fetch('/api/analysis?id=' + encodeURIComponent(id) + (key ? '&key=' + encodeURIComponent(key) : ''), { cache: 'no-store' })
            .then(jsonOrThrow);
    }

    // ---- Small helpers -----------------------------------------------------------------------------
    const $ = sel => document.querySelector(sel);
    const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
    const isNum = v => v !== '' && v !== null && v !== undefined && v !== '-' && isFinite(parseFloat(v));
    const r2 = n => Math.round(n * 100) / 100;
    const sum = arr => arr.reduce((s, x) => s + x, 0);
    const mean = arr => (arr.length ? sum(arr) / arr.length : 0);
    const OVERRIDE = '__override__';
    const ROLE = { operator: 'اپراتور', head_referee: 'سرداور', referee: 'داور' };
    const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
    const TYPES = {
        score: ['امتیاز لحظه‌ای', '⚡'], stage: ['نمره مرحله', '📝'], close: ['سوت پایان مرحله', '🏁'], moment: ['لحظه طلایی', '⭐'],
        chance: ['کارت شانس', '🎴'], appeal: ['اعتراض (VAR)', '⚖️'], decision: ['تصمیم تیم', '🗳'], admin: ['اتاق فرمان', '🛠']
    };
    const AUDIT = {
        stage_reopen: 'بازگشایی مرحله', freeze: 'جدول مخفی شد', unfreeze: 'جدول دوباره نمایش داده شد', team_logs: 'اصلاح تاریخچه امتیاز تیم',
        stage_scores: 'اصلاح دستی نمره مرحله', judge_score_delete: 'حذف نمره داور', budget: 'تغییر بودجه', finish: 'سوت پایان مسابقه',
        undo: 'برگرداندن یک تغییر', stage_reset: 'بازنشانی مرحله', scores_reset: 'بازنشانی همه امتیازها', board: 'تابلو',
        bracket: 'جدول حذفی', ceremony: 'مراسم اهدای جوایز', peer: 'رأی هم‌تیمی‌ها', round: 'دور تصمیم‌گیری', register_approve: 'تیم تازه پذیرفته شد'
    };
    const ROUND_OP = { open: 'باز شد', close: 'بسته شد و اثرش اعمال شد', reveal: 'نتیجه روی تابلو رفت', hide: 'نتیجه از تابلو برداشته شد', reset: 'از نو' };

    let camp = null, access = '', D = null;
    const N = n => fmtNum(typeof n === 'number' ? r2(n) : n, camp ? camp.numLang : 'fa');
    // Signed number, isolated left-to-right so the sign stays in front inside RTL text.
    const sN = n => '\u2066' + (n > 0 ? '+' : n < 0 ? '−' : '') + N(Math.abs(n)) + '\u2069';
    const on = k => !!(camp.features && camp.features[k] === true);
    const shown = k => !camp.display || camp.display[k] !== false;
    const locale = () => (camp && camp.numLang === 'en' ? 'en-GB' : 'fa-IR');
    function fmtTime(ts) {
        if (!ts) return '—';
        const d = new Date(ts);
        const opt = { hour: '2-digit', minute: '2-digit' };
        if (D && D.multiDay) Object.assign(opt, { month: 'short', day: 'numeric' });
        try { return d.toLocaleString(locale(), opt); } catch (e) { return d.toLocaleTimeString(); }
    }
    const fullTime = ts => (ts ? new Date(ts).toLocaleString(locale()) : '');
    const teamDot = t => `<span class="dot" style="--tc:${esc(safeColor(t && t.color, '#94a3b8'))}"></span>`;
    const teamName = id => { const t = D.teamById.get(id); return t ? t.name : ''; };
    const stageName = id => (id === 'general' ? 'کل مسابقه' : ((D.stageById.get(id) || {}).name || ''));
    const valHtml = v => `<span class="val ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${esc(sN(v))}</span>`;
    const empty = text => `<div class="an-empty">${esc(text)}</div>`;
    const box = (title, hint, body, extra) => `<div class="an-box glass" ${extra || ''}><h2>${title}</h2>${hint ? `<p class="an-hint">${hint}</p>` : ''}${body}</div>`;
    const refName = u => {
        if (!u) return 'سیستم';
        const known = D && D.users.get(u.username);
        if (known && known.name) return known.name;
        return `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username || 'داور';
    };
    const fmtStageVal = (stage, v) => {
        if (v === '-' || v === 'dnf') return 'DNF';
        if (!isNum(v)) return '—';
        return stage && stage.unit === 'time' && typeof formatSeconds === 'function' ? fmtNum(formatSeconds(num(v)), camp.numLang) : N(num(v));
    };

    // ---- Derived data ------------------------------------------------------------------------------
    function derive(c) {
        const d = {};
        d.teams = c.teams || [];
        d.stages = c.stages || [];
        d.skills = c.skills || [];
        d.teamById = new Map(d.teams.map(t => [t.id, t]));
        d.stageById = new Map(d.stages.map(s => [s.id, s]));
        d.users = new Map((c.users || []).map(u => [u.username, u]));
        d.members = new Map();
        d.teams.forEach(t => (t.members || []).forEach(m => d.members.set(m.id, { m, team: t })));
        d.rank = Feat.rankMap(d.teams);
        d.pos = new Set(c.positiveTags || []);
        d.neg = new Set(c.negativeTags || []);
        d.audit = (c.audit || []).slice().sort((a, b) => a.ts - b.ts);

        // Which stage was "now playing" at a moment (instant scores carry no stage).
        d.windows = [];
        const byName = new Map(d.stages.map(s => [s.name, s.id]));
        d.audit.forEach(e => {
            if (e.action === 'board' && e.details && 'activeStage' in e.details) d.windows.push({ at: e.ts, stageId: e.details.activeStage ? byName.get(e.details.activeStage) || null : null });
        });
        d.stageAt = at => { let s = null; for (const w of d.windows) { if (w.at <= at) s = w.stageId; else break; } return s; };

        d.instants = [];
        d.teams.forEach(t => (t.scoreLogs || []).forEach(l => {
            if (l && l.type === 'instant') d.instants.push({ l, t, at: l.createdAt || l.timestamp || 0, v: num(l.value) });
        }));
        d.instants.sort((a, b) => a.at - b.at);
        d.kindOf = l => (l.chance ? 'chance' : l.round ? 'round' : d.pos.has(l.tag) ? 'pos' : d.neg.has(l.tag) ? 'neg' : num(l.value) >= 0 ? 'pos' : 'neg');
        // Referee-given instants only (chance cards and decision rounds are game events, not behaviour tags).
        d.refInstants = d.instants.filter(x => !x.l.chance && !x.l.round);

        d.judge = [];
        d.teams.forEach(t => Object.entries(t.judgeStageScores || {}).forEach(([sid, map]) => {
            Object.entries(map || {}).forEach(([key, e]) => { if (e) d.judge.push({ t, sid, key, e, at: e.timestamp || 0 }); });
        }));

        // Per team: tag counts, positive / negative, budget flow.
        d.tstat = new Map();
        d.teams.forEach(t => {
            const s = { pos: 0, neg: 0, posPts: 0, negPts: 0, tags: new Map(), spent: 0, earned: 0, notes: [] };
            d.tstat.set(t.id, s);
            (t.records || []).forEach(r => { if (r && r.kind === 'budget') { if (num(r.value) < 0) s.spent += -num(r.value); else s.earned += num(r.value); } });
        });
        d.refInstants.forEach(({ l, t, v }) => {
            const s = d.tstat.get(t.id);
            const k = d.kindOf(l);
            if (k === 'pos') { s.pos++; s.posPts += v; } else { s.neg++; s.negPts += v; }
            if (l.tag) {
                const x = s.tags.get(l.tag) || { n: 0, pts: 0, kind: k };
                x.n++; x.pts += v; s.tags.set(l.tag, x);
            }
            if (l.note && v > 0) s.notes.push(l);
        });

        // Timeline span.
        const times = d.instants.map(x => x.at).concat(d.judge.map(x => x.at), (c.moments || []).map(m => m.at)).filter(Boolean);
        d.t0 = times.length ? Math.min(...times) : 0;
        d.t1 = times.length ? Math.max(...times) : 0;
        d.multiDay = d.t0 && new Date(d.t0).toDateString() !== new Date(d.t1).toDateString();

        // Cumulative scores over time (shared with the trend chart).
        d.series = Feat.trendSeries(c);
        d.scoresAt = ts => {
            const out = {};
            d.series.forEach(s => { let v = 0; for (const p of s.points) { if (p[0] <= ts) v = p[1]; else break; } out[s.id] = v; });
            return out;
        };
        d.rankAt = ts => Feat.rankMap(d.teams.map(t => ({ id: t.id, score: d.scoresAt(ts)[t.id] })));

        d.badges = shown('badges') ? Feat.badges(c) : {};
        d.profile = new Map(d.teams.map(t => [t.id, Feat.skillProfile(t, c)]));
        d.skillPts = new Map(d.teams.map(t => [t.id, Feat.skillPoints(t, c)]));
        d.hasSkillData = d.teams.some(t => Object.values(d.skillPts.get(t.id)).some(v => v !== 0));
        return d;
    }

    // Peer review / self-assessment per member of a team.
    function memberFeedback(team) {
        const out = {};
        (team.members || []).forEach(m => { out[m.id] = { mvpVotes: 0, peer: {}, self: {}, peerAll: [], selfAll: [], raters: new Set() }; });
        (team.records || []).filter(r => r && r.kind === 'feedback').forEach(r => {
            if (r.mvp && out[r.mvp]) out[r.mvp].mvpVotes++;
            Object.entries(r.ratings || {}).forEach(([mid, map]) => {
                const o = out[mid];
                if (!o) return;
                const self = mid === r.from;
                if (!self) o.raters.add(r.from);
                Object.entries(map || {}).forEach(([sk, v]) => {
                    const bucket = self ? o.self : o.peer;
                    (bucket[sk] = bucket[sk] || []).push(num(v));
                    (self ? o.selfAll : o.peerAll).push(num(v));
                });
            });
        });
        Object.values(out).forEach(o => {
            o.peerAvg = o.peerAll.length ? mean(o.peerAll) : null;
            o.selfAvg = o.selfAll.length ? mean(o.selfAll) : null;
            o.peerBy = Object.fromEntries(Object.entries(o.peer).map(([k, a]) => [k, mean(a)]));
            o.selfBy = Object.fromEntries(Object.entries(o.self).map(([k, a]) => [k, mean(a)]));
        });
        return out;
    }

    // ---- Timeline events ---------------------------------------------------------------------------
    function buildEvents() {
        const ev = [];
        D.instants.forEach(({ l, t, at, v }) => {
            if (l.chance || l.round) return; // shown as the chance card / decision events
            const mem = l.memberId && D.members.get(l.memberId);
            ev.push({
                type: 'score', at, teamId: t.id, stageId: D.stageAt(at), value: v, tag: l.tag || '', kind: D.kindOf(l),
                text: l.note || '', photo: l.photo || '', by: refName(l.user), member: mem ? mem.m.name : ''
            });
        });
        D.judge.forEach(({ t, sid, key, e, at }) => {
            const st = D.stageById.get(sid);
            const crit = e.criteria && st && st.criteria ? st.criteria.filter(c => e.criteria[c.id] !== undefined).map(c => `${c.name}: ${N(num(e.criteria[c.id]))}`).join('، ') : '';
            ev.push({
                type: 'stage', at, teamId: t.id, stageId: sid, stageValue: fmtStageVal(st, e.score),
                text: (key === OVERRIDE ? 'اصلاح دستی' : '') + (crit ? (key === OVERRIDE ? ' — ' : '') + 'معیارها: ' + crit : ''), by: e.judgeName || key
            });
        });
        Object.entries(camp.stageTieredResults || {}).forEach(([sid, r]) => {
            if (!r || !r.closedAt) return;
            const top = (r.results || []).filter(x => typeof x.rank === 'number').slice(0, 3);
            ev.push({
                type: 'close', at: r.closedAt, stageId: sid, teamId: top[0] ? top[0].teamId : null,
                text: top.length ? top.map(x => `${MEDAL[x.rank] || N(x.rank)} ${x.teamName} (${sN(num(x.assignedScore))})`).join('   ') : 'بدون رتبه'
            });
        });
        (camp.moments || []).forEach(m => {
            ev.push({ type: m.kind === 'chance' ? 'chance' : 'moment', at: m.at, teamId: m.teamId || null, stageId: m.stageId || null, text: m.text || '', by: m.by || '' });
        });
        const APPEAL = { open: 'باز', accepted: 'پذیرفته شد ✅', rejected: 'رد شد ❌' };
        (camp.appeals || []).forEach(a => {
            ev.push({
                type: 'appeal', at: a.at, teamId: a.teamId, stageId: a.stageId || null, status: a.status,
                text: a.text + (a.resolution ? ' — رأی: ' + a.resolution : ''), by: (a.by && a.by.name) || '', statusText: APPEAL[a.status] || a.status
            });
        });
        (camp.rounds || []).forEach(r => {
            Object.entries((camp.decisions || {})[r.id] || {}).forEach(([tid, d]) => {
                const o = (r.options || []).find(x => x.id === d.optionId);
                if (!o) return;
                const eff = [o.points ? 'امتیاز ' + sN(num(o.points)) : '', on('budget') && o.budget ? 'بودجه ' + sN(num(o.budget)) : ''].filter(Boolean).join('، ');
                ev.push({ type: 'decision', at: d.at || 0, teamId: tid, text: `«${r.title}»: ${o.label}${eff ? ' (' + eff + ')' : ''}` });
            });
        });
        D.audit.forEach(e => {
            if (!AUDIT[e.action]) return;
            const d = e.details || {};
            let text = AUDIT[e.action];
            if (e.action === 'board') {
                if (!('activeStage' in d)) return;
                text = d.activeStage ? `شروع مرحله «${d.activeStage}»` : 'هیچ مرحله‌ای در حال اجرا نیست';
            }
            if (e.action === 'round') text += ` «${d.round || ''}» ${ROUND_OP[d.op] || ''}`;
            if (e.action === 'peer') text = d.open ? `رأی هم‌تیمی‌ها باز شد (${stageName(d.open) || ''})` : 'رأی هم‌تیمی‌ها بسته شد';
            const extra = [];
            if (d.stage) extra.push('مرحله «' + d.stage + '»');
            if (d.team) extra.push('تیم «' + d.team + '»');
            if (d.judge) extra.push('داور: ' + d.judge);
            if (d.amount !== undefined) extra.push('مبلغ ' + sN(num(d.amount)));
            if (d.scoreBefore !== undefined) extra.push(`امتیاز ${N(num(d.scoreBefore))} ← ${N(num(d.scoreAfter))}`);
            if (d.of) extra.push('«' + (AUDIT[d.of] || d.of) + '»');
            const team = d.team ? D.teams.find(t => t.name === d.team) : null;
            ev.push({ type: 'admin', at: e.ts, teamId: team ? team.id : null, text: text + (extra.length ? ' — ' + extra.join(' · ') : ''), by: (e.by && e.by.name) || '' });
        });
        return ev.filter(e => e.at).sort((a, b) => a.at - b.at);
    }

    // ---- Key moments & lead changes ---------------------------------------------------------------------
    function keyMoments(events) {
        const out = [];
        (camp.moments || []).filter(m => m.kind !== 'chance').forEach(m => out.push({ at: m.at, icon: '⭐', text: m.text, sub: m.teamId ? teamName(m.teamId) : (m.by ? 'ثبت: ' + m.by : '') }));
        (camp.moments || []).filter(m => m.kind === 'chance').forEach(m => out.push({ at: m.at, icon: '🎴', text: 'کارت شانس رو شد: ' + m.text, sub: m.teamId ? teamName(m.teamId) : 'همه تیم‌ها' }));
        // Lead changes (from the cumulative scores).
        const pts = [];
        D.series.forEach(s => s.points.forEach(p => pts.push(p[0])));
        const stamps = [...new Set(pts)].sort((a, b) => a - b);
        let leader = null;
        let changes = 0;
        stamps.forEach(ts => {
            const sc = D.scoresAt(ts);
            const best = D.teams.slice().sort((a, b) => sc[b.id] - sc[a.id])[0];
            if (!best || !(sc[best.id] > 0)) return;
            const tie = D.teams.filter(t => sc[t.id] === sc[best.id]).length > 1;
            if (tie || (leader && leader === best.id)) return;
            if (leader !== null) changes++;
            out.push({ at: ts, icon: leader === null ? '🚀' : '👑', text: leader === null ? `«${best.name}» اولین صدرنشین مسابقه شد` : `«${best.name}» صدر جدول را از «${teamName(leader)}» گرفت`, sub: `امتیاز ${N(sc[best.id])}`, lead: true });
            leader = best.id;
        });
        D.leadChanges = changes;
        const ri = D.refInstants;
        if (ri.length) {
            const top = ri.reduce((a, b) => (b.v > a.v ? b : a));
            if (top.v > 0) out.push({ at: top.at, icon: '💥', text: `بزرگ‌ترین امتیاز تک: ${sN(top.v)} برای «${top.t.name}»${top.l.tag ? ' — ' + top.l.tag : ''}`, sub: top.l.note || ('داور: ' + refName(top.l.user)) });
            const low = ri.reduce((a, b) => (b.v < a.v ? b : a));
            if (low.v < 0) out.push({ at: low.at, icon: '🟥', text: `سنگین‌ترین جریمه: ${sN(low.v)} برای «${low.t.name}»${low.l.tag ? ' — ' + low.l.tag : ''}`, sub: low.l.note || ('داور: ' + refName(low.l.user)) });
        }
        events.filter(e => e.type === 'close').forEach(e => out.push({ at: e.at, icon: '🏁', text: `پایان «${stageName(e.stageId)}»`, sub: e.text }));
        return out.sort((a, b) => a.at - b.at);
    }

    // ---- Debrief questions -------------------------------------------------------------------------
    function debriefQuestions() {
        const qs = [];
        const add = (q, why) => qs.push({ q, why });
        const sorted = D.teams.slice().sort((a, b) => D.rank[a.id] - D.rank[b.id]);
        const skillName = id => (D.skills.find(s => s.id === id) || {}).name || id;
        const map = camp.tagSkills || {};

        // 1. Most negative tags in one skill.
        let worst = null;
        D.teams.forEach(t => {
            const per = {};
            D.refInstants.filter(x => x.t.id === t.id && D.kindOf(x.l) === 'neg').forEach(x => (map[x.l.tag] || []).forEach(sk => { per[sk] = (per[sk] || 0) + 1; }));
            Object.entries(per).forEach(([sk, n]) => { if (!worst || n > worst.n) worst = { t, sk, n }; });
        });
        if (worst && worst.n >= 2) add(`تیم «${worst.t.name}» در مهارت «${skillName(worst.sk)}» ${N(worst.n)} برچسب منفی گرفت. در آن لحظه‌ها چه اتفاقی می‌افتاد و اگر بازی را دوباره شروع کنید، اول چه چیزی را عوض می‌کنید؟`, 'بیشترین برچسب منفی یک مهارت');

        // 2. Rank jump / drop between mid-game and the end.
        if (D.t1 > D.t0 && D.teams.length >= 3) {
            const mid = D.t0 + (D.t1 - D.t0) / 2;
            const rMid = D.rankAt(mid);
            let up = null, down = null;
            D.teams.forEach(t => {
                const delta = rMid[t.id] - D.rank[t.id];
                if (delta > 0 && (!up || delta > up.delta)) up = { t, delta, from: rMid[t.id] };
                if (delta < 0 && (!down || delta < down.delta)) down = { t, delta, from: rMid[t.id] };
            });
            if (up) add(`تیم «${up.t.name}» در نیمه دوم از رتبه ${N(up.from)} به رتبه ${N(D.rank[up.t.id])} رسید. نقطه عطف کجا بود و چه کسی آن را رقم زد؟`, 'بیشترین صعود در جدول');
            if (down) add(`تیم «${down.t.name}» از رتبه ${N(down.from)} به ${N(D.rank[down.t.id])} افت کرد. فشار از کجا آمد و تیم چطور با آن کنار آمد؟`, 'بیشترین افت در جدول');
        }

        // 3. Decision rounds where teams split / agreed.
        (camp.rounds || []).filter(r => r.status === 'closed' || r.revealed).forEach(r => {
            const counts = {};
            Object.values((camp.decisions || {})[r.id] || {}).forEach(d => { counts[d.optionId] = (counts[d.optionId] || 0) + 1; });
            const used = (r.options || []).filter(o => counts[o.id]);
            if (used.length >= 2) add(`در دور «${r.title}» تیم‌ها دو دسته شدند (${used.map(o => `${o.label}: ${N(counts[o.id])}`).join('، ')}). هر تیم با چه معیاری انتخاب کرد و حرف آخر را چه کسی زد؟`, 'تصمیم‌های متفاوت در یک دور');
            else if (used.length === 1 && sum(Object.values(counts)) >= 2) add(`همه تیم‌ها در دور «${r.title}» گزینه «${used[0].label}» را انتخاب کردند. چرا گزینه‌های دیگر جذاب نبودند؟ آیا کسی مخالف بود؟`, 'انتخاب یکسان همه تیم‌ها');
        });

        // 4. A starred moment.
        const moments = (camp.moments || []).filter(m => m.kind !== 'chance' && m.text);
        if (moments.length) {
            const m = moments[moments.length - 1];
            add(`لحظه «${m.text}»${m.teamId ? ` (تیم «${teamName(m.teamId)}»)` : ''} را دوباره مرور کنید: چه چیزی آن را ممکن کرد و کجای کار یا زندگی‌تان می‌توانید تکرارش کنید؟`, 'لحظه ثبت‌شده توسط اپراتور');
        }

        // 5. Champion's strongest skill.
        const champ = sorted[0];
        if (champ && D.hasSkillData) {
            const prof = D.profile.get(champ.id);
            const best = D.skills.slice().sort((a, b) => prof[b.id] - prof[a.id])[0];
            if (best) add(`قهرمان، تیم «${champ.name}»، در «${best.name}» از همه جلوتر بود. چه عادت‌هایی داشتند که بقیه تیم‌ها می‌توانند از آن یاد بگیرند؟`, 'قوی‌ترین مهارت تیم اول');
        }

        // 6. Most frequent positive / negative behaviour.
        const all = new Map();
        D.refInstants.forEach(({ l }) => { if (!l.tag) return; const x = all.get(l.tag) || { n: 0, k: D.kindOf(l) }; x.n++; all.set(l.tag, x); });
        const list = [...all.entries()].sort((a, b) => b[1].n - a[1].n);
        const topPos = list.find(x => x[1].k === 'pos');
        const topNeg = list.find(x => x[1].k === 'neg');
        if (topPos) add(`پرتکرارترین رفتار مثبت امروز «${topPos[0]}» بود (${N(topPos[1].n)} بار). یک نمونه‌اش را تعریف کنید؛ چه شرایطی باعث شد این رفتار خودبه‌خود اتفاق بیفتد؟`, 'پرتکرارترین برچسب مثبت');
        if (topNeg) add(`«${topNeg[0]}» ${N(topNeg[1].n)} بار توسط داورها ثبت شد. چه چیزی در طراحی بازی یا فشار زمان این رفتار را تشدید کرد؟`, 'پرتکرارترین برچسب منفی');

        // 7. Accepted appeal.
        const ap = (camp.appeals || []).find(a => a.status === 'accepted');
        if (ap) add(`اعتراض مربوط به تیم «${teamName(ap.teamId)}» پذیرفته شد. این اتفاق درباره شفافیت قوانین و ارتباط با داورها چه درسی داشت؟`, 'اعتراض پذیرفته‌شده');

        // 8. Reaction to a chance card (points in the 15 minutes after it).
        const chance = (camp.moments || []).find(m => m.kind === 'chance');
        if (chance && D.teams.length >= 2) {
            const win = D.refInstants.filter(x => x.at > chance.at && x.at - chance.at < 15 * 60000);
            const per = {};
            win.forEach(x => { per[x.t.id] = (per[x.t.id] || 0) + x.v; });
            const best = Object.entries(per).sort((a, b) => b[1] - a[1])[0];
            if (best && best[1] > 0) add(`بعد از کارت شانس «${chance.text}»، تیم «${teamName(best[0])}» در ۱۵ دقیقه بعد ${sN(best[1])} امتیاز گرفت. چطور با غافلگیری کنار آمدید و چه کسی آرامش تیم را حفظ کرد؟`, 'واکنش به کارت شانس');
        }

        // 9. Budget strategy.
        if (on('budget')) {
            const spender = D.teams.slice().sort((a, b) => D.tstat.get(b.id).spent - D.tstat.get(a.id).spent)[0];
            if (spender && D.tstat.get(spender.id).spent > 0) add(`تیم «${spender.name}» بیشترین هزینه را کرد (${N(D.tstat.get(spender.id).spent)}). آیا این خرج‌ها ارزشش را داشت؟ اگر دوباره بود کجا صرفه‌جویی می‌کردید؟`, 'راهبرد بودجه');
        }

        // 10. Self vs peers gap.
        let gap = null;
        D.teams.forEach(t => {
            const fb = memberFeedback(t);
            (t.members || []).forEach(m => {
                const o = fb[m.id];
                if (o.selfAvg === null || o.peerAvg === null) return;
                const g = o.selfAvg - o.peerAvg;
                if (!gap || Math.abs(g) > Math.abs(gap.g)) gap = { m, t, g };
            });
        });
        if (gap && Math.abs(gap.g) >= 0.75) add(`در یکی از تیم‌ها خودارزیابی یک بازیکن ${gap.g > 0 ? 'بالاتر' : 'پایین‌تر'} از نظر هم‌تیمی‌هایش بود (${N(Math.abs(r2(gap.g)))} از ۵). بازخورد دادن و گرفتن در تیم شما چقدر راحت است؟`, 'فاصله خودارزیابی و نظر هم‌تیمی‌ها');

        // 11. Lead changes.
        if (D.leadChanges >= 2) add(`صدر جدول ${N(D.leadChanges)} بار دست‌به‌دست شد. در لحظه‌هایی که صدر را از دست دادید یا گرفتید، فضای تیم چطور عوض شد؟`, 'رقابت نفس‌گیر برای صدر');

        // Generic fallbacks so the session always has a backbone.
        const generic = [
            ['اگر فقط یک تصمیم امروز را می‌توانستید عوض کنید، کدام بود و چرا؟', 'پرسش عمومی'],
            ['چه کسی در تیم شما بی‌سروصدا بیشترین کمک را کرد؟ از او چه یاد گرفتید؟', 'پرسش عمومی'],
            ['کدام قانون بازی شبیه یک موقعیت واقعی در کار شماست؟', 'پرسش عمومی'],
            ['تیم شما کجا بیشترین وقت را از دست داد و چه نشانه‌ای می‌توانست زودتر هشدار بدهد؟', 'پرسش عمومی']
        ];
        for (const [q, why] of generic) { if (qs.length >= 6) break; add(q, why); }
        return qs.slice(0, 10);
    }

    // ---- Tab 1: review -----------------------------------------------------------------------------------
    let EVENTS = [];
    const TL_PAGE = 150;
    let tlLimit = TL_PAGE;
    function renderReview() {
        EVENTS = buildEvents();
        const teamOpts = D.teams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
        const stageOpts = D.stages.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
        const present = new Set(EVENTS.map(e => e.type));
        const typeOpts = Object.entries(TYPES).filter(([k]) => present.has(k)).map(([k, [l, i]]) => `<option value="${k}">${i} ${esc(l)}</option>`).join('');
        const timeline = `
            <div class="an-controls">
                <select id="tlTeam" aria-label="فیلتر تیم"><option value="">همه تیم‌ها</option>${teamOpts}</select>
                <select id="tlStage" aria-label="فیلتر مرحله"><option value="">همه مراحل</option>${stageOpts}</select>
                <select id="tlType" aria-label="فیلتر نوع رویداد"><option value="">همه رویدادها</option>${typeOpts}</select>
                <select id="tlOrder" aria-label="ترتیب"><option value="asc">از سوت شروع</option><option value="desc">تازه‌ترین اول</option></select>
                <span class="an-count" id="tlCount"></span>
            </div>
            <ol class="tl" id="tlList"></ol><div class="tl-more" id="tlMore"></div>`;
        const km = keyMoments(EVENTS);
        const kmHtml = km.length ? `<ul class="km">${km.map(k => `<li><span class="km-ico">${k.icon}</span><div><div>${esc(k.text)}</div><small>${esc(fmtTime(k.at))}${k.sub ? ' · ' + esc(k.sub) : ''}</small></div></li>`).join('')}</ul>` : empty('هنوز لحظه کلیدی ثبت نشده است.');
        const qs = debriefQuestions();
        $('#pane-review').innerHTML = `
            <div class="an-grid-2">
                ${box('🎬 خط زمانی مسابقه', 'هر امتیاز، نمره مرحله، کارت شانس، اعتراض و تصمیم تیم‌ها به ترتیب زمان. مرحله امتیازهای لحظه‌ای از «مرحله در حال اجرا» در همان لحظه حدس زده می‌شود.', timeline)}
                ${box('🔑 لحظه‌های کلیدی', 'صدرنشینی‌ها، بزرگ‌ترین امتیاز و جریمه، لحظه‌های ستاره‌دار اپراتور و پایان مراحل.', kmHtml)}
            </div>
            ${box('♟️ مقایسه تاکتیک تیم‌ها', 'تصمیم هر تیم در دورهای بسته‌شده یا اعلام‌شده، جریان بودجه و رفتارهایی که داورها برچسب زدند.', tacticTable())}
            ${box('🗣️ سؤال‌های پیشنهادی برای جلسه مرور', 'از داده‌های همین مسابقه ساخته شده‌اند؛ برای شروع گفت‌وگو با تیم‌ها.', `<ol class="qs">${qs.map(q => `<li>${esc(q.q)}<span class="q-why">${esc(q.why)}</span></li>`).join('')}</ol>`)}`;
        ['tlTeam', 'tlStage', 'tlType', 'tlOrder'].forEach(id => $('#' + id).addEventListener('change', () => { tlLimit = TL_PAGE; renderTimeline(); }));
        renderTimeline();
    }

    function renderTimeline() {
        const team = $('#tlTeam').value, stage = $('#tlStage').value, type = $('#tlType').value, order = $('#tlOrder').value;
        let list = EVENTS.filter(e => (!team || e.teamId === team) && (!stage || e.stageId === stage) && (!type || e.type === type));
        if (order === 'desc') list = list.slice().reverse();
        $('#tlCount').textContent = `${N(list.length)} رویداد`;
        if (!list.length) { $('#tlList').innerHTML = `<li>${empty('رویدادی با این فیلتر پیدا نشد.')}</li>`; $('#tlMore').innerHTML = ''; return; }
        $('#tlList').innerHTML = list.slice(0, tlLimit).map(eventHtml).join('');
        $('#tlMore').innerHTML = list.length > tlLimit ? `<button type="button" class="an-btn" id="tlMoreBtn">نمایش ${N(Math.min(TL_PAGE, list.length - tlLimit))} رویداد بیشتر</button>` : '';
        const more = $('#tlMoreBtn');
        if (more) more.onclick = () => { tlLimit += TL_PAGE; renderTimeline(); };
        document.querySelectorAll('#tlList .tl-photo').forEach(img => img.addEventListener('click', () => {
            const lb = $('#lightbox');
            lb.querySelector('img').src = img.getAttribute('src');
            lb.style.display = 'flex';
        }));
    }

    function eventHtml(e) {
        const t = e.teamId ? D.teamById.get(e.teamId) : null;
        const [label, icon] = TYPES[e.type];
        let head = t ? `${teamDot(t)}<b>${esc(t.name)}</b>` : `<b>${esc(label)}</b>`;
        if (e.type === 'score') head += ` ${valHtml(e.value)}${e.tag ? ` <span class="chip ${e.kind}">${esc(e.tag)}</span>` : ''}`;
        if (e.type === 'stage') head += ` <span class="chip">${esc(stageName(e.stageId))}</span> <span class="val">${esc(e.stageValue)}</span>`;
        if (e.type === 'close') head = `<b>سوت پایان «${esc(stageName(e.stageId))}»</b>`;
        if (e.type === 'appeal') head += ` <span class="chip ${e.status === 'accepted' ? 'pos' : e.status === 'rejected' ? 'neg' : 'warn'}">${esc(e.statusText)}</span>`;
        if (e.type === 'chance' || e.type === 'moment' || e.type === 'decision' || e.type === 'admin') head += t ? ` <span class="chip">${esc(label)}</span>` : '';
        const meta = [];
        if (e.by) meta.push((e.type === 'score' || e.type === 'stage' ? 'داور: ' : 'ثبت: ') + e.by);
        if (e.member) meta.push('بازیکن: ' + e.member);
        if (e.stageId && e.type !== 'stage' && e.type !== 'close') meta.push('مرحله: ' + stageName(e.stageId));
        const photo = e.photo && safeUrl(e.photo) ? `<img class="tl-photo" src="${esc(safeUrl(e.photo))}" alt="عکس داور" loading="lazy">` : '';
        return `<li class="tl-item tl-${e.type}" style="--tc:${esc(safeColor(t && t.color, e.type === 'close' ? '#f59e0b' : '#94a3b8'))}">
            <span class="tl-time" title="${esc(fullTime(e.at))}">${esc(fmtTime(e.at))}</span>
            <span class="tl-ico" title="${esc(label)}">${icon}</span>
            <div><div class="tl-head">${head}</div>${e.text ? `<div class="tl-text">${esc(e.text)}</div>` : ''}${meta.length ? `<div class="tl-meta">${esc(meta.join(' · '))}</div>` : ''}</div>
            ${photo}</li>`;
    }

    function topTags(s, n) {
        return [...s.tags.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, n);
    }

    function tacticTable() {
        if (!D.teams.length) return empty('تیمی ثبت نشده است.');
        const rounds = (camp.rounds || []).filter(r => r.status === 'closed' || r.revealed);
        const budget = on('budget');
        const head = `<th class="l">تیم</th><th>رتبه</th><th>امتیاز</th>${rounds.map(r => `<th title="${esc(r.question || '')}">🗳 ${esc(r.title)}</th>`).join('')}${budget ? '<th>بودجه خرج‌شده</th><th>بودجه به‌دست‌آمده</th>' : ''}<th>برچسب مثبت</th><th>برچسب منفی</th><th class="l">پرتکرارترین برچسب‌ها</th>`;
        const rows = D.teams.slice().sort((a, b) => D.rank[a.id] - D.rank[b.id]).map(t => {
            const s = D.tstat.get(t.id);
            const dec = rounds.map(r => {
                const d = ((camp.decisions || {})[r.id] || {})[t.id];
                const o = d && (r.options || []).find(x => x.id === d.optionId);
                return `<td>${o ? esc(o.label) + (o.points ? ` <small>(${esc(sN(num(o.points)))})</small>` : '') : '<small>بدون انتخاب</small>'}</td>`;
            }).join('');
            const tags = topTags(s, 3).map(([tag, x]) => `<span class="chip ${x.kind}">${esc(tag)} × ${N(x.n)}</span>`).join(' ');
            return `<tr><td class="l"><span class="team-cell">${teamDot(t)}${esc(t.name)}</span></td><td>${MEDAL[D.rank[t.id]] || N(D.rank[t.id])}</td><td><b>${N(num(t.score))}</b></td>${dec}
                ${budget ? `<td>${N(s.spent)}</td><td>${N(s.earned)}</td>` : ''}
                <td><span class="val pos">${N(s.pos)}</span></td><td><span class="val neg">${N(s.neg)}</span></td><td class="l wrap">${tags || '<small>—</small>'}</td></tr>`;
        }).join('');
        return `<div class="an-scroll"><table class="an-t"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    // ---- Tab 2: report cards -------------------------------------------------------------------------------
    function skillBlock(labels, values, color) {
        if (labels.length >= 3) return `<div class="fc-radar">${Feat.radarChart(labels, values, color, { size: 250 })}</div>`;
        if (!labels.length) return '';
        return `<div class="fc-skillbars">${labels.map((l, i) => `<div><span>${esc(l)}</span><i style="width:${Math.max(4, Math.min(100, values[i]))}%"></i><b>${N(Math.round(values[i]))}</b></div>`).join('')}</div>`;
    }

    function teamCard(t) {
        const s = D.tstat.get(t.id);
        const rank = D.rank[t.id];
        const prof = D.profile.get(t.id);
        const raw = D.skillPts.get(t.id);
        const skills = D.skills;
        const hasData = D.hasSkillData;
        const order = skills.slice().sort((a, b) => prof[b.id] - prof[a.id]);
        const strengths = hasData ? order.filter(sk => raw[sk.id] > 0).slice(0, 2) : [];
        const weak = hasData && order.length > 2 ? order[order.length - 1] : null;
        const mvp = Feat.mvp(t);
        const cap = Feat.captain(t);
        const div = on('divisions') && t.division ? ((camp.divisions || []).find(d => d.id === t.division) || {}).name : '';
        const badges = (D.badges[t.id] || []).map(b => `<span class="chip">${b.icon} ${esc(b.label)}</span>`).join('');
        const notes = s.notes.slice(-3).map(l => `<li>💬 ${esc(l.note)} <small>(${esc(l.tag || '')}${l.tag ? ' · ' : ''}${esc(sN(num(l.value)))})</small></li>`);
        (camp.moments || []).filter(m => m.kind === 'moment' && m.teamId === t.id).slice(-2).forEach(m => notes.push(`<li>⭐ ${esc(m.text)}</li>`));
        const sub = [div ? (/^گروه/.test(div) ? div : 'گروه ' + div) : '', cap ? 'کاپیتان: ' + cap.name : '', (t.members || []).length ? N(t.members.length) + ' بازیکن' : ''].filter(Boolean).join(' · ');
        const budgetTile = on('budget') && shown('budget') ? `<div><b>${N(num(t.budget))}</b><span>بودجه</span></div>` : `<div><b>${N(s.tags.size)}</b><span>برچسب متفاوت</span></div>`;
        return `<article class="fc ${rank === 1 ? 'gold' : ''}" style="--tc:${esc(safeColor(t.color, '#3b82f6'))}">
            <div class="fc-top">
                <div class="fc-ovr"><b>${N(rank)}</b><small>رتبه</small></div>
                <div class="fc-id"><h3 class="fc-name">${esc(t.name)}</h3><div class="fc-sub">${esc(sub || 'کارنامه فنی تیم')}</div></div>
                <div class="fc-medal">${MEDAL[rank] || ''}</div>
            </div>
            ${hasData ? skillBlock(skills.map(x => x.name), skills.map(x => prof[x.id]), t.color) : '<div class="fc-sub">هنوز برچسبی که به مهارت‌ها وصل باشد ثبت نشده است.</div>'}
            <div class="fc-stats">
                <div><b>${N(num(t.score))}</b><span>امتیاز</span></div>
                ${budgetTile}
                <div><b>${N(s.pos)}</b><span>مثبت 👍</span></div>
                <div><b>${N(s.neg)}</b><span>منفی 👎</span></div>
            </div>
            ${strengths.length ? `<div class="fc-row"><em>نقطه قوت</em>${strengths.map(x => `<span class="chip good">💪 ${esc(x.name)}</span>`).join('')}</div>` : ''}
            ${weak ? `<div class="fc-row"><em>قابل بهبود</em><span class="chip bad">🎯 ${esc(weak.name)}</span></div>` : ''}
            ${mvp && shown('individual') ? `<div class="fc-row"><em>ستاره تیم</em><span class="chip">🌟 ${esc(mvp.member.name)} (${N(mvp.points)})</span></div>` : ''}
            ${badges ? `<div class="fc-row"><em>نشان‌ها</em>${badges}</div>` : ''}
            ${notes.length ? `<ul class="fc-notes">${notes.join('')}</ul>` : ''}
        </article>`;
    }

    function playerCards(t) {
        const pts = Feat.memberPoints(t);
        const fb = memberFeedback(t);
        const mvp = Feat.mvp(t);
        const members = (t.members || []).slice().sort((a, b) => pts[b.id] - pts[a.id]);
        const voteTop = Math.max(0, ...members.map(m => fb[m.id].mvpVotes));
        return members.map((m, i) => {
            const o = fb[m.id];
            const labels = D.skills.filter(s => o.peerBy[s.id] !== undefined);
            const radar = labels.length ? skillBlock(labels.map(s => s.name), labels.map(s => (o.peerBy[s.id] / 5) * 100), t.color) : '';
            const cmpSkills = D.skills.filter(s => o.peerBy[s.id] !== undefined || o.selfBy[s.id] !== undefined);
            const cmp = cmpSkills.length && o.selfAvg !== null ? `<table class="pc-cmp"><thead><tr><th>مهارت</th><th>خودم</th><th>هم‌تیمی‌ها</th><th>فاصله</th></tr></thead><tbody>${cmpSkills.map(s => {
                const a = o.selfBy[s.id], b = o.peerBy[s.id];
                const g = a !== undefined && b !== undefined ? r2(a - b) : null;
                return `<tr><td>${esc(s.name)}</td><td>${a !== undefined ? N(r2(a)) : '—'}</td><td>${b !== undefined ? N(r2(b)) : '—'}</td><td>${g === null ? '—' : `<bdi dir="ltr">${g > 0 ? '▲' : g < 0 ? '▼' : '='} ${N(Math.abs(g))}</bdi>`}</td></tr>`;
            }).join('')}</tbody></table>` : '';
            const isMvp = mvp && mvp.member.id === m.id;
            const crowd = voteTop > 0 && o.mvpVotes === voteTop && members.filter(x => fb[x.id].mvpVotes === voteTop).length === 1;
            return `<article class="fc ${isMvp || crowd ? 'gold' : ''}" style="--tc:${esc(safeColor(t.color, '#3b82f6'))}">
                <div class="fc-top">
                    <div class="fc-ovr"><b>${N(pts[m.id] || 0)}</b><small>امتیاز</small></div>
                    <div class="fc-id"><h3 class="fc-name">${esc(m.name)}</h3><div class="fc-sub">${esc([t.name, m.role].filter(Boolean).join(' · '))}</div></div>
                    <div class="fc-medal">${isMvp ? '🌟' : i < 3 && pts[m.id] > 0 ? MEDAL[i + 1] : ''}</div>
                </div>
                ${radar}
                <div class="fc-stats">
                    <div><b>${N(i + 1)}</b><span>رتبه در تیم</span></div>
                    <div><b>${N(o.mvpVotes)}</b><span>رأی MVP</span></div>
                    <div><b>${o.peerAvg === null ? '—' : N(r2(o.peerAvg))}</b><span>هم‌تیمی‌ها</span></div>
                    <div><b>${o.selfAvg === null ? '—' : N(r2(o.selfAvg))}</b><span>خودارزیابی</span></div>
                </div>
                ${crowd ? '<div class="fc-row"><span class="chip good">👏 محبوب هم‌تیمی‌ها</span></div>' : ''}
                ${cmp}
            </article>`;
        }).join('');
    }

    let cardsTeam = '';
    function renderCards() {
        const anyMembers = D.teams.some(t => (t.members || []).length);
        const teams = D.teams.slice().sort((a, b) => D.rank[a.id] - D.rank[b.id]);
        const teamCards = teams.length ? `<div class="cards">${teams.map(teamCard).join('')}</div>` : empty('تیمی ثبت نشده است.');
        let players = '';
        if (anyMembers) {
            const opts = teams.filter(t => (t.members || []).length).map(t => `<option value="${esc(t.id)}" ${cardsTeam === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
            players = box('🧑‍🤝‍🧑 کارت بازیکن‌ها', 'امتیاز فردی از امتیازهایی که داور به بازیکن نسبت داده؛ رأی MVP و میانگین نمره (از ۵) از «رأی هم‌تیمی‌ها و خودارزیابی».',
                `<div class="an-controls"><select id="pcTeam" aria-label="تیم بازیکن‌ها"><option value="">همه تیم‌ها</option>${opts}</select>
                 <button type="button" class="an-btn" id="printPlayers"><i data-lucide="printer"></i>چاپ کارت بازیکن‌ها</button></div><div id="pcList"></div>`);
        }
        $('#pane-cards').innerHTML = box('🃏 کارنامه فنی تیم‌ها', 'نمودار مهارت‌ها نسبت به بهترین تیم همین مسابقه است (۱۰۰ = بهترین). نقطه قوت دو مهارت بالا و «قابل بهبود» پایین‌ترین مهارت است.',
            `<div class="an-controls"><button type="button" class="an-btn" id="printTeams"><i data-lucide="printer"></i>چاپ کارنامه تیم‌ها</button></div>${teamCards}`) + players;
        $('#printTeams').onclick = () => printHtml(printHeader('کارنامه فنی تیم‌ها') + `<div class="cards">${teams.map(teamCard).join('')}</div>`);
        if (anyMembers) {
            const draw = () => {
                cardsTeam = $('#pcTeam').value;
                const list = teams.filter(t => (t.members || []).length && (!cardsTeam || t.id === cardsTeam));
                $('#pcList').innerHTML = list.map(t => `<h3 class="team-group-title">${teamDot(t)}${esc(t.name)}</h3><div class="cards players">${playerCards(t)}</div>`).join('');
            };
            $('#pcTeam').onchange = draw;
            draw();
            $('#printPlayers').onclick = () => {
                const list = teams.filter(t => (t.members || []).length && (!cardsTeam || t.id === cardsTeam));
                printHtml(printHeader('کارت بازیکن‌ها') + list.map((t, i) => `<div class="${i ? 'print-break' : ''}"><h3 class="team-group-title">${teamDot(t)}${esc(t.name)}</h3><div class="cards players">${playerCards(t)}</div></div>`).join(''));
            };
        }
    }

    // ---- Tab 3: stats --------------------------------------------------------------------------------------
    function refereeStats() {
        const refs = new Map();
        const get = (key, name, role) => {
            if (!refs.has(key)) refs.set(key, { key, name, role: role || ((D.users.get(key) || {}).role) || '', inst: 0, instSum: 0, pos: 0, neg: 0, stageN: 0, stageVals: [], teams: new Set() });
            return refs.get(key);
        };
        D.refInstants.forEach(({ l, t, v }) => {
            const u = l.user || {};
            const r = get(u.username || '?', refName(l.user), u.role);
            r.inst++; r.instSum += v; r.teams.add(t.id);
            if (D.kindOf(l) === 'pos') r.pos++; else r.neg++;
        });
        D.judge.forEach(({ key, e, t }) => {
            if (key === OVERRIDE) return;
            const r = get(key, e.judgeName || key, e.judgeRole);
            r.stageN++; r.teams.add(t.id);
            if (isNum(e.score)) r.stageVals.push(num(e.score));
        });
        return [...refs.values()].sort((a, b) => (b.inst + b.stageN) - (a.inst + a.stageN));
    }

    function statsKpis() {
        const closed = Object.values(camp.closedStages || {}).filter(Boolean).length;
        const pos = sum([...D.tstat.values()].map(s => s.pos)), neg = sum([...D.tstat.values()].map(s => s.neg));
        const k = [
            [N(D.refInstants.length), 'امتیاز لحظه‌ای داورها'], [`${N(pos)} / ${N(neg)}`, 'برچسب مثبت / منفی'],
            [`${N(closed)} از ${N(D.stages.length)}`, 'مرحله تمام‌شده'], [N(D.judge.filter(j => j.key !== OVERRIDE).length), 'نمره مرحله ثبت‌شده'],
            [N((camp.moments || []).length), 'لحظه و کارت شانس'], [N(refereeStats().length), 'داور فعال']
        ];
        if (D.t1 > D.t0) k.push([fmtNum(Feat.fmtClock(D.t1 - D.t0, 'en'), camp.numLang), 'مدت بازی (اولین تا آخرین ثبت)']);
        return `<div class="kpis">${k.map(([b, s]) => `<div class="kpi"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('')}</div>`;
    }

    function stageTable() {
        if (!D.stages.length) return empty('مرحله‌ای تعریف نشده است.');
        const teams = D.teams.slice().sort((a, b) => D.rank[a.id] - D.rank[b.id]);
        const res = camp.stageTieredResults || {};
        const head = `<th class="l">تیم</th>${D.stages.map(s => `<th>${esc(s.name)}${camp.closedStages && camp.closedStages[s.id] ? ' 🏁' : ''}</th>`).join('')}<th>لحظه‌ای</th><th>مجموع</th><th>رتبه</th>`;
        const rows = teams.map(t => {
            const cells = D.stages.map(s => {
                const v = (t.stageScores || {})[s.id];
                const r = ((res[s.id] || {}).results || []).find(x => x.teamId === t.id);
                const medal = r && typeof r.rank === 'number' ? (MEDAL[r.rank] || `<small>(${N(r.rank)})</small>`) : '';
                return `<td>${v === undefined ? '<small>—</small>' : esc(fmtStageVal(s, v))} ${medal}</td>`;
            }).join('');
            const inst = sum(D.instants.filter(x => x.t.id === t.id).map(x => x.v));
            return `<tr><td class="l"><span class="team-cell">${teamDot(t)}${esc(t.name)}</span></td>${cells}<td>${esc(sN(r2(inst)))}</td><td><b>${N(num(t.score))}</b></td><td>${MEDAL[D.rank[t.id]] || N(D.rank[t.id])}</td></tr>`;
        }).join('');
        return `<div class="an-scroll"><table class="an-t"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    function tagBars() {
        const all = new Map();
        D.refInstants.forEach(({ l, v }) => {
            const tag = l.tag || '(بدون برچسب)';
            const x = all.get(tag) || { n: 0, pts: 0, kind: D.kindOf(l) };
            x.n++; x.pts += v; all.set(tag, x);
        });
        const list = [...all.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 18);
        if (!list.length) return empty('هنوز امتیاز لحظه‌ای ثبت نشده است.');
        const max = list[0][1].n;
        return `<div class="bars">${list.map(([tag, x]) => `<div class="bar-row" title="${esc(tag)}: ${esc(N(x.n))} بار، جمع ${esc(sN(r2(x.pts)))}">
            <span class="bar-label">${esc(tag)}</span><span class="bar-track"><span class="bar-fill ${x.kind}" style="width:${Math.max(3, (x.n / max) * 100)}%;display:block"></span></span><b class="val">${N(x.n)}</b></div>`).join('')}</div>`;
    }

    function refereeTable() {
        const refs = refereeStats();
        if (!refs.length) return empty('هنوز داوری امتیاز ثبت نکرده است.');
        const rows = refs.map(r => {
            const tot = r.pos + r.neg;
            const pPos = tot ? (r.pos / tot) * 100 : 0;
            return `<tr><td class="l"><b>${esc(r.name)}</b> <small>${esc(ROLE[r.role] || '')}</small></td><td>${N(r.inst)}</td><td>${r.inst ? esc(sN(r2(r.instSum / r.inst))) : '—'}</td>
                <td>${N(r.stageN)}</td><td>${r.stageVals.length ? N(r2(mean(r.stageVals))) : '—'}</td><td>${N(r.teams.size)}</td>
                <td><div class="ratio" title="مثبت ${esc(N(r.pos))} / منفی ${esc(N(r.neg))}"><span style="width:${pPos}%;background:var(--an-pos)"></span><span style="width:${tot ? 100 - pPos : 0}%;background:var(--an-neg)"></span></div><small>${N(r.pos)} / ${N(r.neg)}</small></td></tr>`;
        }).join('');
        return `<div class="an-scroll"><table class="an-t"><thead><tr><th class="l">داور</th><th>امتیاز لحظه‌ای</th><th>میانگین هر امتیاز</th><th>نمره مرحله</th><th>میانگین نمره مرحله</th><th>تیم‌های دیده‌شده</th><th>مثبت / منفی</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    function divisionsTable() {
        const divs = camp.divisions || [];
        if (!divs.length) return empty('گروهی تعریف نشده است.');
        const dr = Feat.divisionRanks(camp);
        const rows = divs.map(d => {
            const ts = D.teams.filter(t => t.division === d.id);
            const lead = ts.find(t => dr[t.id] === 1);
            return `<tr><td class="l"><b>${esc(d.name)}</b></td><td>${N(ts.length)}</td><td>${lead ? `<span class="team-cell">${teamDot(lead)}${esc(lead.name)}</span>` : '—'}</td>
                <td>${ts.length ? N(r2(mean(ts.map(t => num(t.score))))) : '—'}</td><td>${N(r2(sum(ts.map(t => num(t.score)))))}</td><td class="l wrap">${ts.sort((a, b) => dr[a.id] - dr[b.id]).map(t => `${N(dr[t.id])}. ${esc(t.name)}`).join('، ')}</td></tr>`;
        }).join('');
        const free = D.teams.filter(t => !divs.some(d => d.id === t.division));
        return `<div class="an-scroll"><table class="an-t"><thead><tr><th class="l">گروه</th><th>تیم‌ها</th><th>صدرنشین</th><th>میانگین امتیاز</th><th>مجموع</th><th class="l">جدول گروه</th></tr></thead><tbody>${rows}</tbody></table></div>${free.length ? `<p class="an-hint">بدون گروه: ${esc(free.map(t => t.name).join('، '))}</p>` : ''}`;
    }

    function renderStats() {
        const trend = `<div class="chart-box">${Feat.lineChart(D.series, { lang: camp.numLang })}</div>`;
        $('#pane-stats').innerHTML = `
            ${box('📊 خلاصه مسابقه', '', statsKpis())}
            ${box('📈 روند امتیاز تیم‌ها', 'مجموع امتیاز هر تیم در طول زمان (امتیازهای لحظه‌ای و نمره مراحل).', trend)}
            <div class="an-grid-2">
                ${box('🏆 نتایج مراحل', '🏁 = مرحله بسته شده؛ مدال‌ها رتبه تیم در همان مرحله است.', stageTable())}
                ${box('🏷️ پرتکرارترین برچسب‌ها', 'سبز = رفتار مثبت، قرمز = منفی. کارت شانس و تصمیم تیم‌ها حساب نشده‌اند.', tagBars())}
            </div>
            ${box('🧑‍⚖️ فعالیت داورها', 'تعداد و میانگین امتیازهایی که هر داور داده و نسبت برچسب‌های مثبت به منفی.', refereeTable())}
            ${on('divisions') ? box('🗂️ گروه‌ها', '', divisionsTable()) : ''}`;
    }

    // ---- Tab 4: referees ------------------------------------------------------------------------------------
    function agreementBlock() {
        const out = [];
        const bias = new Map();
        D.stages.forEach(s => {
            const entries = D.judge.filter(j => j.sid === s.id);
            if (!entries.length) return;
            const keys = [...new Set(entries.filter(j => j.key !== OVERRIDE).map(j => j.key))];
            const hasOverride = entries.some(j => j.key === OVERRIDE);
            const names = new Map(entries.map(j => [j.key, j.e.judgeName || j.key]));
            let flagged = 0;
            const spreads = [];
            const rows = D.teams.map(t => {
                const map = (t.judgeStageScores || {})[s.id] || {};
                const vals = keys.filter(k => map[k] && isNum(map[k].score)).map(k => num(map[k].score));
                const m = vals.length ? mean(vals) : null;
                const spread = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null;
                const big = spread !== null && spread > 0 && spread / Math.max(Math.abs(m), 1) >= 0.2;
                if (spread !== null) spreads.push(spread);
                if (big) flagged++;
                if (vals.length >= 2) keys.forEach(k => {
                    if (!map[k] || !isNum(map[k].score)) return;
                    const b = bias.get(k) || { name: names.get(k), diffs: [], rel: [] };
                    b.diffs.push(num(map[k].score) - m);
                    b.rel.push((num(map[k].score) - m) / Math.max(Math.abs(m), 1));
                    bias.set(k, b);
                });
                const cells = keys.map(k => {
                    const e = map[k];
                    if (!e) return '<td><small>—</small></td>';
                    const crit = e.criteria && s.criteria ? s.criteria.filter(c => e.criteria[c.id] !== undefined).map(c => `${c.name}: ${e.criteria[c.id]}`).join(' | ') : '';
                    return `<td title="${esc(crit)}">${esc(fmtStageVal(s, e.score))}${crit ? ' <small>📋</small>' : ''}</td>`;
                }).join('');
                const ov = hasOverride ? `<td>${map[OVERRIDE] ? esc(fmtStageVal(s, map[OVERRIDE].score)) : '<small>—</small>'}</td>` : '';
                if (!vals.length && !map[OVERRIDE]) return '';
                return `<tr><td class="l"><span class="team-cell">${teamDot(t)}${esc(t.name)}</span></td>${cells}${ov}<td>${m === null ? '—' : N(r2(m))}</td>
                    <td class="${big ? 'flag' : spread === 0 ? 'ok' : ''}">${spread === null ? '<small>یک داور</small>' : N(r2(spread)) + (big ? ' ⚠️' : '')}</td></tr>`;
            }).join('');
            const head = `<th class="l">تیم</th>${keys.map(k => `<th>${esc(names.get(k))}</th>`).join('')}${hasOverride ? '<th>اصلاح دستی</th>' : ''}<th>میانگین</th><th>اختلاف (بیشینه − کمینه)</th>`;
            out.push(`<h3 class="team-group-title">${esc(s.name)} <span class="chip ${flagged ? 'neg' : 'pos'}">${flagged ? `${N(flagged)} اختلاف بزرگ` : 'هم‌نظر'}</span>${spreads.length ? ` <small class="an-count">میانگین اختلاف: ${N(r2(mean(spreads)))}</small>` : ''}</h3>
                <div class="an-scroll"><table class="an-t"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`);
        });
        if (!out.length) return empty('هنوز هیچ مرحله‌ای نمره داور ندارد.');
        const b = [...bias.values()].filter(x => x.diffs.length).map(x => ({ ...x, avg: mean(x.diffs), relAvg: mean(x.rel) })).sort((a, b2) => a.avg - b2.avg);
        const biasHtml = b.length ? `<h3 class="team-group-title">گرایش هر داور نسبت به میانگین هم‌داورها</h3><div class="bars">${b.map(x => {
            const lbl = x.relAvg <= -0.05 ? 'سخت‌گیر' : x.relAvg >= 0.05 ? 'دست‌ودل‌باز' : 'هم‌راستا';
            const w = Math.min(100, Math.abs(x.relAvg) * 250);
            return `<div class="bar-row"><span class="bar-label">${esc(x.name)}</span><span class="bar-track"><span class="bar-fill ${x.relAvg < 0 ? 'neg' : 'pos'}" style="width:${Math.max(3, w)}%;display:block"></span></span><b class="val" title="${esc(lbl)}">${esc(sN(r2(x.avg)))}</b></div><div class="an-hint" style="margin:-4px 0 4px;font-size:12px;color:var(--an-muted)">${esc(lbl)} · ${esc(N(x.diffs.length))} نمره مشترک</div>`;
        }).join('')}</div>` : '';
        return out.join('') + biasHtml;
    }

    function calibrationBlock() {
        const cal = camp.calibration || { cases: [], scores: {} };
        const cases = cal.cases || [];
        if (!cases.length) return empty(on('calibration') ? 'نمونه‌ای برای کارگاه هماهنگی تعریف نشده است.' : 'کارگاه هماهنگی داورها برای این مسابقه روشن نیست.');
        const refAgg = new Map();
        const blocks = cases.map(c => {
            const sc = Object.entries((cal.scores || {})[c.id] || {});
            if (!sc.length) return `<h3 class="team-group-title">${esc(c.title)} <small class="an-count">هنوز نمره‌ای ثبت نشده</small></h3>`;
            const vals = sc.map(([, v]) => num(v));
            const m = mean(vals);
            const exp = c.expected === null || c.expected === undefined ? null : num(c.expected);
            const sd = Math.sqrt(mean(vals.map(v => (v - m) ** 2)));
            const rows = sc.sort((a, b) => num(b[1]) - num(a[1])).map(([u, v]) => {
                const dm = num(v) - m, de = exp === null ? null : num(v) - exp;
                const a = refAgg.get(u) || { u, dm: [], de: [] };
                a.dm.push(Math.abs(dm)); if (de !== null) a.de.push(Math.abs(de));
                refAgg.set(u, a);
                const far = de !== null ? Math.abs(de) / Math.max(Math.abs(exp), 1) >= 0.2 : Math.abs(dm) / Math.max(Math.abs(m), 1) >= 0.2;
                return `<tr><td class="l">${esc(refName({ username: u }))}</td><td><b>${N(num(v))}</b></td><td>${esc(sN(r2(dm)))}</td><td class="${de === null ? '' : far ? 'flag' : 'ok'}">${de === null ? '—' : esc(sN(r2(de)))}</td></tr>`;
            }).join('');
            return `<h3 class="team-group-title">${esc(c.title)} <span class="chip">میانگین ${N(r2(m))}</span>${exp !== null ? ` <span class="chip warn">نمره مرجع ${N(exp)}</span>` : ''} <span class="chip">پراکندگی ±${N(r2(sd))}</span></h3>
                <div class="an-scroll"><table class="an-t"><thead><tr><th class="l">داور</th><th>نمره</th><th>فاصله از میانگین</th><th>فاصله از نمره مرجع</th></tr></thead><tbody>${rows}</tbody></table></div>`;
        }).join('');
        const rank = [...refAgg.values()].map(a => ({ ...a, score: a.de.length ? mean(a.de) : mean(a.dm), basis: a.de.length ? 'مرجع' : 'میانگین' })).sort((a, b) => a.score - b.score);
        const summary = rank.length ? `<h3 class="team-group-title">جدول هماهنگی داورها</h3><div class="an-scroll"><table class="an-t"><thead><tr><th>#</th><th class="l">داور</th><th>میانگین فاصله</th><th>مبنا</th><th>نمونه‌ها</th></tr></thead><tbody>${rank.map((a, i) => `<tr><td>${MEDAL[i + 1] || N(i + 1)}</td><td class="l">${esc(refName({ username: a.u }))}</td><td>${N(r2(a.score))}</td><td>${a.basis === 'مرجع' ? 'نمره مرجع' : 'میانگین داورها'}</td><td>${N(a.dm.length)}</td></tr>`).join('')}</tbody></table></div>` : '';
        return summary + blocks;
    }

    function coverageBlock() {
        if (!D.stages.length || !D.teams.length) return empty('تیم یا مرحله‌ای تعریف نشده است.');
        const asg = camp.assignments || {};
        const useAsg = on('assignments') && Object.keys(asg).length > 0;
        const covers = (a, tid, sid) => (!a.teams || !a.teams.length || a.teams.includes(tid)) && (!a.stages || !a.stages.length || a.stages.includes(sid));
        let gaps = 0;
        const rows = D.teams.map(t => `<tr><td class="l"><span class="team-cell">${teamDot(t)}${esc(t.name)}</span></td>${D.stages.map(s => {
            const map = (t.judgeStageScores || {})[s.id] || {};
            const rec = Object.keys(map).filter(k => k !== OVERRIDE);
            const recNames = rec.map(k => map[k].judgeName || k);
            if (useAsg) {
                const who = Object.entries(asg).filter(([, a]) => covers(a, t.id, s.id)).map(([u]) => u);
                const done = who.filter(u => rec.includes(u)).length;
                const extra = rec.length - done; // free referees / head referee without an assignment
                const cls = !who.length ? (rec.length ? 'ok' : 'flag') : done >= who.length ? 'ok' : done || extra ? 'mid' : '';
                if (!who.length && !rec.length) gaps++;
                const label = who.length ? `${N(done)}/${N(who.length)}${extra > 0 ? ` <small>+${N(extra)}</small>` : ''}` : rec.length ? `${N(rec.length)} داور <small>(آزاد)</small>` : 'بدون داور';
                return `<td class="${cls}" title="${esc('سپرده به: ' + (who.map(u => refName({ username: u })).join('، ') || 'هیچ‌کس') + ' — ثبت: ' + (recNames.join('، ') || 'هیچ'))}">${label}</td>`;
            }
            if (!rec.length) gaps++;
            return `<td class="${rec.length ? 'ok' : (camp.closedStages || {})[s.id] ? 'flag' : ''}" title="${esc(recNames.join('، '))}">${rec.length ? N(rec.length) + ' داور' : '—'}</td>`;
        }).join('')}</tr>`).join('');
        const hint = useAsg ? 'هر خانه: «نمره ثبت‌شده / داورهای سپرده‌شده». «+» = داورهای بدون تقسیم (مثل سرداور) که نمره داده‌اند. قرمز = نه داوری سپرده شده و نه نمره‌ای ثبت شده؛ زرد = بخشی از داورهای سپرده‌شده هنوز نمره نداده‌اند.' : 'تقسیم داورها روشن نیست؛ هر خانه تعداد داورهایی است که برای آن تیم و مرحله نمره ثبت کرده‌اند (قرمز = مرحله بسته شده ولی نمره داوری ندارد).';
        let idle = '';
        if (useAsg) {
            const free = (camp.users || []).filter(u => u.role === 'referee' && !asg[u.username]).map(u => u.name || u.username);
            if (free.length) idle = `<p class="an-hint">داورهای بدون تقسیم (همه تیم‌ها و مراحل را می‌بینند): ${esc(free.join('، '))}</p>`;
        }
        return `<p class="an-hint">${esc(hint)}${gaps ? ` — <b>${esc(N(gaps))} خانه خالی</b>` : ''}</p><div class="an-scroll"><table class="an-t"><thead><tr><th class="l">تیم</th>${D.stages.map(s => `<th>${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>${idle}`;
    }

    function renderJudges() {
        $('#pane-judges').innerHTML = `
            ${box('🤝 هم‌نظری داورها در هر مرحله', 'وقتی چند داور به یک تیم نمره داده‌اند، اختلاف بیش از ۲۰٪ میانگین با ⚠️ مشخص می‌شود. نشانگر را روی 📋 ببرید تا نمره معیارها دیده شود.', agreementBlock())}
            ${box('🎯 کارگاه هماهنگی (کالیبراسیون)', 'نمره هر داور به نمونه‌های تمرینی؛ فاصله از میانگین و از نمره مرجع. هرچه فاصله کمتر، داور هماهنگ‌تر.', calibrationBlock())}
            ${box('🗺️ پوشش داوری', '', coverageBlock())}`;
    }

    // ---- Tab 5: export ----------------------------------------------------------------------------------------
    function exportExcel() {
        if (typeof XLSX === 'undefined') { alert('کتابخانه اکسل بارگذاری نشد.'); return; }
        const wb = XLSX.utils.book_new();
        wb.Workbook = { Views: [{ RTL: true }] };
        const add = (name, rows, fallback) => {
            const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [fallback]);
            const keys = Object.keys(rows[0] || fallback);
            ws['!cols'] = keys.map(k => ({ wch: Math.min(48, Math.max(10, k.length + 2, ...rows.slice(0, 200).map(r => String(r[k] === undefined ? '' : r[k]).length + 2))) }));
            XLSX.utils.book_append_sheet(wb, ws, name);
        };
        const date = ts => (ts ? new Date(ts).toLocaleString(locale()) : '');
        const divName = id => ((camp.divisions || []).find(d => d.id === id) || {}).name || '';
        const teams = D.teams.slice().sort((a, b) => D.rank[a.id] - D.rank[b.id]);
        add('نتایج', teams.map(t => {
            const s = D.tstat.get(t.id);
            const row = { 'رتبه': D.rank[t.id], 'تیم': t.name, 'امتیاز': num(t.score) };
            if (on('budget')) row['بودجه'] = num(t.budget);
            if (on('divisions')) row['گروه'] = divName(t.division);
            D.stages.forEach(st => { const v = (t.stageScores || {})[st.id]; row['مرحله: ' + st.name] = v === undefined ? '' : (isNum(v) ? num(v) : String(v)); });
            row['برچسب مثبت'] = s.pos; row['برچسب منفی'] = s.neg;
            return row;
        }), { 'رتبه': '', 'تیم': '', 'امتیاز': '' });
        add('امتیازها', D.instants.map(({ l, t, at, v }) => ({
            'زمان': date(at), 'تیم': t.name, 'امتیاز': v, 'برچسب': l.tag || '', 'نوع': l.chance ? 'کارت شانس' : l.round ? 'تصمیم' : D.kindOf(l) === 'pos' ? 'مثبت' : 'منفی',
            'داور': refName(l.user), 'بازیکن': l.memberId && D.members.get(l.memberId) ? D.members.get(l.memberId).m.name : '',
            'مرحله (حدسی)': stageName(D.stageAt(at)), 'یادداشت': l.note || '', 'عکس': l.photo ? (String(l.photo).startsWith('data:') ? 'دارد' : l.photo) : ''
        })), { 'زمان': '', 'تیم': '', 'امتیاز': '' });
        add('نمرات مراحل', D.judge.slice().sort((a, b) => a.at - b.at).map(({ t, sid, key, e, at }) => {
            const st = D.stageById.get(sid);
            const row = { 'مرحله': st ? st.name : sid, 'تیم': t.name, 'داور': key === OVERRIDE ? (e.judgeName || 'اصلاح دستی') : (e.judgeName || key), 'نمره': isNum(e.score) ? num(e.score) : String(e.score), 'زمان': date(at) };
            const crit = e.criteria || {};
            ((st && st.criteria) || []).forEach(c => { row['معیار: ' + c.name] = crit[c.id] === undefined ? '' : num(crit[c.id]); });
            return row;
        }), { 'مرحله': '', 'تیم': '', 'داور': '', 'نمره': '' });
        const players = [];
        D.teams.forEach(t => {
            const pts = Feat.memberPoints(t), fb = memberFeedback(t);
            (t.members || []).forEach(m => {
                const o = fb[m.id];
                const row = { 'تیم': t.name, 'بازیکن': m.name, 'پست': m.role || '', 'امتیاز فردی': pts[m.id] || 0, 'رأی MVP': o.mvpVotes,
                    'میانگین نظر هم‌تیمی‌ها': o.peerAvg === null ? '' : r2(o.peerAvg), 'خودارزیابی': o.selfAvg === null ? '' : r2(o.selfAvg) };
                D.skills.forEach(s => { row['هم‌تیمی‌ها: ' + s.name] = o.peerBy[s.id] === undefined ? '' : r2(o.peerBy[s.id]); });
                players.push(row);
            });
        });
        add('بازیکن‌ها', players, { 'تیم': '', 'بازیکن': '', 'امتیاز فردی': '' });
        add('لحظه‌ها', (camp.moments || []).map(m => ({ 'زمان': date(m.at), 'نوع': m.kind === 'chance' ? 'کارت شانس' : 'لحظه', 'متن': m.text || '', 'تیم': m.teamId ? teamName(m.teamId) : '', 'مرحله': stageName(m.stageId), 'ثبت': m.by || '' })), { 'زمان': '', 'نوع': '', 'متن': '' });
        add('تاریخچه', D.audit.map(e => ({ 'زمان': date(e.ts), 'کار': AUDIT[e.action] || e.action, 'توسط': (e.by && e.by.name) || '', 'نقش': ROLE[(e.by && e.by.role) || ''] || '', 'جزئیات': JSON.stringify(e.details || {}) })), { 'زمان': '', 'کار': '', 'توسط': '' });
        XLSX.writeFile(wb, `sim-camp-${campId}-analysis.xlsx`);
    }

    function printHeader(title) {
        return `<div class="print-head"><h1>${esc(title)}</h1><div>${esc([camp.title, camp.orgName].filter(Boolean).join(' — '))} · ${esc(new Date().toLocaleDateString(locale()))}</div></div>`;
    }
    function printHtml(html) {
        const area = $('#printArea');
        area.innerHTML = html;
        const done = () => { area.innerHTML = ''; window.removeEventListener('afterprint', done); };
        window.addEventListener('afterprint', done);
        setTimeout(() => window.print(), 50);
    }
    function printReport() {
        const teams = D.teams.slice().sort((a, b) => D.rank[a.id] - D.rank[b.id]);
        const summary = `<div class="an-box">${statsKpis()}</div><div class="an-box"><h2>نتایج</h2>${stageTable()}</div>
            <div class="an-box chart-box"><h2>روند امتیاز</h2>${Feat.lineChart(D.series, { lang: camp.numLang })}</div>
            <div class="an-box"><h2>سؤال‌های جلسه مرور</h2><ol>${debriefQuestions().map(q => `<li>${esc(q.q)}</li>`).join('')}</ol></div>`;
        const cards = `<div class="print-break"><h2>کارنامه فنی تیم‌ها</h2><div class="cards">${teams.map(teamCard).join('')}</div></div>`;
        printHtml(printHeader('گزارش مسابقه — اتاق آنالیز') + summary + cards);
    }

    function renderExport() {
        $('#pane-export').innerHTML = box('📦 خروجی گزارش', 'فایل اکسل برای بایگانی و تحلیل بیشتر؛ چاپ گزارش برای جلسه مرور یا تحویل به مشتری (در پنجره چاپ «ذخیره به PDF» را انتخاب کنید).',
            `<div class="an-controls">
                <button type="button" class="an-btn primary" id="xlsxBtn"><i data-lucide="file-spreadsheet"></i>دانلود اکسل آنالیز</button>
                <button type="button" class="an-btn" id="printBtn"><i data-lucide="printer"></i>چاپ گزارش</button>
            </div>
            <div class="an-scroll"><table class="an-t"><thead><tr><th class="l">برگه اکسل</th><th class="l">محتوا</th></tr></thead><tbody>
                <tr><td class="l">نتایج</td><td class="l wrap">رتبه، تیم، امتیاز${on('budget') ? '، بودجه' : ''}${on('divisions') ? '، گروه' : ''}، امتیاز هر مرحله و تعداد برچسب‌ها</td></tr>
                <tr><td class="l">امتیازها</td><td class="l wrap">همه امتیازهای لحظه‌ای (${N(D.instants.length)} ردیف) با داور، برچسب، بازیکن و یادداشت</td></tr>
                <tr><td class="l">نمرات مراحل</td><td class="l wrap">نمره هر داور برای هر تیم و مرحله، با نمره معیارها (${N(D.judge.length)} ردیف)</td></tr>
                <tr><td class="l">بازیکن‌ها</td><td class="l wrap">امتیاز فردی، رأی MVP و میانگین نظر هم‌تیمی‌ها و خودارزیابی</td></tr>
                <tr><td class="l">لحظه‌ها</td><td class="l wrap">لحظه‌های ستاره‌دار و کارت‌های شانس</td></tr>
                <tr><td class="l">تاریخچه</td><td class="l wrap">کارهای اتاق فرمان (بستن مرحله، اصلاح نمره، بودجه و…)</td></tr>
            </tbody></table></div>`);
        $('#xlsxBtn').onclick = exportExcel;
        $('#printBtn').onclick = printReport;
    }

    // ---- Tab 6: compare two editions -----------------------------------------------------------------------------
    const norm = s => String(s || '').replace(/[‌‏‎]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim().toLowerCase();
    let other = null;
    function renderCompare() {
        if (access === 'client') { $('#pane-compare').innerHTML = ''; return; }
        $('#pane-compare').innerHTML = box('⚔️ مقایسه با یک دوره دیگر', 'شناسه مسابقه دیگری را که به آن دسترسی دارید وارد کنید. تیم‌ها و بازیکن‌ها با نام تطبیق داده می‌شوند تا اثر آموزش بین دو دوره دیده شود. نمره مهارت نسبت به بهترین تیم همان مسابقه است (۰ تا ۱۰۰).',
            `<div class="an-controls">
                <input id="cmpId" type="text" placeholder="شناسه مسابقه دیگر" aria-label="شناسه مسابقه دیگر" dir="ltr" autocomplete="off" style="min-width:180px">
                <select id="cmpOrder" aria-label="ترتیب دو مسابقه"><option value="before">آن مسابقه «قبل» و این «بعد» است</option><option value="after">این مسابقه «قبل» و آن «بعد» است</option></select>
                <button type="button" class="an-btn primary" id="cmpBtn"><i data-lucide="git-compare"></i>مقایسه کن</button>
            </div><div id="cmpOut"></div>`);
        $('#cmpBtn').onclick = runCompare;
        $('#cmpId').addEventListener('keydown', e => { if (e.key === 'Enter') runCompare(); });
        $('#cmpOrder').onchange = () => { if (other) drawCompare(); };
        refreshIcons();
    }

    function runCompare() {
        const id = $('#cmpId').value.trim();
        const outEl = $('#cmpOut');
        if (!id) { outEl.innerHTML = empty('شناسه مسابقه را بنویسید.'); return; }
        if (id === campId) { outEl.innerHTML = empty('این همان مسابقه فعلی است؛ شناسه یک دوره دیگر را وارد کنید.'); return; }
        outEl.innerHTML = empty('در حال آوردن داده‌های مسابقه دیگر…');
        loadAnalysis(id).then(data => { other = data; drawCompare(); }).catch(err => {
            other = null;
            const msg = err.status === 401 || err.status === 403 ? 'به آن مسابقه دسترسی ندارید. با همان حسابی که به هر دو مسابقه دسترسی دارد (مثلاً سوپرادمین) وارد شوید.'
                : err.status === 404 ? 'مسابقه‌ای با این شناسه پیدا نشد.' : (err.message || 'خطا در دریافت اطلاعات');
            outEl.innerHTML = `<div class="an-empty" style="color:var(--an-neg)">${esc(msg)}</div>`;
        });
    }

    function drawCompare() {
        const otherFirst = $('#cmpOrder').value === 'before';
        const A = otherFirst ? other : camp, B = otherFirst ? camp : other;
        const name = c => c.title || c.id || '';
        const skills = (B.skills || []).filter(s => (A.skills || []).some(x => x.id === s.id || norm(x.name) === norm(s.name)));
        const skillOf = (c, s) => (c.skills || []).find(x => x.id === s.id) || (c.skills || []).find(x => norm(x.name) === norm(s.name));
        const rA = Feat.rankMap(A.teams || []), rB = Feat.rankMap(B.teams || []);
        const delta = (a, b, rankLike) => {
            if (a === null || b === null || a === undefined || b === undefined) return '<span class="delta-eq">—</span>';
            const d = r2(rankLike ? a - b : b - a);
            if (!d) return '<span class="delta-eq">=</span>';
            return d > 0 ? `<bdi dir="ltr" class="delta-up">▲ ${N(Math.abs(d))}</bdi>` : `<bdi dir="ltr" class="delta-down">▼ ${N(Math.abs(d))}</bdi>`;
        };
        const pairs = [];
        (B.teams || []).forEach(tb => { const ta = (A.teams || []).find(x => norm(x.name) === norm(tb.name)); if (ta) pairs.push([ta, tb]); });
        let html = `<p class="an-hint">«قبل»: <b>${esc(name(A))}</b> (${esc(A.id || '')}) — «بعد»: <b>${esc(name(B))}</b> (${esc(B.id || '')}). ${N(pairs.length)} تیم هم‌نام پیدا شد.</p>`;
        if (!pairs.length) {
            html += empty('هیچ تیم هم‌نامی بین دو مسابقه پیدا نشد. نام تیم‌ها باید یکسان باشد.');
        } else {
            const head = `<th class="l">تیم</th><th>امتیاز قبل</th><th>امتیاز بعد</th><th>تغییر</th><th>رتبه قبل → بعد</th>${skills.map(s => `<th>${esc(s.name)}<br><small>قبل → بعد</small></th>`).join('')}`;
            const rows = pairs.map(([ta, tb]) => {
                const pa = Feat.skillProfile(ta, A), pb = Feat.skillProfile(tb, B);
                return `<tr><td class="l"><span class="team-cell">${teamDot(tb)}${esc(tb.name)}</span></td><td>${N(num(ta.score))}</td><td>${N(num(tb.score))}</td><td>${delta(num(ta.score), num(tb.score))}</td>
                    <td>${N(rA[ta.id])} → ${N(rB[tb.id])} ${delta(rA[ta.id], rB[tb.id], true)}</td>
                    ${skills.map(s => { const a = pa[(skillOf(A, s) || {}).id], b = pb[s.id]; return `<td>${N(a)} → ${N(b)} ${delta(a, b)}</td>`; }).join('')}</tr>`;
            }).join('');
            html += `<div class="an-scroll"><table class="an-t"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
            if (!skills.length) html += '<p class="an-hint">مهارت مشترکی بین دو مسابقه تعریف نشده است.</p>';
        }
        // Players by name.
        const prow = [];
        (B.teams || []).forEach(tb => (tb.members || []).forEach(mb => {
            let found = null;
            (A.teams || []).forEach(ta => (ta.members || []).forEach(ma => { if (!found && norm(ma.name) === norm(mb.name)) found = { ta, ma }; }));
            if (!found) return;
            const fa = memberFeedback(found.ta)[found.ma.id], fbB = memberFeedback(tb)[mb.id];
            const pa = Feat.memberPoints(found.ta)[found.ma.id] || 0, pb = Feat.memberPoints(tb)[mb.id] || 0;
            prow.push(`<tr><td class="l"><b>${esc(mb.name)}</b> <small>${esc(found.ta.name)} → ${esc(tb.name)}</small></td><td>${N(pa)} → ${N(pb)} ${delta(pa, pb)}</td>
                <td>${fa.peerAvg === null ? '—' : N(r2(fa.peerAvg))} → ${fbB.peerAvg === null ? '—' : N(r2(fbB.peerAvg))} ${delta(fa.peerAvg === null ? null : r2(fa.peerAvg), fbB.peerAvg === null ? null : r2(fbB.peerAvg))}</td>
                <td>${N(fa.mvpVotes)} → ${N(fbB.mvpVotes)} ${delta(fa.mvpVotes, fbB.mvpVotes)}</td></tr>`);
        }));
        html += `<h3 class="team-group-title">🧑 بازیکن‌های هم‌نام</h3>` + (prow.length
            ? `<div class="an-scroll"><table class="an-t"><thead><tr><th class="l">بازیکن</th><th>امتیاز فردی</th><th>نظر هم‌تیمی‌ها (از ۵)</th><th>رأی MVP</th></tr></thead><tbody>${prow.join('')}</tbody></table></div>`
            : empty('بازیکن هم‌نامی پیدا نشد.'));
        $('#cmpOut').innerHTML = html;
    }

    // ---- Shell: header, tabs ------------------------------------------------------------------------------------
    function renderHead() {
        document.title = `اتاق آنالیز — ${camp.title || camp.id}`;
        const logo = safeUrl(camp.logo || '');
        const head = $('#anHead');
        if (logo && !head.querySelector('img')) head.insertAdjacentHTML('afterbegin', `<img src="${esc(logo)}" alt="">`);
        $('#anSub').textContent = [camp.title, camp.orgName].filter(Boolean).join(' — ') || camp.id;
        const accessLabel = { manager: 'اتاق فرمان', admin: 'مدیر سامانه', client: 'گزارش مشتری (فقط خواندنی)' }[access] || access;
        $('#anPills').innerHTML = [
            `<span class="an-pill acc">${esc(accessLabel)}</span>`,
            `<span class="an-pill">${N(D.teams.length)} تیم</span>`,
            `<span class="an-pill">${N(D.stages.length)} مرحله</span>`,
            camp.locked ? '<span class="an-pill">🏁 مسابقه تمام شده</span>' : '<span class="an-pill">🟢 در جریان</span>'
        ].join('');
    }

    const RENDER = { review: renderReview, cards: renderCards, stats: renderStats, judges: renderJudges, export: renderExport, compare: renderCompare };
    const rendered = new Set();
    function showTab(name) {
        if (!RENDER[name] || (name === 'compare' && access === 'client')) name = 'review';
        document.querySelectorAll('.an-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
        document.querySelectorAll('.an-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + name));
        if (!rendered.has(name)) {
            rendered.add(name);
            try { RENDER[name](); } catch (e) { console.error(e); $('#pane-' + name).innerHTML = box('⚠️ خطا', '', empty('نمایش این بخش با خطا روبه‌رو شد: ' + e.message)); }
            refreshIcons();
        }
        try { localStorage.setItem('analysis_tab', name); } catch (e) { /* ignore */ }
    }

    function fail(text) {
        const s = $('#anStatus');
        s.style.display = '';
        s.innerHTML = esc(text).replace(/\n/g, '<br>');
        $('#anSub').textContent = 'دسترسی به آنالیز';
    }

    function start() {
        updateThemeIcon();
        if (!campId) { fail('شناسه مسابقه در آدرس نیست. این صفحه را از پنل اپراتور یا سوپرادمین باز کنید.'); return; }
        loadAnalysis(campId, clientKey).then(data => {
            access = data.access;
            camp = data;
            D = derive(camp);
            $('#anStatus').style.display = 'none';
            renderHead();
            const tabs = $('#anTabs');
            tabs.hidden = false;
            if (access === 'client') { tabs.querySelector('[data-tab="compare"]').remove(); tabs.style.gridTemplateColumns = ''; tabs.classList.add('five'); }
            tabs.addEventListener('click', e => { const b = e.target.closest('.an-tab'); if (b) showTab(b.dataset.tab); });
            tabs.addEventListener('keydown', e => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                const list = [...tabs.querySelectorAll('.an-tab')];
                const i = list.indexOf(document.activeElement);
                if (i < 0) return;
                const next = list[(i + (e.key === 'ArrowLeft' ? 1 : -1) + list.length) % list.length];
                next.focus(); showTab(next.dataset.tab);
            });
            let first = 'review';
            try { first = localStorage.getItem('analysis_tab') || 'review'; } catch (e) { /* ignore */ }
            showTab(first);
        }).catch(err => {
            if (err.status === 401 || err.status === 403) fail('برای دیدن آنالیز از پنل اپراتور یا سوپرادمین وارد شوید یا لینک گزارش معتبر داشته باشید.');
            else if (err.status === 404) fail('مسابقه‌ای با این شناسه پیدا نشد.');
            else fail('دریافت اطلاعات ممکن نشد: ' + (err.message || 'خطای ناشناخته') + '\nاتصال را بررسی کنید و صفحه را دوباره باز کنید.');
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
