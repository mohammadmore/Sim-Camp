// Builds cpanel_export/ (PHP edition) from public/ (Node edition).
// public/ is the only place to edit the frontend; run `npm run build:cpanel` afterwards.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'cpanel_export');
// Files that only exist in the PHP edition and must never be overwritten.
const PHP_ONLY = new Set(['.htaccess', 'api.php', 'db.php', 'index.php', 'setup_db.php', 'README.md', 'data']);

console.log('Starting cPanel Export build...');

function copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else if (!entry.name.endsWith('.html')) fs.copyFileSync(s, d);
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
    const rules = [
        [new RegExp(`fetch\\((${q})/api/settings\\1`, 'g'), "fetch($1api.php?action=settings$1"],
        [new RegExp(`fetch\\((${q})/api\\?action=`, 'g'), 'fetch($1api.php?action='],
        [new RegExp(`fetch\\((${q})/api\\?id=`, 'g'), 'fetch($1api.php?action=update_camp&id='],
        [new RegExp(`fetch\\((${q})/api/(instant|undo_instant|judge_stage_score|stage_scores|team_logs)\\?id=`, 'g'), 'fetch($1api.php?action=$2&id='],
        [new RegExp(`fetch\\((${q})/api/stage/close_tiered\\1`, 'g'), 'fetch($1api.php?action=close_tiered$1'],
        [new RegExp(`fetch\\((${q})/api/user/profile-pic\\1`, 'g'), 'fetch($1api.php?action=user_profile_pic$1'],
        [new RegExp(`fetch\\((${q})/login\\1`, 'g'), 'fetch($1api.php?action=login$1'],
        [new RegExp(`fetch\\((${q})/setup\\1`, 'g'), 'fetch($1api.php?action=setup$1'],
        [new RegExp(`fetch\\((${q})/superadmin/login\\1`, 'g'), 'fetch($1api.php?action=superadmin_login$1'],
        [new RegExp(`fetch\\((${q})/superadmin/camps\\1`, 'g'), 'fetch($1api.php?action=superadmin_camps$1'],
        [/fetch\(`\/superadmin\/camps\/\$\{(\w+)\}\/archive`/g, 'fetch(`api.php?action=superadmin_camp_archive&id=${$1}`'],
        [/fetch\(`\/superadmin\/camps\/\$\{(\w+)\}\/lock`/g, 'fetch(`api.php?action=superadmin_camp_lock&id=${$1}`'],
        [/fetch\(`\/superadmin\/camps\/\$\{(\w+)\}`/g, 'fetch(`api.php?action=superadmin_camp&id=${$1}`']
    ];
    for (const [re, rep] of rules) html = html.replace(re, rep);
    return html;
}

function assertNoAbsoluteApiUrls(name, html) {
    const left = html.match(/fetch\(\s*['`]\/[^'`]*/g);
    if (left) throw new Error(`${name}: unconverted API URLs: ${left.join(', ')}`);
}

// 1. superadmin.html
let sa = toPhpUrls(fs.readFileSync(path.join(SRC, 'superadmin.html'), 'utf8'));
// Operator links must work from a sub-folder (e.g. public_html/camp/)
sa = sa.replace(
    "document.getElementById('operatorLink').innerText = window.location.origin + '/' + link;",
    "const currentPath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);\n                    document.getElementById('operatorLink').innerText = window.location.origin + currentPath + link;"
);
assertNoAbsoluteApiUrls('superadmin.html', sa);
fs.writeFileSync(path.join(OUT, 'superadmin.html'), sa, 'utf8');
console.log('✓ superadmin.html');

// 2. operator.html
const op = toPhpUrls(fs.readFileSync(path.join(SRC, 'operator.html'), 'utf8'));
assertNoAbsoluteApiUrls('operator.html', op);
fs.writeFileSync(path.join(OUT, 'operator.html'), op, 'utf8');
console.log('✓ operator.html');

// 3. board.html: PHP hosting has no SSE, so poll instead.
let board = toPhpUrls(fs.readFileSync(path.join(SRC, 'board.html'), 'utf8'));
const sseBlockRegex = /\/\/ Replaced Heavy Polling with Lightweight SSE[\s\S]*?evtSource\.addEventListener\('splash'[\s\S]*?\}\);\s*\}/;
const pollingReplacement = `// Polling mode for cPanel / PHP Hosting
let lastSeenLogTime = Date.now();
let isFirstLoad = true;

function pollBoardState() {
    if (document.hidden) return;
    fetch(\`api.php?action=poll&id=\${campId}\`)
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(state => {
        latestState = state;
        let maxTime = lastSeenLogTime;
        (state.teams || []).forEach(t => {
            (Array.isArray(t.scoreLogs) ? t.scoreLogs : []).forEach(log => {
                if (!isFirstLoad && log.type === 'instant' && log.timestamp > lastSeenLogTime) {
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
    .catch(e => {});
}

pollBoardState();
setInterval(pollBoardState, 1500);
}`;
if (!sseBlockRegex.test(board)) throw new Error('board.html: EventSource block not found; update scripts/build_cpanel.cjs');
board = board.replace(sseBlockRegex, pollingReplacement);
assertNoAbsoluteApiUrls('board.html', board);
fs.writeFileSync(path.join(OUT, 'board.html'), board, 'utf8');
console.log('✓ board.html (SSE replaced with polling)');

// 4. Optional upload bundle
try {
    const zipPath = path.join(ROOT, 'cpanel_export.zip');
    fs.rmSync(zipPath, { force: true });
    execFileSync('zip', ['-qr', zipPath, '.', '-x', 'data/*'], { cwd: OUT });
    console.log('✓ cpanel_export.zip');
} catch (e) {
    console.warn('! zip not available; upload the cpanel_export folder contents instead.');
}

console.log('Build completed successfully!');
