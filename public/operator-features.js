// Optional features in the operator / referee panel (operator.html).
// Referees only see something new when a feature is switched on for the camp, or when it makes
// their job simpler (timer, "teams left", messages); everything for managers sits in the control
// strip and in "management → advanced settings".
(function () {
    const O = {};
    O.state = null;
    let pending = {};          // extras for the next instant score (player, note, photo)
    let managerCfg = null;     // /api/manage (managers only)

    const user = () => (typeof currentUser !== 'undefined' ? currentUser : null);
    const isManager = () => !!user() && (user().role === 'operator' || user().role === 'head_referee');
    const lang = () => (O.state && O.state.numLang) || 'fa';
    const N = v => fmtNum(v, lang());
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(jsonOrThrow);
    const api = (path, body) => post(`/api/${path}?id=${campId}`, body);
    const toast = (m, t) => window.showToast && showToast(m, t || 'success');
    const fail = e => toast(e.message || String(e), 'error');
    const teamName = id => ((O.state && O.state.teams || []).find(t => t.id === id) || {}).name || '—';
    const myName = () => user() && user().username;

    O.onData = function (data) {
        const prev = O.state;
        O.state = data;
        renderJudgeStrip();
        renderControlStrip();
        // Assignment changes re-draw the referee grids.
        if (prev && JSON.stringify(prev.assignments || {}) !== JSON.stringify(data.assignments || {})) {
            if (typeof renderFjOrbs === 'function' && typeof fjSelectedTeamId !== 'undefined' && !fjSelectedTeamId) try { renderFjOrbs(); } catch (e) { /* not open */ }
        }
    };

    // ---------------------------------------------------------------------------------------
    // Referee screen
    // ---------------------------------------------------------------------------------------
    function myAssignment() {
        const s = O.state;
        if (!s || !Feat.on(s, 'assignments') || isManager()) return null;
        return (s.assignments || {})[myName()] || null;
    }
    O.visibleTeams = function (teams) {
        const a = myAssignment();
        return a && a.teams.length ? teams.filter(t => a.teams.includes(t.id)) : teams;
    };
    O.visibleStages = function (stages) {
        const a = myAssignment();
        return a && a.stages.length ? stages.filter(s => a.stages.includes(s.id)) : stages;
    };

    function remainingInActiveStage() {
        const s = O.state;
        if (!s || !s.activeStageId || (s.closedStages || {})[s.activeStageId]) return null;
        const stage = O.visibleStages(s.stages || []).find(x => x.id === s.activeStageId);
        if (!stage) return null;
        const teams = O.visibleTeams(s.teams || []);
        const left = teams.filter(t => !(((t.judgeStageScores || {})[stage.id] || {})[myName()]));
        return { stage, left: left.length, total: teams.length };
    }

    function renderJudgeStrip() {
        const el = document.getElementById('fjInfoStrip');
        const s = O.state;
        if (!el || !s) return;
        const parts = [];
        if (s.timer && Feat.shown(s, 'judgeTimer')) {
            const ms = Feat.timerRemaining(s.timer);
            parts.push(`<span class="fj-chip ${ms < 60000 ? 'urgent' : ''}">⏱ ${s.timer.label ? esc(s.timer.label) + ' · ' : ''}<b dir="ltr">${Feat.fmtClock(ms, lang())}</b>${s.timer.running ? '' : ' ⏸'}</span>`);
        }
        const rem = Feat.shown(s, 'judgeRemaining') ? remainingInActiveStage() : null;
        if (rem) parts.push(rem.left
            ? `<span class="fj-chip">📋 ${esc(rem.stage.name)}: <b>${N(rem.left)}</b> تیم مانده</span>`
            : `<span class="fj-chip done">✅ ${esc(rem.stage.name)}: همه تیم‌ها را داوری کرده‌اید</span>`);
        const cases = Feat.on(s, 'calibration') ? ((s.calibration || {}).cases || []) : [];
        if (cases.length) parts.push(`<button type="button" class="fj-chip action" onclick="OPF.openCalibration()">🎯 کارگاه هماهنگی (${N(cases.length)})</button>`);
        const msg = s.judgeMessage;
        let dismissed = null;
        try { dismissed = sessionStorage.getItem('jm_seen_' + campId); } catch (e) { /* ignore */ }
        if (msg && Feat.shown(s, 'judgeMessages') && String(msg.at) !== dismissed) {
            parts.push(`<span class="fj-msg">💬 <b>${esc(msg.by || 'اپراتور')}:</b> ${esc(msg.text)} <button type="button" onclick="OPF.dismissMessage(${msg.at})" aria-label="بستن پیام">✕</button></span>`);
        }
        const html = parts.join('');
        if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
        el.style.display = parts.length ? 'flex' : 'none';
    }
    O.dismissMessage = at => { try { sessionStorage.setItem('jm_seen_' + campId, String(at)); } catch (e) { /* ignore */ } renderJudgeStrip(); };
    setInterval(() => { if (O.state && O.state.timer) renderJudgeStrip(); }, 500);

    // Player chips and "appeal" link under the selected team.
    O.onTeamSelected = function (team) {
        pending = {};
        const el = document.getElementById('fjExtrasArea');
        if (!el) return;
        const s = O.state || {};
        const fresh = (s.teams || []).find(t => t.id === team.id) || team;
        let html = '';
        if (Feat.on(s, 'individual') && (fresh.members || []).length) {
            html += `<div class="fj-players"><span class="fj-players-label">بازیکن (اختیاری):</span>${fresh.members.map(m =>
                `<button type="button" class="fj-player" data-member="${esc(m.id)}">${esc(m.name)}${m.role ? ` <small>${esc(m.role)}</small>` : ''}</button>`).join('')}</div>`;
        }
        if (Feat.on(s, 'appeals')) html += `<button type="button" class="fj-appeal" onclick="OPF.fileAppeal(${jsArg(team.id)})">⚖️ ثبت اعتراض درباره این تیم</button>`;
        if (Feat.shown(s, 'notes')) html += `<div class="fj-hold-hint">برای افزودن یادداشت یا عکس، دکمه «ثبت» را نگه دارید.</div>`;
        el.innerHTML = html;
        el.querySelectorAll('.fj-player').forEach(b => b.onclick = () => {
            const on = !b.classList.contains('active');
            el.querySelectorAll('.fj-player').forEach(x => x.classList.remove('active'));
            if (on) { b.classList.add('active'); pending.memberId = b.dataset.member; } else delete pending.memberId;
        });
    };
    O.takeScoreExtras = function () { const p = pending; pending = {}; return p; };

    O.fileAppeal = function (teamId) {
        const text = prompt(`متن اعتراض درباره «${teamName(teamId)}» (برای سرداور/اپراتور ارسال می‌شود):`);
        if (!text || !text.trim()) return;
        api('appeal', { teamId, stageId: O.state.activeStageId || null, text: text.trim() }).then(() => toast('اعتراض ثبت شد و روی تابلو «در حال بررسی» نمایش داده می‌شود.')).catch(fail);
    };

    // Long press on "ثبت": note and photo for this score.
    function setupLongPress() {
        const btn = document.getElementById('fjSubmitBtn');
        if (!btn || btn._lp) return;
        btn._lp = true;
        let timer = null, fired = false;
        const start = () => {
            if (!O.state || !Feat.shown(O.state, 'notes')) return;
            fired = false;
            timer = setTimeout(() => { fired = true; openNoteDialog(); }, 650);
        };
        const cancel = () => clearTimeout(timer);
        btn.addEventListener('pointerdown', start);
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, cancel));
        btn.addEventListener('contextmenu', e => { if (fired) e.preventDefault(); });
        // The click that ends a long press must not also submit.
        document.addEventListener('click', e => {
            if (fired && btn.contains(e.target)) { e.stopPropagation(); e.preventDefault(); fired = false; }
        }, true);
    }
    function openNoteDialog() {
        const m = toolModal('یادداشت و عکس برای این امتیاز', `
            <textarea id="fjNoteText" rows="3" class="settings-input" placeholder="مثلاً: کمک به تیم مقابل بعد از زمین خوردن" maxlength="300"></textarea>
            <label class="adv-label">عکس (اختیاری)</label><input type="file" id="fjNotePhoto" accept="image/*" capture="environment">
            <div class="manage-row" style="margin-top:12px"><button type="button" class="manage-primary" id="fjNoteSave">ثبت امتیاز با یادداشت</button></div>`);
        m.querySelector('#fjNoteSave').onclick = async () => {
            const note = m.querySelector('#fjNoteText').value.trim();
            const f = m.querySelector('#fjNotePhoto').files[0];
            if (note) pending.note = note;
            if (f) { try { pending.photo = await compressImageFile(f, 900, 0.75); } catch (e) { /* skip photo */ } }
            m.style.display = 'none';
            if (typeof submitFjScore === 'function') submitFjScore();
        };
    }

    // Multi-criteria stage scores: the stage value is the weighted sum (shown read-only).
    O.criteriaFor = function (stage) {
        const s = O.state;
        return s && Feat.on(s, 'rubric') && stage && Array.isArray(stage.criteria) && stage.criteria.length ? stage.criteria : null;
    };
    O.criteriaControlsHtml = function (team, stage, entry) {
        const crit = O.criteriaFor(stage);
        if (!crit) return '';
        const prev = (entry && entry.criteria) || {};
        return `<div class="fj-criteria" data-team="${esc(team.id)}">${crit.map(c => `
            <label class="fj-crit"><span>${esc(c.name)}${c.weight !== 1 ? ` <small>×${N(c.weight)}</small>` : ''}</span>
            <input type="text" inputmode="decimal" class="fj-crit-input" data-crit="${esc(c.id)}" data-weight="${c.weight}" value="${prev[c.id] !== undefined ? esc(prev[c.id]) : ''}" oninput="OPF.updateCriteriaTotal(${jsArg(team.id)})"></label>`).join('')}</div>`;
    };
    O.updateCriteriaTotal = function (teamId) {
        const box = document.querySelector(`.fj-criteria[data-team="${CSS.escape(teamId)}"]`);
        const input = document.getElementById('judge_score_' + teamId);
        if (!box || !input) return;
        let total = 0;
        box.querySelectorAll('.fj-crit-input').forEach(i => { const v = parseFloat(toEnDigits(i.value)); if (isFinite(v)) total += v * parseFloat(i.dataset.weight || 1); });
        input.value = Math.round(total * 100) / 100;
        input.dataset.dnf = 'false';
    };
    O.breakdownFor = function (teamId) {
        const box = document.querySelector(`.fj-criteria[data-team="${CSS.escape(teamId)}"]`);
        if (!box) return null;
        const out = {};
        box.querySelectorAll('.fj-crit-input').forEach(i => { const v = parseFloat(toEnDigits(i.value)); if (isFinite(v)) out[i.dataset.crit] = v; });
        return out;
    };

    // Referee calibration workshop.
    O.openCalibration = function () {
        const cases = ((O.state || {}).calibration || {}).cases || [];
        const m = toolModal('کارگاه هماهنگی داورها', cases.map(c => `
            <section class="manage-section"><h3>${esc(c.title)}</h3>${c.description ? `<p class="manage-note">${esc(c.description)}</p>` : ''}
            <div class="manage-row"><input type="text" inputmode="decimal" class="cal-score" data-case="${esc(c.id)}" placeholder="نمره شما"><button type="button" class="manage-primary" data-send="${esc(c.id)}">ثبت</button></div></section>`).join('')
            || '<p class="manage-note">نمونه بازی وجود ندارد.</p>');
        m.querySelectorAll('[data-send]').forEach(b => b.onclick = () => {
            const v = m.querySelector(`.cal-score[data-case="${CSS.escape(b.dataset.send)}"]`).value;
            api('calibration', { caseId: b.dataset.send, score: parseFloat(toEnDigits(v)) }).then(() => { toast('نمره شما ثبت شد.'); b.textContent = '✓ ثبت شد'; }).catch(fail);
        });
    };

    // ---------------------------------------------------------------------------------------
    // Generic tool modal
    // ---------------------------------------------------------------------------------------
    function toolModal(title, html) {
        let m = document.getElementById('opToolModal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'opToolModal';
            m.className = 'modal-overlay';
            m.style.zIndex = '10400';
            m.innerHTML = `<div class="modal-content glass manage-content"><span class="close-btn" title="بستن" onclick="document.getElementById('opToolModal').style.display='none'">&times;</span><h2 class="tool-title" style="margin-top:0"></h2><div class="tool-body"></div></div>`;
            m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
            document.body.appendChild(m);
        }
        m.querySelector('.tool-title').textContent = title;
        m.querySelector('.tool-body').innerHTML = html;
        m.style.display = 'flex';
        return m;
    }
    O.toolModal = toolModal;

    function loadManage() {
        return fetch(`/api/manage?id=${campId}`).then(jsonOrThrow).then(d => { managerCfg = d; return d; });
    }

    // ---------------------------------------------------------------------------------------
    // Control strip (operator / head referee)
    // ---------------------------------------------------------------------------------------
    function renderControlStrip() {
        const el = document.getElementById('opControlStrip');
        const s = O.state;
        if (!el || !s) return;
        if (!isManager()) { el.style.display = 'none'; return; }
        const f = k => Feat.on(s, k);
        const openAppeals = (s.varOpen || []).length;
        const regs = s.registration && s.registration.open && managerCfg ? (managerCfg.registration.requests || []).length : 0;
        const btn = (tool, icon, label, extra) => `<button type="button" class="ctl-btn ${extra || ''}" onclick="OPF.tool('${tool}')">${icon} <span>${label}</span></button>`;
        const timerTxt = s.timer ? ` <b dir="ltr">${Feat.fmtClock(Feat.timerRemaining(s.timer), lang())}</b>` : '';
        let html = '<span class="ctl-title">میز کنترل</span>';
        html += btn('timer', '⏱', 'تایمر' + timerTxt, s.timer ? 'active' : '');
        html += btn('ticker', '📣', 'نوار خبری', s.ticker ? 'active' : '');
        html += btn('message', '💬', 'پیام به داورها', s.judgeMessage ? 'active' : '');
        html += btn('moment', '⭐', 'لحظه کلیدی');
        html += btn('judges', '👥', 'وضعیت داورها');
        html += btn('freeze', '🙈', s.frozen ? 'جدول مخفی است' : 'جدول مخفی', s.frozen ? 'active warn' : '');
        html += btn('ceremony', '🏆', 'مراسم جوایز', s.ceremony ? 'active' : '');
        if (f('appeals')) html += btn('appeals', '⚖️', 'اعتراض‌ها' + (openAppeals ? ` <b class="ctl-badge">${N(openAppeals)}</b>` : ''), openAppeals ? 'warn' : '');
        if (f('chanceCards')) html += btn('chance', '🎴', 'کارت شانس');
        if (f('budget')) html += btn('budget', '💰', 'بودجه');
        if (f('decisions')) html += btn('rounds', '🗳', 'تصمیم‌گیری');
        if (f('bracket')) html += btn('bracket', '🏁', 'جدول حذفی');
        if (f('peerReview')) html += btn('peer', '🤝', 'رأی هم‌تیمی', s.peerReview && s.peerReview.open ? 'active' : '');
        if (f('registration')) html += btn('registrations', '📝', 'ثبت‌نام‌ها' + (regs ? ` <b class="ctl-badge">${N(regs)}</b>` : ''));
        html += `<a class="ctl-btn" href="analysis.html?id=${encodeURIComponent(campId)}#t=${encodeURIComponent(Auth.get())}" target="_blank" rel="noopener">📊 <span>اتاق آنالیز</span></a>`;
        if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
        el.style.display = 'flex';
    }
    setInterval(() => { if (O.state && O.state.timer && isManager()) renderControlStrip(); }, 1000);

    const TOOLS = {};
    O.tool = function (name) { TOOLS[name](); };

    TOOLS.timer = function () {
        const s = O.state;
        const stage = (s.stages || []).find(x => x.id === s.activeStageId);
        const m = toolModal('تایمر مرحله', `
            <div class="tool-clock" id="toolClock"></div>
            <div class="manage-row"><input type="text" id="tmLabel" placeholder="عنوان (مثلاً نام مرحله)" value="${esc((s.timer && s.timer.label) || (stage ? stage.name : ''))}">
                <input type="text" inputmode="decimal" id="tmMinutes" size="5" value="${esc((stage && stage.durationMin) || 10)}" aria-label="دقیقه"> دقیقه</div>
            <div class="manage-row" style="margin-top:10px">
                <button type="button" class="manage-primary" data-op="start">▶ شروع</button>
                <button type="button" data-op="pause">⏸ توقف</button><button type="button" data-op="resume">⏯ ادامه</button>
                <button type="button" data-op="add" data-min="1">+۱ دقیقه</button><button type="button" data-op="add" data-min="-1">−۱ دقیقه</button>
                <button type="button" class="manage-danger" data-op="stop">■ پایان</button></div>
            <p class="manage-note">تایمر روی تابلو و صفحه داورها نمایش داده می‌شود (قابل خاموش کردن در تنظیمات پیشرفته).</p>`);
        const clock = () => { const el = m.querySelector('#toolClock'); if (el) el.textContent = O.state.timer ? Feat.fmtClock(Feat.timerRemaining(O.state.timer), lang()) : '—'; };
        clock();
        const iv = setInterval(() => { if (m.style.display === 'none') clearInterval(iv); else clock(); }, 500);
        m.querySelectorAll('[data-op]').forEach(b => b.onclick = () => {
            const body = { action: 'timer', op: b.dataset.op };
            if (b.dataset.op === 'start') { body.minutes = parseFloat(toEnDigits(m.querySelector('#tmMinutes').value)); body.label = m.querySelector('#tmLabel').value; }
            if (b.dataset.op === 'add') body.minutes = parseFloat(b.dataset.min);
            api('live', body).then(r => { O.state.timer = r.timer; clock(); renderControlStrip(); }).catch(fail);
        });
    };

    function textTool(title, action, current, hint) {
        const m = toolModal(title, `<textarea id="ttText" rows="3" class="settings-input" maxlength="300">${esc(current || '')}</textarea>
            <p class="manage-note">${hint}</p>
            <div class="manage-row"><button type="button" class="manage-primary" id="ttSave">نمایش</button><button type="button" id="ttClear">پاک کردن</button></div>`);
        const send = text => api('live', { action, text }).then(() => { toast(text ? 'ارسال شد.' : 'پاک شد.'); m.style.display = 'none'; }).catch(fail);
        m.querySelector('#ttSave').onclick = () => send(m.querySelector('#ttText').value.trim());
        m.querySelector('#ttClear').onclick = () => send('');
    }
    TOOLS.ticker = () => textTool('نوار خبری تابلو', 'ticker', O.state.ticker && O.state.ticker.text, 'متن به‌صورت نوار متحرک پایین تابلوی زنده نمایش داده می‌شود.');
    TOOLS.message = () => textTool('پیام به داورها', 'message', O.state.judgeMessage && O.state.judgeMessage.text, 'بالای صفحه همه داورها نمایش داده می‌شود (روی تابلو دیده نمی‌شود).');

    TOOLS.moment = function () {
        const s = O.state;
        const m = toolModal('ثبت لحظه کلیدی', `<input type="text" id="mmText" class="settings-input" placeholder="مثلاً: تیم آبی با یک تصمیم جسورانه برگشت" maxlength="300">
            <select id="mmTeam" class="settings-input"><option value="">— همه / بدون تیم خاص —</option>${(s.teams || []).map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select>
            <p class="manage-note">لحظه‌های کلیدی در اتاق آنالیز و جلسه مرور بعد از مسابقه نمایش داده می‌شوند.</p>
            <div class="manage-row"><button type="button" class="manage-primary" id="mmSave">⭐ ثبت</button></div>`);
        m.querySelector('#mmSave').onclick = () => api('live', { action: 'moment', text: m.querySelector('#mmText').value.trim(), teamId: m.querySelector('#mmTeam').value || null })
            .then(() => { toast('لحظه کلیدی ثبت شد.'); m.style.display = 'none'; }).catch(fail);
    };

    TOOLS.freeze = function () {
        const on = !O.state.frozen;
        if (!confirm(on ? 'جدول مخفی شود؟\n\nتابلو و صفحه‌های عمومی امتیازها را در همین لحظه ثابت نشان می‌دهند و انیمیشن امتیازها پخش نمی‌شود. شما و داورها امتیاز واقعی را می‌بینید.' : 'جدول دوباره نمایش داده شود؟ همه امتیازهای ثبت‌شده روی تابلو ظاهر می‌شوند.')) return;
        api('live', { action: 'freeze', on }).then(() => toast(on ? 'جدول مخفی شد.' : 'جدول نمایش داده شد.')).catch(fail);
    };

    TOOLS.ceremony = function () {
        const render = () => {
            const c = O.state.ceremony;
            m.querySelector('#cerState').textContent = c ? `${N(c.revealed)} از ${N(c.total)} تیم اعلام شده` : 'مراسم شروع نشده است.';
        };
        const m = toolModal('مراسم اهدای جوایز', `<p class="manage-note">رتبه‌ها از آخر به اول، با هر کلیک یک تیم، روی همه تابلوها اعلام می‌شوند.</p>
            <div class="tool-clock" id="cerState"></div>
            <div class="manage-row"><button type="button" class="manage-primary" data-op="start">شروع مراسم</button>
            <button type="button" data-op="next">◀ اعلام تیم بعدی</button><button type="button" data-op="prev">برگشت ▶</button>
            <button type="button" data-op="all">اعلام همه</button><button type="button" class="manage-danger" data-op="end">پایان مراسم</button></div>`);
        render();
        m.querySelectorAll('[data-op]').forEach(b => b.onclick = () => api('live', { action: 'ceremony', op: b.dataset.op }).then(r => { O.state.ceremony = r.ceremony; render(); }).catch(fail));
    };

    TOOLS.judges = function () {
        const s = O.state;
        loadManage().then(cfg => {
            const refs = cfg.users.filter(u => u.role !== 'operator');
            const stageOpts = (s.stages || []).map(st => `<option value="${esc(st.id)}" ${st.id === s.activeStageId ? 'selected' : ''}>${esc(st.name)}</option>`).join('');
            const m = toolModal('وضعیت داورها', `<div class="manage-row"><select id="jsStage">${stageOpts}</select></div><div id="jsTable"></div>
                <p class="manage-note">✓ یعنی داور برای آن تیم نمره ثبت کرده است. ستون آخر تعداد امتیازهای لحظه‌ای هر داور در ۳۰ دقیقه اخیر است.</p>`);
            const draw = () => {
                const sid = m.querySelector('#jsStage').value;
                const since = Feat.now() - 30 * 60000;
                const recent = u => (s.teams || []).reduce((n, t) => n + (t.scoreLogs || []).filter(l => l.type === 'instant' && l.user && l.user.username === u && (l.createdAt || l.timestamp) > since).length, 0);
                m.querySelector('#jsTable').innerHTML = `<div class="tool-table-wrap"><table class="tool-table"><thead><tr><th>داور</th>${(s.teams || []).map(t => `<th>${esc(t.name)}</th>`).join('')}<th>میدانی (۳۰ دقیقه)</th></tr></thead><tbody>${refs.map(u => {
                    const a = cfg.assignments[u.username];
                    return `<tr><th>${esc(u.name)}</th>${(s.teams || []).map(t => {
                        const mine = a && a.teams.length && !a.teams.includes(t.id);
                        const done = ((t.judgeStageScores || {})[sid] || {})[u.username];
                        return `<td class="${done ? 'ok' : (mine ? 'na' : 'wait')}">${done ? '✓' : (mine ? '' : '—')}</td>`;
                    }).join('')}<td>${N(recent(u.username))}</td></tr>`;
                }).join('')}</tbody></table></div>`;
            };
            m.querySelector('#jsStage').onchange = draw;
            draw();
        }).catch(fail);
    };

    TOOLS.appeals = function () {
        loadManage().then(cfg => {
            const list = [...cfg.appeals].reverse();
            const m = toolModal('اعتراض‌ها (VAR)', list.map(a => `
                <section class="manage-section appeal ${a.status}"><div class="manage-row" style="justify-content:space-between"><b>${esc(teamName(a.teamId))}</b>
                <span class="manage-badge">${{ open: 'در حال بررسی', accepted: 'پذیرفته شد', rejected: 'رد شد' }[a.status]}</span></div>
                <p>${esc(a.text)}</p><p class="manage-note">ثبت: ${esc(a.by.name)} · ${esc(new Date(a.at).toLocaleTimeString('fa-IR'))}${a.resolution ? ' · پاسخ: ' + esc(a.resolution) : ''}</p>
                ${a.status === 'open' ? `<div class="manage-row"><input type="text" class="ap-res" placeholder="توضیح (اختیاری)"><button type="button" class="manage-primary" data-ap="${esc(a.id)}" data-st="accepted">پذیرفتن</button><button type="button" class="manage-danger" data-ap="${esc(a.id)}" data-st="rejected">رد</button></div>` : ''}
                </section>`).join('') || '<p class="manage-note">اعتراضی ثبت نشده است.</p>');
            m.querySelectorAll('[data-ap]').forEach(b => b.onclick = () => {
                const res = b.closest('section').querySelector('.ap-res').value;
                api('appeal/resolve', { appealId: b.dataset.ap, status: b.dataset.st, resolution: res }).then(() => { toast('ثبت شد. در صورت نیاز، نمره را از «تاریخچه» یا «اصلاح دستی» درست کنید.'); TOOLS.appeals(); }).catch(fail);
            });
        }).catch(fail);
    };

    const teamChecks = (cls) => `<div class="adv-chips">${(O.state.teams || []).map(t => `<label class="adv-chip"><input type="checkbox" class="${cls}" value="${esc(t.id)}" checked>${esc(t.name)}</label>`).join('')}</div>`;

    TOOLS.chance = function () {
        loadManage().then(cfg => {
            const m = toolModal('کارت شانس', cfg.chanceCards.length ? `
                <select id="ccCard" class="settings-input">${cfg.chanceCards.map(c => `<option value="${esc(c.id)}">${esc(c.title)}${c.points ? ` (${c.points > 0 ? '+' : ''}${N(c.points)} امتیاز)` : ''}${c.budget ? ` (${c.budget > 0 ? '+' : ''}${N(c.budget)} بودجه)` : ''}</option>`).join('')}</select>
                <p class="manage-note">برای کدام تیم‌ها؟</p>${teamChecks('cc-team')}
                <div class="manage-row" style="margin-top:10px"><button type="button" class="manage-primary" id="ccGo">🎴 رو کردن کارت</button></div>`
                : '<p class="manage-note">هنوز کارتی تعریف نشده است. از «مدیریت مسابقه ← تنظیمات پیشرفته ← کارت‌های شانس» تعریف کنید.</p>');
            const go = m.querySelector('#ccGo');
            if (go) go.onclick = () => {
                const ids = [...m.querySelectorAll('.cc-team:checked')].map(i => i.value);
                if (!ids.length) return toast('دست‌کم یک تیم را انتخاب کنید.', 'error');
                api('chance', { cardId: m.querySelector('#ccCard').value, teamIds: ids }).then(() => { toast('کارت روی تابلو رو شد.'); m.style.display = 'none'; }).catch(fail);
            };
        }).catch(fail);
    };

    TOOLS.budget = function () {
        const s = O.state;
        const opts = (s.teams || []).map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
        const m = toolModal('بودجه تیم‌ها', `
            <div class="tool-table-wrap"><table class="tool-table"><tbody>${(s.teams || []).map(t => `<tr><th>${esc(t.name)}</th><td>💰 ${N(t.budget || 0)}</td></tr>`).join('')}</tbody></table></div>
            <section class="manage-section"><h3>افزایش / کاهش</h3><div class="manage-row"><select id="bgTeam">${opts}</select><input type="text" inputmode="decimal" id="bgDelta" placeholder="مبلغ (منفی = کسر)" size="10"><input type="text" id="bgNote" placeholder="بابت"><button type="button" class="manage-primary" id="bgSave">ثبت</button></div></section>
            <section class="manage-section"><h3>انتقال بین تیم‌ها</h3><div class="manage-row"><select id="bgFrom">${opts}</select> ← <select id="bgTo">${opts}</select><input type="text" inputmode="decimal" id="bgAmount" placeholder="مبلغ" size="8"><button type="button" id="bgTransfer">انتقال</button></div></section>
            <p class="manage-note">بودجه جدا از امتیاز است و در امتیاز کل حساب نمی‌شود.</p>`);
        m.querySelector('#bgSave').onclick = () => api('budget', { teamId: m.querySelector('#bgTeam').value, delta: parseFloat(toEnDigits(m.querySelector('#bgDelta').value)), note: m.querySelector('#bgNote').value })
            .then(r => { toast('ثبت شد.'); Object.entries(r.budgets).forEach(([id, b]) => { const t = s.teams.find(x => x.id === id); if (t) t.budget = b; }); TOOLS.budget(); }).catch(fail);
        m.querySelector('#bgTransfer').onclick = () => api('budget', { from: m.querySelector('#bgFrom').value, to: m.querySelector('#bgTo').value, amount: parseFloat(toEnDigits(m.querySelector('#bgAmount').value)) })
            .then(r => { toast('منتقل شد.'); Object.entries(r.budgets).forEach(([id, b]) => { const t = s.teams.find(x => x.id === id); if (t) t.budget = b; }); TOOLS.budget(); }).catch(fail);
    };

    TOOLS.rounds = function () {
        const s = O.state;
        const label = { draft: 'پیش‌نویس', open: 'باز — تیم‌ها در حال انتخاب', closed: 'بسته' };
        const m = toolModal('دورهای تصمیم‌گیری', (s.rounds || []).map(r => `
            <section class="manage-section"><div class="manage-row" style="justify-content:space-between"><b>${esc(r.title)}</b><span class="manage-badge">${label[r.status]}${r.revealed ? ' · روی تابلو' : ''}</span></div>
            <p class="manage-note">${esc(r.question || '')} — ${N(r.submitted)} از ${N((s.teams || []).length)} تیم انتخاب کرده‌اند.</p>
            <div class="manage-row">
                ${r.status !== 'open' ? `<button type="button" class="manage-primary" data-r="${esc(r.id)}" data-op="open">باز کردن</button>` : ''}
                ${r.status === 'open' ? `<button type="button" class="manage-primary" data-r="${esc(r.id)}" data-op="close">بستن و اعمال اثرها</button>` : ''}
                ${r.status === 'closed' && !r.revealed ? `<button type="button" data-r="${esc(r.id)}" data-op="reveal">نمایش انتخاب‌ها روی تابلو</button>` : ''}
                ${r.revealed ? `<button type="button" data-r="${esc(r.id)}" data-op="hide">پنهان از تابلو</button>` : ''}
                <button type="button" class="manage-danger" data-r="${esc(r.id)}" data-op="reset">از نو</button></div></section>`).join('')
            || '<p class="manage-note">هنوز دوری تعریف نشده است. از «مدیریت مسابقه ← تنظیمات پیشرفته ← دورهای تصمیم‌گیری» تعریف کنید.</p>');
        m.querySelectorAll('[data-op]').forEach(b => b.onclick = () => {
            if (b.dataset.op === 'reset' && !confirm('انتخاب‌های این دور پاک شود؟ (اثرهای اعمال‌شده از «تاریخچه تغییرات» قابل برگرداندن است)')) return;
            api('rounds', { roundId: b.dataset.r, op: b.dataset.op }).then(() => { toast('انجام شد.'); setTimeout(TOOLS.rounds, 400); }).catch(fail);
        });
    };

    TOOLS.bracket = function () {
        const s = O.state;
        const b = s.bracket;
        const m = toolModal('جدول حذفی', `
            <section class="manage-section"><h3>ساخت جدول</h3><div class="manage-row">
                <select id="brSize">${[2, 4, 8, 16, 32].filter(n => n <= Math.max(2, (s.teams || []).length * 2)).map(n => `<option value="${n}" ${n === 4 ? 'selected' : ''}>${N(n)} تیم</option>`).join('')}</select>
                <input type="text" id="brTitle" placeholder="عنوان (اختیاری)" value="${esc((b && b.title) || '')}">
                <button type="button" class="manage-primary" id="brGen">ساخت از روی رتبه فعلی</button>${b ? '<button type="button" class="manage-danger" id="brClear">حذف جدول</button>' : ''}</div>
                <p class="manage-note">تیم اول با آخر، دوم با یکی‌مانده‌به‌آخر و ... (تیم‌های بدون حریف مستقیم صعود می‌کنند).</p></section>
            <div id="brMatches"></div>`);
        const draw = br => {
            m.querySelector('#brMatches').innerHTML = br ? br.rounds.map((r, i) => `<section class="manage-section"><h3>${i === br.rounds.length - 1 ? 'فینال' : 'دور ' + N(i + 1)}</h3>${r.matches.map(x => `
                <div class="manage-row br-pick">${['a', 'b'].map(k => x[k] ? `<button type="button" class="${x.winner === x[k] ? 'manage-primary' : ''}" data-m="${esc(x.id)}" data-t="${esc(x[k])}">${x.winner === x[k] ? '🏆 ' : ''}${esc(teamName(x[k]))}</button>` : '<span class="manage-note">—</span>').join('<span>در برابر</span>')}</div>`).join('')}</section>`).join('') : '';
            m.querySelectorAll('[data-m]').forEach(btn => btn.onclick = () => api('bracket', { op: 'winner', matchId: btn.dataset.m, teamId: btn.dataset.t }).then(r => { O.state.bracket = r.bracket; draw(r.bracket); }).catch(fail));
        };
        draw(b);
        m.querySelector('#brGen').onclick = () => {
            if (b && !confirm('جدول فعلی پاک و جدول جدید ساخته شود؟')) return;
            api('bracket', { op: 'generate', size: parseInt(m.querySelector('#brSize').value, 10), title: m.querySelector('#brTitle').value }).then(r => { O.state.bracket = r.bracket; TOOLS.bracket(); }).catch(fail);
        };
        const clr = m.querySelector('#brClear');
        if (clr) clr.onclick = () => confirm('جدول حذفی حذف شود؟') && api('bracket', { op: 'clear' }).then(() => { O.state.bracket = null; TOOLS.bracket(); }).catch(fail);
    };

    TOOLS.peer = function () {
        const s = O.state;
        const open = s.peerReview && s.peerReview.open;
        const m = toolModal('رأی هم‌تیمی‌ها و خودارزیابی', `<p class="manage-note">بازیکن‌ها در صفحه تیم (با کد تیم) به مهارت‌های خودشان و هم‌تیمی‌ها از ۱ تا ۵ امتیاز می‌دهند و بهترین بازیکن تیم را انتخاب می‌کنند. نتیجه در کارنامه‌ها دیده می‌شود.</p>
            <div class="manage-row"><select id="prStage"><option value="general">کل مسابقه</option>${(s.stages || []).map(st => `<option value="${esc(st.id)}" ${open === st.id ? 'selected' : ''}>${esc(st.name)}</option>`).join('')}</select>
            <button type="button" class="manage-primary" id="prOpen">باز کردن رأی‌گیری</button>${open ? '<button type="button" class="manage-danger" id="prClose">بستن</button>' : ''}</div>
            ${open ? '<p class="manage-note">رأی‌گیری الان باز است.</p>' : ''}`);
        m.querySelector('#prOpen').onclick = () => api('peer', { open: m.querySelector('#prStage').value }).then(() => { toast('رأی‌گیری باز شد.'); m.style.display = 'none'; }).catch(fail);
        const c = m.querySelector('#prClose');
        if (c) c.onclick = () => api('peer', { open: null }).then(() => { toast('رأی‌گیری بسته شد.'); m.style.display = 'none'; }).catch(fail);
    };

    TOOLS.registrations = function () {
        loadManage().then(cfg => {
            const reqs = cfg.registration.requests || [];
            const m = toolModal('درخواست‌های ثبت‌نام', reqs.map(r => `<section class="manage-section"><div class="manage-row" style="justify-content:space-between"><b>${esc(r.name)}</b><span class="manage-note">${esc(new Date(r.at).toLocaleString('fa-IR'))}</span></div>
                ${r.members.length ? `<p class="manage-note">اعضا: ${esc(r.members.join('، '))}</p>` : ''}${r.contact ? `<p class="manage-note">تماس: <span dir="ltr">${esc(r.contact)}</span></p>` : ''}
                <div class="manage-row"><button type="button" class="manage-primary" data-rq="${esc(r.id)}" data-ok="1">تأیید و افزودن تیم</button><button type="button" class="manage-danger" data-rq="${esc(r.id)}">رد</button></div></section>`).join('')
                || `<p class="manage-note">درخواستی وجود ندارد. ${cfg.registration.open ? '' : 'فرم ثبت‌نام بسته است (تنظیمات پیشرفته ← ثبت‌نام آنلاین).'}</p>`);
            m.querySelectorAll('[data-rq]').forEach(b => b.onclick = () => api('register/review', { requestId: b.dataset.rq, approve: !!b.dataset.ok }).then(() => { toast(b.dataset.ok ? 'تیم اضافه شد.' : 'رد شد.'); TOOLS.registrations(); }).catch(fail));
        }).catch(fail);
    };

    // ---------------------------------------------------------------------------------------
    // Management → advanced settings, and undo in the history
    // ---------------------------------------------------------------------------------------
    O.renderAdvancedTab = function (pane) {
        pane.innerHTML = '<p class="manage-note">در حال بارگذاری…</p>';
        loadManage().then(cfg => {
            pane.innerHTML = `<p class="manage-note">این بخش‌ها همه بسته‌اند و فقط وقتی لازم دارید بازشان کنید. صفحه داورها فقط وقتی تغییر می‌کند که امکانی را روشن کنید.</p>
                <div id="advEditor"></div><div class="manage-row adv-save-row"><button type="button" class="manage-primary" id="advSave">ذخیره تنظیمات پیشرفته</button></div>`;
            const ed = pane.querySelector('#advEditor');
            AdvancedEditor.render(ed, cfg, {
                teams: cfg.teams, stages: cfg.stages, users: cfg.users, campId,
                tags: [...new Set([...(typeof currentPositiveTags !== 'undefined' ? currentPositiveTags : []), ...(typeof currentNegativeTags !== 'undefined' ? currentNegativeTags : [])])]
            });
            pane.querySelector('#advSave').onclick = () => {
                const body = AdvancedEditor.collect(ed);
                api('advanced', body).then(() => { toast('تنظیمات پیشرفته ذخیره شد.'); O.renderAdvancedTab(pane); }).catch(fail);
            };
        }).catch(e => { pane.innerHTML = `<p class="manage-note">${esc(e.message)}</p>`; });
    };

    O.undo = function (auditId, label) {
        if (!confirm(`«${label}» برگردانده شود؟`)) return;
        api('undo', { auditId }).then(() => { toast('تغییر برگردانده شد.'); if (typeof renderManageAudit === 'function') renderManageAudit(); }).catch(fail);
    };

    document.addEventListener('DOMContentLoaded', () => { setupLongPress(); Feat.syncClock(); });
    setInterval(Feat.syncClock, 5 * 60000);
    window.OPF = O;
})();
