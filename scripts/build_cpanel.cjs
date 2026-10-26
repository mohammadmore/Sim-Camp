// Builds cpanel_export/ (PHP edition) from public/ (Node edition).
// public/ is the only place to edit the frontend; run `npm run build:cpanel` afterwards.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'cpanel_export');
// Files that only exist in the PHP edition and must never be overwritten.
const PHP_ONLY = new Set(['.htaccess', 'api.php', 'db.php', 'index.php', 'setup_db.php', 'media.php', 'backup.php', 'README.md', 'data']);

console.log('Starting cPanel Export build...');

function copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else if (!entry.name.endsWith('.html') && entry.name !== 'cpanel_export.zip') fs.copyFileSync(s, d);
    }
}

// Remove stale static files from a previous build (keep the PHP-only files and the database).
for (const entry of fs.readdirSync(OUT, { withFileTypes: true })) {
    if (PHP_ONLY.has(entry.name)) continue;
    fs.rmSync(path.join(OUT, entry.name), { recursive: true, force: true });
}
copyDir(SRC, OUT);
console.log('✓ Copied static assets');

// Node route -> PHP action
function toPhpUrls(html) {
    const q = "['`]";
    // Matches fetch('/...'), OfflineQueue.send('/...') and fetchBackup('/...')
    const call = '(fetch|OfflineQueue\\.send|fetchBackup)\\(';
    const rules = [
        [new RegExp(`${call}(${q})/api/settings\\2`, 'g'), "$1($2api.php?action=settings$2"],
        [new RegExp(`${call}(${q})/api\\?action=`, 'g'), '$1($2api.php?action='],
        [new RegExp(`${call}(${q})/api\\?id=`, 'g'), '$1($2api.php?action=update_camp&id='],
        [new RegExp(`${call}(${q})/api/(instant|undo_instant|judge_stage_score|stage_scores|team_logs|board|finish|audit|users)\\?id=`, 'g'), '$1($2api.php?action=$3&id='],
        [new RegExp(`${call}(${q})/api/users/reset_password\\?id=`, 'g'), '$1($2api.php?action=users_reset_password&id='],
        [new RegExp(`${call}(${q})/api/stage/reset\\?id=`, 'g'), '$1($2api.php?action=stage_reset&id='],
        [new RegExp(`${call}(${q})/api/scores/reset\\?id=`, 'g'), '$1($2api.php?action=scores_reset&id='],
        [new RegExp(`${call}(${q})/api/stage/close_tiered\\2`, 'g'), '$1($2api.php?action=close_tiered$2'],
        [new RegExp(`${call}(${q})/api/user/profile-pic\\2`, 'g'), '$1($2api.php?action=user_profile_pic$2'],
        [new RegExp(`${call}(${q})/api/user/password\\2`, 'g'), '$1($2api.php?action=user_password$2'],
        [new RegExp(`${call}(${q})/login\\2`, 'g'), '$1($2api.php?action=login$2'],
        [new RegExp(`${call}(${q})/setup\\2`, 'g'), '$1($2api.php?action=setup$2'],
        [new RegExp(`${call}(${q})/superadmin/login\\2`, 'g'), '$1($2api.php?action=superadmin_login$2'],
        [new RegExp(`${call}(${q})/superadmin/password\\2`, 'g'), '$1($2api.php?action=superadmin_password$2'],
        [new RegExp(`${call}(${q})/superadmin/camps\\2`, 'g'), '$1($2api.php?action=superadmin_camps$2'],
        [new RegExp(`${call}(${q})/superadmin/(trash|backup|import)\\2`, 'g'), '$1($2api.php?action=superadmin_$3$2'],
        [new RegExp(`${call}(${q})/superadmin/id_available\\?id=`, 'g'), '$1($2api.php?action=superadmin_id_available&id='],
        [/fetch\(`\/superadmin\/camps\/\$\{(\w+)\}\/(archive|lock|delete|duplicate)`/g, 'fetch(`api.php?action=superadmin_camp_$2&id=${$1}`'],
        [/(fetch|fetchBackup)\(`\/superadmin\/camps\/\$\{encodeURIComponent\((\w+)\)\}\/(restore|purge|export)`/g, '$1(`api.php?action=superadmin_camp_$3&id=${encodeURIComponent($2)}`'],
        [/fetch\(`\/superadmin\/camps\/\$\{(\w+)\}`/g, 'fetch(`api.php?action=superadmin_camp&id=${$1}`']
    ];
    for (const [re, rep] of rules) html = html.replace(re, rep);
    return html;
}

// Remaining Node-style URLs (new features, URLs built at run time) are mapped to api.php actions
// in the browser by common.js (window.toPhpUrl), which this flag switches on.
function assertNoAbsoluteApiUrls(name, html) {
    if (!html.includes('src="common.js"')) {
        const left = html.match(/(fetch|OfflineQueue\.send|fetchBackup)\(\s*['`]\/[^'`]*/g);
        if (left) throw new Error(`${name}: unconverted API URLs: ${left.join(', ')}`);
    }
}
function markPhp(html) {
    if (!html.includes('<script src="common.js"></script>')) return html;
    return html.replace('<script src="common.js"></script>', '<script>window.SIMCAMP_PHP = true;</script>\n    <script src="common.js"></script>');
}

// 1. superadmin.html
let sa = markPhp(toPhpUrls(fs.readFileSync(path.join(SRC, 'superadmin.html'), 'utf8')));
// The cPanel package download only makes sense on the Node server.
sa = sa.replace(/\s*<button type="button" id="cpanelPackageBtn"[\s\S]*?<\/button>/, '');
assertNoAbsoluteApiUrls('superadmin.html', sa);
fs.writeFileSync(path.join(OUT, 'superadmin.html'), sa, 'utf8');
console.log('✓ superadmin.html');

// 2. operator.html
const op = markPhp(toPhpUrls(fs.readFileSync(path.join(SRC, 'operator.html'), 'utf8')));
assertNoAbsoluteApiUrls('operator.html', op);
fs.writeFileSync(path.join(OUT, 'operator.html'), op, 'utf8');
console.log('✓ operator.html');

// 3. board.html: PHP hosting has no SSE, so poll instead.
let board = markPhp(toPhpUrls(fs.readFileSync(path.join(SRC, 'board.html'), 'utf8')));
const sseBlockRegex = /\/\/ Replaced Heavy Polling with Lightweight SSE[\s\S]*?evtSource\.addEventListener\('splash'[\s\S]*?\}\);\s*\}/;
const pollingReplacement = `// Polling mode for cPanel / PHP Hosting
let lastSeenLogTime = Date.now();
let isFirstLoad = true;

let lastBoardEtag = null;

function pollBoardState() {
    if (document.hidden) return;
    fetch(\`api.php?action=poll&id=\${campId}\`)
    .then(r => {
        if (r.status === 404) { clearInterval(boardPollTimer); ConnectionStatus.show(false); showBoardMessage('🔍', 'مسابقه‌ای با این لینک پیدا نشد.<br><small>ممکن است حذف شده باشد یا لینک اشتباه باشد.</small>'); return Promise.reject(); }
        if (!r.ok) return Promise.reject(new Error('http'));
        // Unchanged since the last poll ("304 Not Modified" from the server): nothing to do.
        const etag = r.headers.get('ETag');
        if (etag && etag === lastBoardEtag) return null;
        lastBoardEtag = etag;
        return r.json();
    })
    .then(state => {
        ConnectionStatus.ok();
        if (!state) return;
        latestState = state;
        if (window.DRAWBOARD) DRAWBOARD.update(latestState); // live team draw (before renderBoard sorts the teams)
        let maxTime = lastSeenLogTime;
        (state.teams || []).forEach(t => {
            (Array.isArray(t.scoreLogs) ? t.scoreLogs : []).forEach(log => {
                if (!isFirstLoad && log.type === 'instant' && !log.chance && !log.round && !state.frozen && log.timestamp > lastSeenLogTime) {
                    splashQueue.push({
                        teamId: t.id,
                        delta: log.value,
                        teamName: t.name,
                        score: t.score,
                        logId: log.id,
                        user: log.user,
                        tag: log.tag || '',
                        image: t.image || '',
                        happyImage: t.happyImage || '',
                        sadImage: t.sadImage || '',
                        teamColor: t.color || ''
                    });
                }
                if (!isFirstLoad && log.type === 'cancelled' && log.timestamp > lastSeenLogTime) {
                    const splash = document.getElementById('splash-' + log.id);
                    if (splash) {
                        const stamp = document.createElement('div');
                        stamp.className = 'cancel-stamp';
                        stamp.innerText = 'لغو شد';
                        splash.appendChild(stamp);
                    } else {
                        const qIdx = splashQueue.findIndex(sq => sq.logId === log.id);
                        if (qIdx !== -1) splashQueue[qIdx].isCancelled = true;
                    }
                }
                if (log.timestamp && log.timestamp > maxTime) maxTime = log.timestamp;
            });
        });
        isFirstLoad = false;
        lastSeenLogTime = maxTime;

        if (splashQueue.length > 0 && !isSplashing) {
            runSplashQueue();
        } else if (splashQueue.length === 0 && !isSplashing) {
            renderBoard(latestState);
        }
    })
    .catch(e => { if (e) ConnectionStatus.fail(); });
}

pollBoardState();
const boardPollTimer = setInterval(pollBoardState, 1500);
}`;
if (!sseBlockRegex.test(board)) throw new Error('board.html: EventSource block not found; update scripts/build_cpanel.cjs');
board = board.replace(sseBlockRegex, pollingReplacement);
if (!board.includes('DRAWBOARD.update(')) throw new Error('board.html: the live draw hook is missing after the SSE replacement');
assertNoAbsoluteApiUrls('board.html', board);
fs.writeFileSync(path.join(OUT, 'board.html'), board, 'utf8');
console.log('✓ board.html (SSE replaced with polling)');

// 4. Any other page only needs its API URLs converted.
for (const name of fs.readdirSync(SRC).filter(f => f.endsWith('.html') && !['superadmin.html', 'operator.html', 'board.html'].includes(f))) {
    const html = markPhp(toPhpUrls(fs.readFileSync(path.join(SRC, name), 'utf8')));
    assertNoAbsoluteApiUrls(name, html);
    fs.writeFileSync(path.join(OUT, name), html, 'utf8');
    console.log(`✓ ${name}`);
}

// 5. Optional upload bundle
try {
    // Served by the Node app so the superadmin can download it ("بسته cPanel").
    const zipPath = path.join(SRC, 'cpanel_export.zip');
    fs.rmSync(zipPath, { force: true });
    execFileSync('zip', ['-qr', zipPath, '.', '-x', 'data/*'], { cwd: OUT });
    console.log('✓ cpanel_export.zip');
} catch (e) {
    console.warn('! zip not available; upload the cpanel_export folder contents instead.');
}

console.log('Build completed successfully!');
