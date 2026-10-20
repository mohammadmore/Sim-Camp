const fs = require('fs');
const path = require('path');

console.log("Starting cPanel Export build...");

// 1. Process superadmin.html
let saContent = fs.readFileSync(path.join(__dirname, '../public/superadmin.html'), 'utf8');

// Replace fetch calls
saContent = saContent.replace(/fetch\(['"]\/api\/settings['"]\)/g, "fetch('api.php?action=settings')");
saContent = saContent.replace(/fetch\(['"]\/api\/settings['"],/g, "fetch('api.php?action=settings',");
saContent = saContent.replace(/fetch\(['"]\/setup['"],/g, "fetch('api.php?action=setup',");
saContent = saContent.replace(/fetch\(['"]\/superadmin\/login['"],/g, "fetch('api.php?action=superadmin_login',");
saContent = saContent.replace(/fetch\(['"]\/superadmin\/camps['"]\)/g, "fetch('api.php?action=superadmin_camps')");
saContent = saContent.replace(/fetch\(`\/superadmin\/camps\/\$\{id\}\/archive`,/g, "fetch(`api.php?action=superadmin_camp_archive&id=${id}`,");
saContent = saContent.replace(/fetch\(`\/superadmin\/camps\/\$\{id\}\/lock`,/g, "fetch(`api.php?action=superadmin_camp_lock&id=${id}`,");
saContent = saContent.replace(/fetch\(`\/superadmin\/camps\/\$\{campId\}`\)/g, "fetch(`api.php?action=superadmin_camp&id=${campId}`)");

// Update link generation to be subfolder-aware
saContent = saContent.replace(
    "document.getElementById('operatorLink').innerText = window.location.origin + '/' + link;",
    "const currentPath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);\n                    document.getElementById('operatorLink').innerText = window.location.origin + currentPath + link;"
);

fs.writeFileSync(path.join(__dirname, '../cpanel_export/superadmin.html'), saContent, 'utf8');
console.log("✓ Updated cpanel_export/superadmin.html");

// 2. Process operator.html
let opContent = fs.readFileSync(path.join(__dirname, '../public/operator.html'), 'utf8');

opContent = opContent.replace(/fetch\(['"]\/api\/settings['"]\)/g, "fetch('api.php?action=settings')");
opContent = opContent.replace(/fetch\(['"]\/api\?action=info&id=['"] \+ campId\)/g, "fetch('api.php?action=info&id=' + campId)");
opContent = opContent.replace(/fetch\(`\/api\?action=poll&id=\$\{campId\}`\)/g, "fetch(`api.php?action=poll&id=${campId}`)");
opContent = opContent.replace(/fetch\(['"]\/api\?action=poll&id=['"] \+ campId\)/g, "fetch('api.php?action=poll&id=' + campId)");
opContent = opContent.replace(/fetch\(['"]\/login['"],/g, "fetch('api.php?action=login',");
opContent = opContent.replace(/fetch\(`\/api\/instant\?id=\$\{campId\}`,/g, "fetch(`api.php?action=instant&id=${campId}`,");
opContent = opContent.replace(/fetch\(['"]\/api\/instant\?id=['"] \+ campId,/g, "fetch('api.php?action=instant&id=' + campId,");
opContent = opContent.replace(/fetch\(`\/api\/undo_instant\?id=\$\{campId\}`,/g, "fetch(`api.php?action=undo_instant&id=${campId}`,");
opContent = opContent.replace(/fetch\(['"]\/api\/stage\/close_tiered['"],/g, "fetch('api.php?action=close_tiered',");
opContent = opContent.replace(/fetch\(`\/api\/judge_stage_score\?id=\$\{campId\}`,/g, "fetch(`api.php?action=judge_stage_score&id=${campId}`,");
opContent = opContent.replace(/fetch\(`\/api\?id=\$\{campId\}`,/g, "fetch(`api.php?action=update_camp&id=${campId}`,");
opContent = opContent.replace(/fetch\(['"]\/api\/user\/profile-pic['"],/g, "fetch('api.php?action=user_profile_pic',");

fs.writeFileSync(path.join(__dirname, '../cpanel_export/operator.html'), opContent, 'utf8');
console.log("✓ Updated cpanel_export/operator.html");

// 3. Process board.html
let boardContent = fs.readFileSync(path.join(__dirname, '../public/board.html'), 'utf8');

boardContent = boardContent.replace(/fetch\(['"]\/api\/settings['"]\)/g, "fetch('api.php?action=settings')");

// Replace EventSource block with robust polling in board.html
const sseBlockRegex = /\/\/ Replaced Heavy Polling with Lightweight SSE[\s\S]*?evtSource\.addEventListener\('splash'[\s\S]*?\}\);\s*\}/;

const pollingReplacement = `// Polling mode for cPanel / PHP Hosting
let lastSeenLogTime = Date.now();
let isFirstLoad = true;

function pollBoardState() {
    fetch(\`api.php?action=poll&id=\${campId}\`)
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(state => {
        latestState = state;
        let maxTime = lastSeenLogTime;
        if (!isFirstLoad) {
            (state.teams || []).forEach(t => {
                if (t.scoreLogs && Array.isArray(t.scoreLogs)) {
                    t.scoreLogs.forEach(log => {
                        if (log.type === 'instant' && log.timestamp > lastSeenLogTime) {
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
                        if (log.type === 'cancelled' && log.timestamp > lastSeenLogTime) {
                            const splash = document.getElementById('splash-' + log.id);
                            if (splash) {
                                const stamp = document.createElement('div');
                                stamp.className = 'cancel-stamp';
                                stamp.innerText = 'لغو شد';
                                splash.appendChild(stamp);
                            } else {
                                const qIdx = splashQueue.findIndex(sq => sq.logId === log.id);
                                if (qIdx !== -1) {
                                    splashQueue[qIdx].isCancelled = true;
                                }
                            }
                        }
                        if (log.timestamp && log.timestamp > maxTime) maxTime = log.timestamp;
                    });
                }
            });
        } else {
            (state.teams || []).forEach(t => {
                if (t.scoreLogs && Array.isArray(t.scoreLogs)) {
                    t.scoreLogs.forEach(log => {
                        if (log.timestamp && log.timestamp > maxTime) maxTime = log.timestamp;
                    });
                }
            });
            isFirstLoad = false;
        }
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
setInterval(pollBoardState, 1000);
}`;

if (sseBlockRegex.test(boardContent)) {
    boardContent = boardContent.replace(sseBlockRegex, pollingReplacement);
    console.log("✓ Replaced EventSource with polling in cpanel_export/board.html");
} else {
    console.warn("Could not find exact EventSource block in board.html, check manually.");
}

fs.writeFileSync(path.join(__dirname, '../cpanel_export/board.html'), boardContent, 'utf8');
console.log("✓ Updated cpanel_export/board.html");

console.log("Build script completed successfully!");
