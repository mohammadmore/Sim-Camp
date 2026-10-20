const fs = require('fs');

// 1. Fix Firestore Rules
const rules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false; // Only Admin SDK (backend) can access DB
    }
  }
}`;
fs.writeFileSync('firestore.rules', rules);
console.log('✅ Secured firestore.rules');

// 2. Fix Operator Polling (Replace with SSE)
let opHtml = fs.readFileSync('public/operator.html', 'utf8');
opHtml = opHtml.replace(
    /setInterval\(\(\) => \{\s*fetch\(\`\/api\?action=poll&id=\$\{campId\}\`\)\s*\.then\(res => res\.ok \? res\.json\(\) : Promise\.reject\(\)\)\s*\.then\(data => \{\s*isLocked = data\.locked;\s*currentTeams = data\.teams;\s*ensureLogsFormat\(currentTeams\);\s*currentStages = data\.stages \|\| \[\];\s*renderOperatorBoard\(\);\s*renderStageScores\(\);\s*renderTotalScores\(\);\s*renderScoreLogs\(\);\s*\}\)\.catch\(err => console\.log\('Poll error', err\)\);\s*\}, 2000\);/g,
    `const evtSource = new EventSource('/api?action=stream&id=' + campId);
        evtSource.onmessage = function(e) {
            if (e.data === ':') return;
            const data = JSON.parse(e.data);
            isLocked = data.locked;
            currentTeams = data.teams;
            ensureLogsFormat(currentTeams);
            currentStages = data.stages || [];
            renderOperatorBoard();
            renderStageScores();
            renderTotalScores();
            renderScoreLogs();
        };
        evtSource.onerror = function(err) {
            console.error('SSE Error', err);
        };`
);
fs.writeFileSync('public/operator.html', opHtml);
console.log('✅ Replaced Polling with SSE in operator.html');

