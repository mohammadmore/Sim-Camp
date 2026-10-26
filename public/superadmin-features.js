// Superadmin panel: organizers, defaults for new camps, templates, leagues, notifications,
// client report links and the advanced settings section of the camp form.
(function () {
    const S = {};
    let role = 'superadmin';
    let settings = null;       // /superadmin/settings
    let templates = [];
    let organizers = [];
    let currentCamp = null;    // camp being edited (adminState) or null for a new one
    let pendingAdvanced = null; // settings from a template, used until the advanced section is opened
    let advRendered = false;

    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(jsonOrThrow);
    const get = url => fetch(url).then(jsonOrThrow);
    const toast = (m, t) => window.showToast && showToast(m, t || 'success');
    const fail = e => toast(e.message || String(e), 'error');
    const isSuper = () => role === 'superadmin';

    // ---- Session / role -----------------------------------------------------------------
    S.onLogin = function (r) {
        role = r || 'superadmin';
        try { sessionStorage.setItem('sa_role', role); } catch (e) { /* ignore */ }
        applyRole();
        S.loadSettings();
    };
    S.restore = function () {
        get('/superadmin/me').then(d => S.onLogin(d.role)).catch(() => { /* expired: handled by onAuthExpired */ });
    };
    function applyRole() {
        document.querySelectorAll('.super-only').forEach(el => { el.style.display = isSuper() ? '' : 'none'; });
        document.querySelectorAll('.org-only').forEach(el => { el.style.display = isSuper() ? 'none' : ''; });
        const h = document.querySelector('#dashboardSection > h2');
        if (h) h.textContent = isSuper() ? 'داشبورد سوپرادمین' : 'داشبورد برگزارکننده';
    }
    S.isSuper = isSuper;

    S.loadSettings = function () {
        return Promise.all([get('/superadmin/settings'), get('/superadmin/templates'), isSuper() ? get('/superadmin/organizers') : Promise.resolve({ organizers: [] })])
            .then(([s, t, o]) => { settings = s; templates = t.templates; organizers = o.organizers; renderDefaults(); })
            .catch(() => {});
    };

    // ---- Login form: optional organizer username -------------------------------------------
    S.loginBody = function (password) {
        const u = document.getElementById('saUsername');
        const username = u ? u.value.trim() : '';
        return username ? { username, password } : { password };
    };
    S.toggleOrgLogin = function () {
        const row = document.getElementById('saUserRow');
        row.style.display = row.style.display === 'none' ? '' : 'none';
        if (row.style.display === '') document.getElementById('saUsername').focus();
    };

    // ---- Global settings: defaults for new camps ------------------------------------------
    function renderDefaults() {
        const el = document.getElementById('safDefaults');
        if (!el || !settings) return;
        el.innerHTML = `<h4><i data-lucide="sliders-horizontal"></i> پیش‌فرض نمایش برای مسابقه‌های جدید</h4>
            <div class="manage-row"><button type="button" data-preset="full">همه روشن (جشنواره‌ای)</button><button type="button" data-preset="formal">رسمی (بدون کاغذرنگی، صدا و عکس شاد/ناراحت)</button></div>
            <div id="safDefaultSwitches"></div>
            <label class="adv-label">مهارت‌های پیش‌فرض (هر کدام در یک خط)</label>
            <textarea id="safDefaultSkills" rows="4" class="settings-input">${esc(settings.defaultSkills.map(s => s.name).join('\n'))}</textarea>
            <button type="button" id="safSaveDefaults" class="sa-save btn-primary">ذخیره پیش‌فرض‌ها</button>`;
        if (typeof refreshIcons === 'function') refreshIcons();
        const sw = el.querySelector('#safDefaultSwitches');
        Feat.renderSwitches(sw, settings.displayDefaults, {}, { hideFeatures: true });
        el.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
            const p = settings.presets[b.dataset.preset] || {};
            sw.querySelectorAll('[data-display]').forEach(i => { i.checked = p[i.dataset.display] !== false; });
        });
        el.querySelector('#safSaveDefaults').onclick = () => {
            const old = new Map(settings.defaultSkills.map(s => [s.name, s.id]));
            const skills = el.querySelector('#safDefaultSkills').value.split('\n').map(x => x.trim()).filter(Boolean)
                .map(n => ({ id: old.get(n) || 'sk_' + Math.random().toString(36).slice(2, 8), name: n }));
            post('/superadmin/settings', { displayDefaults: Feat.readSwitches(sw).display, defaultSkills: skills })
                .then(() => { toast('پیش‌فرض‌ها ذخیره شد.'); S.loadSettings(); }).catch(fail);
        };
    }

    // ---- Organizers -------------------------------------------------------------------------
    S.openOrganizers = function () {
        get('/superadmin/organizers').then(d => {
            organizers = d.organizers;
            Help.show('برگزارکننده‌ها', `<p class="manage-note">هر برگزارکننده با نام کاربری خودش وارد همین پنل می‌شود و فقط مسابقه‌های خودش را می‌بیند و مدیریت می‌کند.</p>
                <div id="orgList">${organizers.map(o => `<div class="trash-row"><div class="trash-info"><b>${esc(o.name || o.username)}</b><span class="trash-meta"><bdi dir="ltr">${esc(o.username)}</bdi>${o.disabled ? '<span>غیرفعال</span>' : ''}</span></div>
                    <div class="manage-row"><button type="button" data-edit="${esc(o.id)}"><i data-lucide="edit-2"></i> ویرایش</button><button type="button" class="camp-delete-btn btn-danger" data-del="${esc(o.id)}"><i data-lucide="trash-2"></i> حذف</button></div></div>`).join('') || '<p class="manage-note">هنوز برگزارکننده‌ای تعریف نشده است.</p>'}</div>
                <div class="sa-form"><h3>افزودن / ویرایش</h3><input type="hidden" id="orgId">
                <input type="text" id="orgName2" class="settings-input" placeholder="نام نمایشی (مثلاً مؤسسه پیشگامان)">
                <input type="text" id="orgUser" class="settings-input" placeholder="نام کاربری (انگلیسی)" dir="ltr">
                <input type="password" id="orgPass" class="settings-input" placeholder="رمز عبور (برای ویرایش، خالی = بدون تغییر)" autocomplete="new-password">
                <label class="adv-inline"><input type="checkbox" id="orgDisabled"> غیرفعال</label>
                <div class="sa-actions"><button type="button" id="orgSave" class="btn-primary">ذخیره برگزارکننده</button></div></div>`, { ok: false });
            if (typeof refreshIcons === 'function') refreshIcons();
            const m = document.getElementById('helpModal');
            m.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
                const o = organizers.find(x => x.id === b.dataset.edit);
                m.querySelector('#orgId').value = o.id; m.querySelector('#orgName2').value = o.name; m.querySelector('#orgUser').value = o.username; m.querySelector('#orgDisabled').checked = o.disabled;
                m.querySelector('.sa-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
            m.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirm('این برگزارکننده حذف شود؟ مسابقه‌هایش برای سوپرادمین باقی می‌مانند.') && post('/superadmin/organizers', { op: 'delete', id: b.dataset.del }).then(S.openOrganizers).catch(fail));
            m.querySelector('#orgSave').onclick = () => post('/superadmin/organizers', {
                op: 'save', id: m.querySelector('#orgId').value || undefined, name: m.querySelector('#orgName2').value, username: m.querySelector('#orgUser').value,
                password: m.querySelector('#orgPass').value, disabled: m.querySelector('#orgDisabled').checked
            }).then(() => { toast('ذخیره شد.'); S.openOrganizers(); }).catch(fail);
        }).catch(fail);
    };

    // Organizer's own password.
    S.changeOrgPassword = function () {
        const cur = prompt('رمز عبور فعلی:'); if (cur === null) return;
        const p1 = prompt('رمز جدید (حداقل ۶ کاراکتر):'); if (!p1) return;
        if (prompt('تکرار رمز جدید:') !== p1) return toast('تکرار رمز مطابقت ندارد.', 'error');
        post('/superadmin/org_password', { currentPassword: cur, newPassword: p1 }).then(r => { Auth.set(r.token); toast('رمز عوض شد.'); }).catch(fail);
    };

    // ---- Leagues ----------------------------------------------------------------------------
    S.openLeagues = function () {
        Promise.all([get('/superadmin/leagues'), get('/superadmin/camps')]).then(([l, c]) => {
            const leagues = l.leagues;
            const camps = c.camps;
            // Each league: name, the camps it adds up (ticked = included), how it scores.
            const row = lg => `<div class="adv-item lg-item" data-id="${esc(lg.id || '')}">
                <div class="adv-row"><input type="text" class="lg-name" value="${esc(lg.name || '')}" placeholder="نام لیگ (مثلاً لیگ تابستان ۱۴۰۵)" aria-label="نام لیگ"><button type="button" class="adv-del" title="حذف لیگ">✕</button></div>
                <span class="lg-camps-label">مسابقه‌های این لیگ (تیک‌خورده‌ها حساب می‌شوند):</span>
                <div class="adv-chips">${camps.map(x => `<label class="adv-chip"><input type="checkbox" class="lg-camp" value="${esc(x.id)}" ${(lg.campIds || []).includes(x.id) ? 'checked' : ''}>${esc(x.title || x.id)}</label>`).join('')}</div>
                <div class="lg-fields"><label class="lg-field">روش امتیاز لیگ<select class="lg-mode"><option value="rank" ${lg.mode !== 'score' ? 'selected' : ''}>امتیاز بر اساس رتبه</option><option value="score" ${lg.mode === 'score' ? 'selected' : ''}>جمع امتیازها</option></select></label>
                <label class="lg-field">امتیاز رتبه‌ها (اول، دوم، …)<input type="text" class="lg-points" value="${esc((lg.rankPoints || [10, 8, 6, 5, 4, 3, 2, 1]).join(', '))}" placeholder="امتیاز رتبه‌ها: 10, 8, 6, ..." dir="ltr"></label></div>
                ${lg.id ? `<div class="manage-row"><button type="button" onclick="copyText(${jsArg(appUrl('league.html?id=' + lg.id))})">کپی لینک جدول لیگ</button><a class="manage-link-btn" href="league.html?id=${encodeURIComponent(lg.id)}" target="_blank" rel="noopener">نمایش</a></div>` : ''}</div>`;
            Help.show('لیگ‌ها (جدول چند مسابقه)', `<p class="manage-note">تیم‌های هم‌نام در مسابقه‌های مختلف یک تیم حساب می‌شوند. جدول لیگ یک صفحه عمومی دارد.</p>
                <div id="lgList">${leagues.map(row).join('')}</div><button type="button" class="adv-add" id="lgAdd">+ لیگ جدید</button>
                <div class="sa-actions"><button type="button" class="btn-primary" id="lgSave">ذخیره لیگ‌ها</button></div>`, { ok: false });
            const m = document.getElementById('helpModal');
            m.querySelector('#lgAdd').onclick = () => m.querySelector('#lgList').insertAdjacentHTML('beforeend', row({}));
            m.querySelector('#lgList').addEventListener('click', e => { if (e.target.closest('.adv-del')) e.target.closest('.lg-item').remove(); });
            m.querySelector('#lgSave').onclick = () => post('/superadmin/leagues', {
                leagues: [...m.querySelectorAll('.lg-item')].map(it => ({
                    id: it.dataset.id || undefined, name: it.querySelector('.lg-name').value.trim(),
                    campIds: [...it.querySelectorAll('.lg-camp:checked')].map(i => i.value), mode: it.querySelector('.lg-mode').value,
                    rankPoints: toEnDigits(it.querySelector('.lg-points').value).split(/[,،\s]+/).map(x => parseInt(x, 10)).filter(x => !isNaN(x))
                })).filter(x => x.name)
            }).then(() => { toast('لیگ‌ها ذخیره شد.'); S.openLeagues(); }).catch(fail);
        }).catch(fail);
    };

    // ---- Camp cards and links ---------------------------------------------------------------
    S.cardAnalysis = function (camp) {
        const t = encodeURIComponent(Auth.get());
        return `<a href="analysis.html?id=${encodeURIComponent(camp.id)}#t=${t}" target="_blank" rel="noopener" class="camp-link" title="اتاق آنالیز و کارنامه‌ها"><i data-lucide="bar-chart-3"></i> آنالیز</a>`;
    };
    S.cardExtras = camp => `<button type="button" onclick="SAF.saveAsTemplate(${jsArg(camp.id)}, ${jsArg(camp.title || '')})" title="ذخیره تنظیمات این مسابقه به‌عنوان قالب"><i data-lucide="layout-template"></i> قالب</button>`;
    S.ownerLabel = camp => (isSuper() && camp.owner ? `<div style="font-size: 12px; opacity: 0.75; margin-top: 4px;">برگزارکننده: ${esc(camp.owner)}</div>` : '');

    S.saveAsTemplate = function (campId, title) {
        const name = prompt('نام قالب (تیم‌ها، مراحل، برچسب‌ها و تنظیمات امکانات ذخیره می‌شود؛ امتیازها و کاربران نه):', title);
        if (!name) return;
        post('/superadmin/templates', { op: 'save', campId, name }).then(() => { toast('قالب ذخیره شد.'); S.loadSettings(); }).catch(fail);
    };

    S.linksExtra = function (campId) {
        const reg = appUrl('register.html?id=' + campId);
        const live = appUrl('live.html?id=' + campId);
        const widget = `<iframe src="${appUrl('widget.html?id=' + campId)}" width="420" height="360" style="border:0"></iframe>`;
        return `<div class="link-block"><div class="link-info"><b>جدول موبایلی برای تماشاچی‌ها</b><span class="manage-note">نسخه سبک تابلو برای گوشی.</span>
                <input type="text" readonly value="${esc(live)}" dir="ltr" onclick="this.select()"><div class="manage-row"><button type="button" onclick="copyText(${jsArg(live)})">کپی لینک</button><a class="manage-link-btn" href="${esc(live)}" target="_blank" rel="noopener">باز کردن</a></div></div><div class="link-qr">${qrSvg(live, 4)}</div></div>
            <div class="link-block"><div class="link-info"><b>ویجت برای سایت</b><span class="manage-note">این کد را در سایت خود قرار دهید.</span>
                <input type="text" readonly value="${esc(widget)}" dir="ltr" onclick="this.select()"><div class="manage-row"><button type="button" onclick="copyText(${jsArg(widget)})">کپی</button></div></div></div>
            <div class="link-block"><div class="link-info"><b>فرم ثبت‌نام تیم‌ها</b><span class="manage-note">فقط وقتی «ثبت‌نام آنلاین» روشن و فرم باز باشد کار می‌کند.</span>
                <input type="text" readonly value="${esc(reg)}" dir="ltr" onclick="this.select()"><div class="manage-row"><button type="button" onclick="copyText(${jsArg(reg)})">کپی لینک</button><a class="manage-link-btn" href="${esc(reg)}" target="_blank" rel="noopener">باز کردن</a></div></div></div>
            <div class="link-block"><div class="link-info"><b>لینک گزارش برای سازمان مشتری</b><span class="manage-note">اتاق آنالیز و کارنامه‌ها، فقط خواندنی و بدون ورود. هر وقت بخواهید باطل می‌شود.</span>
                <div class="manage-row"><button type="button" onclick="SAF.clientKey(${jsArg(campId)}, 'create')">ساخت لینک تازه</button><button type="button" onclick="SAF.clientKey(${jsArg(campId)}, 'revoke')">باطل کردن لینک</button></div>
                <div id="clientKeyOut" class="manage-note"></div></div></div>`;
    };
    S.clientKey = function (campId, op) {
        if (op === 'revoke' && !confirm('لینک گزارش فعلی باطل شود؟')) return;
        post(`/superadmin/camps/${encodeURIComponent(campId)}/client_key`, { op }).then(r => {
            const out = document.getElementById('clientKeyOut');
            if (op === 'revoke') { out.textContent = 'لینک گزارش باطل شد.'; return; }
            const url = appUrl(`analysis.html?id=${encodeURIComponent(campId)}&key=${encodeURIComponent(r.key)}`);
            out.innerHTML = `<input type="text" readonly value="${esc(url)}" dir="ltr" onclick="this.select()"><div class="manage-row"><button type="button" onclick="copyText(${jsArg(url)})">کپی لینک</button></div>`;
        }).catch(fail);
    };

    // ---- Camp form ---------------------------------------------------------------------------
    function formTeams() {
        return [...document.querySelectorAll('#teamsList .dynamic-item')].map(el => {
            const prev = currentCamp ? (currentCamp.teams || []).find(t => t.id === el.dataset.id) || {} : {};
            const tplT = pendingAdvanced && pendingAdvanced._teams ? pendingAdvanced._teams.find(t => t.id === el.dataset.id) || {} : {};
            return {
                id: el.dataset.id, name: (el.querySelector('.t-name') || {}).value || '', color: (el.querySelector('.color-btn') || { dataset: {} }).dataset.value,
                members: prev.members || tplT.members || [], division: prev.division || tplT.division || '', pin: prev.pin || '', secretCards: prev.secretCards || []
            };
        }).filter(t => t.name.trim());
    }
    function formStages() {
        return [...document.querySelectorAll('#stagesList .dynamic-item')].map(el => {
            const prev = currentCamp ? (currentCamp.stages || []).find(s => s.id === el.dataset.id) || {} : {};
            const tpl = pendingAdvanced && pendingAdvanced._stages ? pendingAdvanced._stages.find(s => s.id === el.dataset.id) || {} : {};
            return { id: el.dataset.id, name: (el.querySelector('.stage-name-input') || {}).value || '', criteria: prev.criteria || tpl.criteria || [], startAt: prev.startAt || tpl.startAt || '', durationMin: prev.durationMin || tpl.durationMin || null };
        }).filter(s => s.name.trim());
    }
    function formUsers() {
        return [...document.querySelectorAll('#usersList .dynamic-item')].map(el => ({
            username: el.querySelector('.u-user').value.trim(), name: `${el.querySelector('.u-first').value} ${el.querySelector('.u-last').value}`.trim(), role: el.querySelector('.u-role').value
        })).filter(u => u.username);
    }

    function renderFormExtras() {
        const box = document.getElementById('safFormExtras');
        if (!box) return;
        const c = currentCamp || {};
        const notify = c.notify || { channels: [], events: {} };
        const ev = notify.events || {};
        const tplOpts = templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}${t.builtin ? '' : ' (ذخیره‌شده)'}</option>`).join('');
        box.innerHTML = `
            ${currentCamp ? '' : `<div class="saf-template-row"><label for="safTemplate">شروع از قالب (اختیاری):</label>
                <div class="manage-row"><select id="safTemplate" class="settings-input" style="margin:0"><option value="">— بدون قالب —</option>${tplOpts}</select>
                <button type="button" id="safApplyTpl">اعمال</button><button type="button" id="safDelTpl" class="btn-danger" title="حذف قالب ذخیره‌شده">🗑</button></div></div>`}
            ${isSuper() && organizers.length ? `<label>برگزارکننده (مالک مسابقه):</label><select id="safOwner" class="settings-input"><option value="">— سوپرادمین —</option>${organizers.map(o => `<option value="${esc(o.id)}" ${c.ownerId === o.id ? 'selected' : ''}>${esc(o.name || o.username)}</option>`).join('')}</select>` : ''}
            <details class="adv-sec saf-adv" id="safAdvDetails"><summary><span>امکانات پیشرفته، نمایش و برند</span><span class="adv-state off">اختیاری</span></summary>
                <div class="adv-body"><p class="manage-note">برای مسابقه‌های ساده لازم نیست چیزی را تغییر دهید. اپراتور هم همین تنظیمات را در «مدیریت مسابقه ← تنظیمات پیشرفته» دارد.</p><div id="safAdvEditor"></div></div></details>
            <details class="adv-sec saf-adv" id="safNotifyDetails"><summary><span>اطلاع‌رسانی (بله، ایتا، تلگرام، وب‌هوک / پیامک)</span><span class="adv-state ${notify.channels.length ? 'on' : 'off'}">${notify.channels.length ? 'فعال' : 'خاموش'}</span></summary>
                <div class="adv-body"><p class="manage-note">نتایج مراحل، کارت شانس، نتیجه دورهای تصمیم و نتایج نهایی به این کانال‌ها فرستاده می‌شود. برای بله و تلگرام توکن ربات و شناسه کانال (مثلاً <span dir="ltr">@mychannel</span>) لازم است؛ ربات باید مدیر کانال باشد. برای پیامک، آدرس وب‌هوک سرویس پیامک را بدهید.</p>
                <div id="safChannels">${notify.channels.map(channelRow).join('')}</div><button type="button" class="adv-add" id="safAddChannel">+ کانال</button>
                <div class="adv-chips">${[['stage_close', 'بستن مرحله'], ['chance', 'کارت شانس'], ['round', 'نتیجه دور تصمیم'], ['ceremony', 'پایان مراسم جوایز'], ['finish', 'پایان مسابقه']].map(([k, l]) =>
                    `<label class="adv-chip"><input type="checkbox" class="saf-ev" value="${k}" ${ev[k] !== false ? 'checked' : ''}>${l}</label>`).join('')}</div></div></details>`;
        advRendered = false;
        const det = box.querySelector('#safAdvDetails');
        det.addEventListener('toggle', () => { if (det.open && !advRendered) renderAdvanced(); });
        box.querySelector('#safAddChannel').onclick = () => box.querySelector('#safChannels').insertAdjacentHTML('beforeend', channelRow({ type: 'bale' }));
        box.querySelector('#safChannels').addEventListener('click', e => { if (e.target.closest('.adv-del')) e.target.closest('.adv-item').remove(); });
        const apply = box.querySelector('#safApplyTpl');
        if (apply) apply.onclick = () => applyTemplate(box.querySelector('#safTemplate').value);
        const del = box.querySelector('#safDelTpl');
        if (del) del.onclick = () => {
            const t = templates.find(x => x.id === box.querySelector('#safTemplate').value);
            if (!t || t.builtin) return toast('یک قالب ذخیره‌شده را انتخاب کنید.', 'error');
            if (confirm(`قالب «${t.name}» حذف شود؟`)) post('/superadmin/templates', { op: 'delete', id: t.id }).then(() => S.loadSettings().then(renderFormExtras)).catch(fail);
        };
    }
    function channelRow(ch) {
        const types = [['bale', 'بله'], ['eitaa', 'ایتا'], ['telegram', 'تلگرام'], ['webhook', 'وب‌هوک / پیامک']];
        return `<div class="adv-item saf-ch" data-id="${esc(ch.id || '')}"><div class="adv-row">
            <select class="ch-type">${types.map(([v, l]) => `<option value="${v}" ${ch.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <input type="password" class="ch-token" placeholder="${ch.hasToken ? 'توکن ذخیره شده (خالی = بدون تغییر)' : 'توکن ربات'}" autocomplete="off" dir="ltr">
            <input type="text" class="ch-chat" value="${esc(ch.chatId || '')}" placeholder="شناسه کانال یا گروه" dir="ltr">
            <input type="text" class="ch-url" value="${esc(ch.url || '')}" placeholder="https://… (فقط وب‌هوک)" dir="ltr">
            <button type="button" class="adv-del" title="حذف">✕</button></div></div>`;
    }

    function renderAdvanced() {
        const el = document.getElementById('safAdvEditor');
        if (!el) return;
        const base = currentCamp || {};
        const cfg = Object.assign({
            display: settings ? settings.displayDefaults : {}, features: {}, skills: settings ? settings.defaultSkills : [],
            tagSkills: settings ? settings.defaultTagSkills : {}, divisions: [], roles: ['کاپیتان'], assignments: {}, scoreCap: {}, chanceCards: [], rounds: [],
            calibration: { cases: [] }, registration: { open: false }, brand: {}, uiLang: 'fa'
        }, pendingAdvanced || {}, currentCamp ? {
            display: base.display, features: base.features, skills: base.skills, tagSkills: base.tagSkills, divisions: base.divisions, roles: base.roles,
            assignments: base.assignments, scoreCap: base.scoreCap, chanceCards: base.chanceCards, rounds: base.rounds, calibration: base.calibration,
            registration: base.registration, brand: base.brand, uiLang: base.uiLang, certificate: base.certificate
        } : {});
        AdvancedEditor.render(el, cfg, {
            teams: formTeams(), stages: formStages(), users: formUsers(), campId: base.id || '',
            tags: window.getFormTags ? window.getFormTags() : [],
            mode: currentCamp ? 'superadmin' : 'superadmin-new'
        });
        advRendered = true;
    }

    function applyTemplate(id) {
        const t = templates.find(x => x.id === id);
        if (!t) return;
        const d = t.data || {};
        if (d.campType) { document.getElementById('campType').value = d.campType; toggleUsersSection(); }
        if (d.tieredPointsLadder) document.getElementById('tieredPointsLadder').value = d.tieredPointsLadder.join(', ');
        if (d.fieldJudgingMode) { document.getElementById('fieldJudgingMode').value = d.fieldJudgingMode; toggleFieldJudgingSettings(); }
        if (d.fieldJudgingValues) document.getElementById('fieldJudgingValuesInput').value = d.fieldJudgingValues.join(', ');
        if (d.positiveTags) { window.setFormTags(d.positiveTags, d.negativeTags || []); }
        if (Array.isArray(d.stages) && d.stages.length) {
            document.getElementById('stagesList').innerHTML = '';
            d.stages.forEach(s => addStage(s.name, s.id, s.unit, s.timeOrder, s.multiplier));
        }
        if (Array.isArray(d.teams) && d.teams.length) {
            document.getElementById('teamsList').innerHTML = '';
            d.teams.forEach(tm => addTeam(tm.name, tm.color, tm.id, 0, {}, [], tm.image || ''));
        }
        pendingAdvanced = {
            display: d.display, features: d.features || {}, skills: d.skills, tagSkills: d.tagSkills, divisions: d.divisions, roles: d.roles,
            chanceCards: d.chanceCards, rounds: d.rounds, scoreCap: d.scoreCap, brand: d.brand, uiLang: d.uiLang, _teams: d.teams, _stages: d.stages
        };
        Object.keys(pendingAdvanced).forEach(k => pendingAdvanced[k] === undefined && delete pendingAdvanced[k]);
        advRendered = false;
        const det = document.getElementById('safAdvDetails');
        if (det && det.open) renderAdvanced();
        FormGuard.touch('setup');
        toast(`قالب «${t.name}» اعمال شد. تیم‌ها و مراحل را بررسی و در صورت نیاز تغییر دهید.`);
    }

    S.onCampLoaded = function (camp) { currentCamp = camp; pendingAdvanced = null; renderFormExtras(); };
    S.onNewCamp = function () { currentCamp = null; pendingAdvanced = null; renderFormExtras(); };

    // Extra keys of the /setup body.
    S.extraForSave = function () {
        const out = {};
        const owner = document.getElementById('safOwner');
        if (owner) out.ownerId = owner.value || null;
        const ed = document.getElementById('safAdvEditor');
        if (advRendered && ed && ed._adv) {
            Object.assign(out, AdvancedEditor.collect(ed));
        } else if (pendingAdvanced) {
            const p = { ...pendingAdvanced };
            const teamsExtra = {};
            (p._teams || []).forEach(t => { teamsExtra[t.id] = { members: t.members || [], division: t.division || '' }; });
            const stagesExtra = {};
            (p._stages || []).forEach(s => { stagesExtra[s.id] = { criteria: s.criteria || [], startAt: s.startAt || '', durationMin: s.durationMin || null }; });
            delete p._teams; delete p._stages;
            Object.assign(out, p, { teamsExtra, stagesExtra });
        }
        const chBox = document.getElementById('safChannels');
        if (chBox) {
            out.notify = {
                channels: [...chBox.querySelectorAll('.saf-ch')].map(r => ({
                    id: r.dataset.id || undefined, type: r.querySelector('.ch-type').value, token: r.querySelector('.ch-token').value.trim(),
                    chatId: r.querySelector('.ch-chat').value.trim(), url: r.querySelector('.ch-url').value.trim()
                })),
                events: Object.fromEntries([...document.querySelectorAll('.saf-ev')].map(i => [i.value, i.checked]))
            };
        }
        return out;
    };

    window.SAF = S;
})();
