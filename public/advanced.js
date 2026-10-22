// Advanced settings editor, shared by the operator panel (management → advanced settings)
// and the superadmin camp form. Everything is collapsed by default so the panels stay simple.
//
//   AdvancedEditor.render(el, cfg, ctx)  cfg: settings (from /api/manage or the camp), ctx: { teams, stages, users, tags, campId, mode }
//   AdvancedEditor.collect(el) → body for POST /api/advanced (or extra keys of POST /setup)
(function () {
    const A = {};
    const lines = v => String(v || '').split('\n').map(x => x.trim()).filter(Boolean);
    const cells = l => l.split('|').map(x => x.trim());
    const num = v => { const n = parseFloat(toEnDigits(v)); return isFinite(n) ? n : 0; };
    const rid = p => p + '_' + Math.random().toString(36).slice(2, 9);
    const attr = v => esc(v === undefined || v === null ? '' : String(v));

    function section(key, title, hint, body, featureKey, cfg) {
        const off = featureKey && !(cfg.features || {})[featureKey];
        return `<details class="adv-sec" data-sec="${key}">
            <summary><span>${esc(title)}</span>${featureKey ? `<span class="adv-state ${off ? 'off' : 'on'}" data-state-for="${featureKey}">${off ? 'خاموش' : 'روشن'}</span>` : ''}</summary>
            <div class="adv-body">${hint ? `<p class="manage-note">${hint}</p>` : ''}${body}</div></details>`;
    }

    A.render = function (el, cfg, ctx) {
        cfg = cfg || {};
        ctx = ctx || {};
        const teams = ctx.teams || [], stages = ctx.stages || [], users = ctx.users || [];
        const divisions = cfg.divisions || [];
        const skills = cfg.skills && cfg.skills.length ? cfg.skills : [];
        el._adv = { cfg, ctx };
        const referees = users.filter(u => u.role === 'referee' || u.role === 'head_referee');
        const divOptions = sel => '<option value="">— بدون گروه —</option>' + divisions.map(d => `<option value="${attr(d.id)}" ${d.id === sel ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
        const teamPage = t => appUrl(`team.html?id=${encodeURIComponent(ctx.campId || '')}&team=${encodeURIComponent(t.id)}`);
        const tags = ctx.tags || [];
        const tagMap = cfg.tagSkills || {};

        let html = '<div class="adv-sections">';
        html += section('switches', 'نمایش و امکانات', 'المان‌های نمایشی به‌طور پیش‌فرض روشن‌اند و هر کدام را می‌توانید خاموش کنید. امکانات اختیاری تا وقتی روشن نشوند هیچ چیزی به صفحه داورها اضافه نمی‌کنند.', '<div class="adv-switches"></div>');

        html += section('teams', 'بازیکن‌ها، گروه و پست', 'هر بازیکن در یک خط؛ پست را بعد از «|» بنویسید. مثال: <code>علی رضایی | کاپیتان</code>',
            teams.map(t => `<div class="adv-team" data-team="${attr(t.id)}">
                <div class="adv-team-head"><span class="adv-dot" style="background:${safeColor(t.color, '#3b82f6')}"></span><b>${esc(t.name || 'تیم')}</b>
                    <select class="adv-division" aria-label="گروه ${attr(t.name)}">${divOptions(t.division)}</select></div>
                <textarea class="adv-members" rows="3" placeholder="نام بازیکن | پست">${esc((t.members || []).map(m => m.name + (m.role ? ' | ' + m.role : '')).join('\n'))}</textarea>
            </div>`).join('') || '<p class="manage-note">ابتدا تیم‌ها را تعریف کنید.</p>');

        html += section('divroles', 'فهرست گروه‌ها و پست‌ها', '',
            `<label class="adv-label">گروه‌ها (هر کدام در یک خط)</label><textarea class="adv-divisions" rows="3">${esc(divisions.map(d => d.name).join('\n'))}</textarea>
             <label class="adv-label">پست‌های تیمی (هر کدام در یک خط)</label><textarea class="adv-roles" rows="3">${esc((cfg.roles || ['کاپیتان']).join('\n'))}</textarea>`, 'divisions', cfg);

        if (ctx.mode !== 'superadmin-new') {
            html += section('pins', 'صفحه و کد تیم‌ها', 'هر تیم یک صفحه اختصاصی دارد (امتیاز، تاریخچه، مهارت‌ها). کد شش‌رقمی برای انتخاب تاکتیک، کارت محرمانه و رأی هم‌تیمی‌ها لازم است؛ آن را فقط به خود تیم بدهید.',
                `<div class="adv-pins">${teams.map(t => `<div class="adv-pin-row">
                    <b>${esc(t.name)}</b><code dir="ltr">${t.pin ? esc(t.pin) : '—'}</code>
                    <button type="button" onclick="copyText(${jsArg(teamPage(t))})">کپی لینک صفحه تیم</button>
                    <button type="button" class="adv-qr" data-url="${attr(teamPage(t))}" data-name="${attr(t.name)}">QR</button>
                    <label class="adv-inline"><input type="checkbox" class="adv-regen" value="${attr(t.id)}"> کد جدید</label>
                </div>`).join('')}</div>`);
        }

        html += section('secret', 'کارت‌های محرمانه تیم‌ها', 'هر کارت در یک خط: <code>عنوان | متن</code>. هر تیم فقط کارت‌های خودش را در صفحه تیم (با کد تیم) می‌بیند.',
            teams.map(t => `<div class="adv-team" data-team="${attr(t.id)}"><div class="adv-team-head"><span class="adv-dot" style="background:${safeColor(t.color, '#3b82f6')}"></span><b>${esc(t.name)}</b></div>
                <textarea class="adv-secret" rows="2" placeholder="عنوان | متن">${esc((t.secretCards || []).map(c => c.title + ' | ' + c.text).join('\n'))}</textarea></div>`).join(''), 'secretCards', cfg);

        html += section('assign', 'تقسیم داورها', 'برای هر داور تیم‌ها و مراحلی را که داوری می‌کند علامت بزنید. اگر چیزی علامت نخورد، داور همه را می‌بیند. اپراتور و سرداور محدود نمی‌شوند.',
            referees.map(u => {
                const a = (cfg.assignments || {})[u.username] || { teams: [], stages: [] };
                return `<div class="adv-assign" data-user="${attr(u.username)}"><b>${esc(u.name || u.username)}</b>
                    <div class="adv-chips">${teams.map(t => `<label class="adv-chip"><input type="checkbox" class="adv-as-team" value="${attr(t.id)}" ${a.teams.includes(t.id) ? 'checked' : ''}>${esc(t.name)}</label>`).join('')}</div>
                    <div class="adv-chips">${stages.map(s => `<label class="adv-chip stage"><input type="checkbox" class="adv-as-stage" value="${attr(s.id)}" ${a.stages.includes(s.id) ? 'checked' : ''}>${esc(s.name)}</label>`).join('')}</div></div>`;
            }).join('') || '<p class="manage-note">هنوز داوری تعریف نشده است.</p>', 'assignments', cfg);

        html += section('stages', 'برنامه زمانی و معیارهای مراحل', 'ساعت شروع و مدت هر مرحله روی تابلو نمایش داده می‌شود. معیارها (هر کدام در یک خط: <code>نام معیار | وزن</code>) فقط وقتی «داوری چندمعیاره» روشن باشد به کار می‌روند؛ نمره مرحله = جمع (نمره × وزن).',
            stages.map(s => `<div class="adv-stage" data-stage="${attr(s.id)}"><div class="adv-team-head"><b>${esc(s.name)}</b>
                <label class="adv-inline">شروع <input type="time" class="adv-start" value="${attr(s.startAt || '')}"></label>
                <label class="adv-inline">مدت (دقیقه) <input type="text" inputmode="numeric" class="adv-duration" value="${attr(s.durationMin || '')}" size="4"></label></div>
                <textarea class="adv-criteria" rows="2" placeholder="نام معیار | وزن">${esc((s.criteria || []).map(c => c.name + ' | ' + c.weight).join('\n'))}</textarea></div>`).join('') || '<p class="manage-note">مرحله‌ای تعریف نشده است.</p>');

        html += section('cap', 'سقف امتیاز داور', 'بیشترین مجموع امتیاز (مثبت و منفی) که هر داور در یک ساعت می‌تواند ثبت کند.',
            `<label class="adv-inline">سقف در ساعت <input type="text" inputmode="numeric" class="adv-cap" value="${attr((cfg.scoreCap || {}).perHour || '')}" size="6"></label>`, 'scoreCap', cfg);

        html += section('chance', 'کارت‌های شانس', 'هر کارت در یک خط: <code>عنوان | متن | امتیاز | بودجه</code> (امتیاز و بودجه اختیاری و می‌توانند منفی باشند).',
            `<textarea class="adv-chance" rows="4" placeholder="طوفان | همه تیم‌ها ۳ امتیاز از دست می‌دهند | -3 | 0">${esc((cfg.chanceCards || []).map(c => [c.title, c.text, c.points || 0, c.budget || 0].join(' | ')).join('\n'))}</textarea>`, 'chanceCards', cfg);

        html += section('rounds', 'دورهای تصمیم‌گیری (انتخاب تاکتیک)', 'هر گزینه در یک خط: <code>گزینه | امتیاز | بودجه</code>. اثر گزینه‌ها هنگام بستن دور اعمال می‌شود.',
            `<div class="adv-rounds">${(cfg.rounds || []).map(roundHtml).join('')}</div><button type="button" class="adv-add" data-add="round">+ دور جدید</button>`, 'decisions', cfg);

        html += section('calibration', 'کارگاه هماهنگی داورها', 'نمونه‌ای (مثلاً یک ویدیو یا توصیف یک اجرا) تعریف کنید؛ داورها به آن نمره می‌دهند و میزان هماهنگی‌شان در اتاق آنالیز دیده می‌شود.',
            `<div class="adv-cal">${((cfg.calibration || {}).cases || []).map(calHtml).join('')}</div><button type="button" class="adv-add" data-add="cal">+ نمونه جدید</button>`, 'calibration', cfg);

        const regUrl = appUrl('register.html?id=' + encodeURIComponent(ctx.campId || ''));
        html += section('registration', 'ثبت‌نام آنلاین تیم‌ها', `لینک فرم ثبت‌نام: <span dir="ltr">${esc(regUrl)}</span>`,
            `<label class="adv-inline"><input type="checkbox" class="adv-reg-open" ${(cfg.registration || {}).open ? 'checked' : ''}> فرم ثبت‌نام باز است</label>
             <button type="button" onclick="copyText(${jsArg(regUrl)})">کپی لینک فرم</button>`, 'registration', cfg);

        html += section('skills', 'مهارت‌ها و برچسب‌ها', 'برچسب‌هایی که داورها می‌زنند به مهارت‌ها وصل می‌شوند و کارنامه فنی تیم و بازیکن را می‌سازند. داور تغییری حس نمی‌کند.',
            `<label class="adv-label">مهارت‌ها (هر کدام در یک خط)</label><textarea class="adv-skills" rows="4">${esc(skills.map(s => s.name).join('\n'))}</textarea>
             <div class="adv-tagmap">${tags.map(tag => `<div class="adv-tag-row" data-tag="${attr(tag)}"><span class="adv-tag">${esc(tag)}</span>
                <span class="adv-chips">${skills.map(s => `<label class="adv-chip"><input type="checkbox" value="${attr(s.id)}" ${(tagMap[tag] || []).includes(s.id) ? 'checked' : ''}>${esc(s.name)}</label>`).join('')}</span></div>`).join('')}</div>
             <p class="manage-note">برای دیدن مهارت‌های تازه در فهرست بالا، ابتدا ذخیره کنید.</p>`);

        const b = cfg.brand || {};
        html += section('brand', 'برند، اسپانسر و زبان صفحات عمومی', 'لوگو و رنگ سازمان مشتری روی تابلو نمایش داده می‌شود.',
            `<div class="adv-grid2">
                <label class="adv-label">لوگوی سازمان مشتری (آدرس تصویر یا انتخاب فایل)</label>
                <div class="adv-row"><input type="text" class="adv-client-logo" dir="ltr" value="${attr(b.clientLogo || '')}" placeholder="https://..."><input type="file" accept="image/*" class="adv-file" data-target="adv-client-logo"></div>
                <label class="adv-label">تصویر پس‌زمینه تابلو</label>
                <div class="adv-row"><input type="text" class="adv-bg" dir="ltr" value="${attr(b.background || '')}" placeholder="https://..."><input type="file" accept="image/*" class="adv-file" data-target="adv-bg"></div>
                <label class="adv-label">رنگ سازمانی</label><input type="color" class="adv-accent" value="${attr(/^#[0-9a-f]{6}$/i.test(b.accent || '') ? b.accent : '#7c3aed')}"><label class="adv-inline"><input type="checkbox" class="adv-accent-on" ${b.accent ? 'checked' : ''}> استفاده از رنگ سازمانی</label>
                <label class="adv-label">نام اسپانسر / حامی</label><input type="text" class="adv-sponsor" value="${attr(b.sponsor || '')}">
                <label class="adv-label">زبان تابلو و صفحات عمومی</label><select class="adv-lang"><option value="fa" ${cfg.uiLang !== 'en' ? 'selected' : ''}>فارسی</option><option value="en" ${cfg.uiLang === 'en' ? 'selected' : ''}>English</option></select>
             </div>`);
        html += '</div>';
        el.innerHTML = html;
        Feat.renderSwitches(el.querySelector('.adv-switches'), cfg.display || {}, cfg.features || {});

        // Live "on/off" chips when a feature switch changes.
        el.querySelectorAll('[data-feature]').forEach(i => i.addEventListener('change', () => {
            el.querySelectorAll(`[data-state-for="${i.dataset.feature}"]`).forEach(s => { s.textContent = i.checked ? 'روشن' : 'خاموش'; s.className = 'adv-state ' + (i.checked ? 'on' : 'off'); });
        }));
        el.addEventListener('click', e => {
            const add = e.target.closest('[data-add]');
            if (add) {
                const box = el.querySelector(add.dataset.add === 'round' ? '.adv-rounds' : '.adv-cal');
                box.insertAdjacentHTML('beforeend', add.dataset.add === 'round' ? roundHtml({}) : calHtml({}));
            }
            const qr = e.target.closest('.adv-qr');
            if (qr) Help.show('صفحه تیم ' + qr.dataset.name, `<div style="text-align:center">${qrSvg(qr.dataset.url, 5)}<p dir="ltr">${esc(qr.dataset.url)}</p></div>`);
            const del = e.target.closest('.adv-del');
            if (del && confirm('این مورد حذف شود؟')) del.closest('.adv-item').remove();
        });
        el.querySelectorAll('.adv-file').forEach(f => f.addEventListener('change', async () => {
            const file = f.files && f.files[0];
            if (!file) return;
            try { el.querySelector('.' + f.dataset.target).value = await compressImageFile(file, 1280, 0.82); }
            catch (err) { if (window.showToast) showToast('خواندن تصویر انجام نشد.', 'error'); }
        }));
    };

    function roundHtml(r) {
        return `<div class="adv-item adv-round" data-id="${attr(r.id || '')}">
            <div class="adv-row"><input type="text" class="adv-r-title" value="${attr(r.title || '')}" placeholder="عنوان دور (مثلاً: بازار)"><button type="button" class="adv-del" title="حذف">✕</button></div>
            <input type="text" class="adv-r-q" value="${attr(r.question || '')}" placeholder="سؤال (مثلاً: سرمایه‌گذاری می‌کنید؟)">
            <textarea class="adv-r-opts" rows="3" placeholder="گزینه | امتیاز | بودجه">${esc((r.options || []).map(o => [o.label, o.points || 0, o.budget || 0].join(' | ')).join('\n'))}</textarea>
            ${r.status ? `<span class="manage-note">وضعیت: ${{ draft: 'پیش‌نویس', open: 'باز', closed: 'بسته' }[r.status] || r.status}</span>` : ''}</div>`;
    }
    function calHtml(c) {
        return `<div class="adv-item adv-calcase" data-id="${attr(c.id || '')}">
            <div class="adv-row"><input type="text" class="adv-c-title" value="${attr(c.title || '')}" placeholder="عنوان نمونه"><button type="button" class="adv-del" title="حذف">✕</button></div>
            <textarea class="adv-c-desc" rows="2" placeholder="توضیح یا لینک ویدیو">${esc(c.description || '')}</textarea>
            <div class="adv-row"><label class="adv-inline">نمره مرجع (اختیاری) <input type="text" inputmode="decimal" class="adv-c-exp" value="${attr(c.expected ?? '')}" size="5"></label>
            <label class="adv-inline"><input type="checkbox" class="adv-c-open" ${c.open ? 'checked' : ''}> باز برای داورها</label></div></div>`;
    }

    // Keeps existing ids when names are unchanged (so stats and links survive editing).
    function withIds(names, old, prefix) {
        const byName = new Map((old || []).map(x => [x.name, x.id]));
        return names.map(n => ({ id: byName.get(n) || rid(prefix), name: n }));
    }

    A.collect = function (el) {
        const { cfg, ctx } = el._adv || { cfg: {}, ctx: {} };
        const body = Feat.readSwitches(el.querySelector('.adv-switches'));
        const divisions = withIds(lines(el.querySelector('.adv-divisions').value), cfg.divisions, 'dv');
        body.divisions = divisions;
        // Divisions typed in the list are matched by name in the team selectors (ids of new ones are not known yet).
        const divByOldId = new Map((cfg.divisions || []).map(d => [d.id, d.name]));
        body.roles = lines(el.querySelector('.adv-roles').value);
        body.teamsExtra = {};
        el.querySelectorAll('.adv-sec[data-sec="teams"] .adv-team').forEach(row => {
            const t = (ctx.teams || []).find(x => x.id === row.dataset.team) || {};
            const old = new Map((t.members || []).map(m => [m.name, m.id]));
            const members = lines(row.querySelector('.adv-members').value).map(l => {
                const [name, role] = cells(l);
                return { id: old.get(name) || rid('m'), name, role: role || '' };
            });
            const selName = divByOldId.get(row.querySelector('.adv-division').value);
            const div = divisions.find(d => d.name === selName);
            body.teamsExtra[row.dataset.team] = { members, division: div ? div.id : '' };
        });
        el.querySelectorAll('.adv-sec[data-sec="secret"] .adv-team').forEach(row => {
            const cards = lines(row.querySelector('.adv-secret').value).map(l => { const [title, ...rest] = cells(l); return { title, text: rest.join(' | ') }; });
            body.teamsExtra[row.dataset.team] = Object.assign(body.teamsExtra[row.dataset.team] || {}, { secretCards: cards });
        });
        body.regeneratePins = [...el.querySelectorAll('.adv-regen:checked')].map(i => i.value);
        body.assignments = {};
        el.querySelectorAll('.adv-assign').forEach(row => {
            body.assignments[row.dataset.user] = {
                teams: [...row.querySelectorAll('.adv-as-team:checked')].map(i => i.value),
                stages: [...row.querySelectorAll('.adv-as-stage:checked')].map(i => i.value)
            };
        });
        body.stagesExtra = {};
        el.querySelectorAll('.adv-stage').forEach(row => {
            const s = (ctx.stages || []).find(x => x.id === row.dataset.stage) || {};
            const oldC = new Map((s.criteria || []).map(c => [c.name, c.id]));
            body.stagesExtra[row.dataset.stage] = {
                startAt: row.querySelector('.adv-start').value,
                durationMin: parseInt(toEnDigits(row.querySelector('.adv-duration').value), 10) || null,
                criteria: lines(row.querySelector('.adv-criteria').value).map(l => { const [name, w] = cells(l); return { id: oldC.get(name) || rid('cr'), name, weight: num(w) || 1 }; })
            };
        });
        body.scoreCap = { perHour: num(el.querySelector('.adv-cap').value) || null };
        const oldCards = new Map((cfg.chanceCards || []).map(c => [c.title, c.id]));
        body.chanceCards = lines(el.querySelector('.adv-chance').value).map(l => {
            const [title, text, points, budget] = cells(l);
            return { id: oldCards.get(title) || rid('cc'), title, text: text || '', points: num(points), budget: num(budget) };
        });
        body.rounds = [...el.querySelectorAll('.adv-round')].map(r => {
            const prev = (cfg.rounds || []).find(x => x.id === r.dataset.id) || {};
            const oldOpts = new Map((prev.options || []).map(o => [o.label, o.id]));
            return {
                id: r.dataset.id || rid('rd'), title: r.querySelector('.adv-r-title').value.trim(), question: r.querySelector('.adv-r-q').value.trim(),
                options: lines(r.querySelector('.adv-r-opts').value).map(l => { const [label, p, bgt] = cells(l); return { id: oldOpts.get(label) || rid('op'), label, points: num(p), budget: num(bgt) }; })
            };
        }).filter(r => r.title);
        body.calibrationCases = [...el.querySelectorAll('.adv-calcase')].map(c => ({
            id: c.dataset.id || rid('cal'), title: c.querySelector('.adv-c-title').value.trim(), description: c.querySelector('.adv-c-desc').value.trim(),
            expected: c.querySelector('.adv-c-exp').value.trim() === '' ? '' : num(c.querySelector('.adv-c-exp').value), open: c.querySelector('.adv-c-open').checked
        })).filter(c => c.title);
        body.registrationOpen = el.querySelector('.adv-reg-open').checked;
        body.skills = withIds(lines(el.querySelector('.adv-skills').value), cfg.skills, 'sk');
        body.tagSkills = {};
        el.querySelectorAll('.adv-tag-row').forEach(row => {
            const v = [...row.querySelectorAll('input:checked')].map(i => i.value);
            if (v.length) body.tagSkills[row.dataset.tag] = v;
        });
        body.brand = {
            clientLogo: el.querySelector('.adv-client-logo').value.trim(), background: el.querySelector('.adv-bg').value.trim(),
            accent: el.querySelector('.adv-accent-on').checked ? el.querySelector('.adv-accent').value : '', sponsor: el.querySelector('.adv-sponsor').value.trim()
        };
        body.uiLang = el.querySelector('.adv-lang').value;
        return body;
    };

    window.AdvancedEditor = A;
})();
