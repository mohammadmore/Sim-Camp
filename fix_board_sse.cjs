const fs = require('fs');
let html = fs.readFileSync('public/board.html', 'utf8');

// The polling block is complex, let's replace everything from "let lastSeenLogTime" to the end of the setInterval
const pollRegex = /let lastSeenLogTime = Date\.now\(\);\s*setInterval\(\(\) => \{[\s\S]*?\}\)\.catch\(e => \{\}\);\s*\}, 2000\);/;

const sseReplacement = `
// Replaced Heavy Polling with Lightweight SSE
const evtSource = new EventSource('/api?action=stream&id=' + campId);
evtSource.onmessage = function(e) {
    if (e.data === ':') return;
    latestState = JSON.parse(e.data);
    if (splashQueue.length === 0 && !isSplashing) {
        renderBoard(latestState);
    }
};

evtSource.addEventListener('splash', function(e) {
    const data = JSON.parse(e.data);
    splashQueue.push({
        teamId: data.teamId, 
        delta: data.delta, 
        teamName: data.teamName, 
        score: data.score, 
        logId: 'log_' + Date.now(), 
        user: data.user
    });
    if (!isSplashing) {
        runSplashQueue();
    }
});
`;

html = html.replace(pollRegex, sseReplacement);
fs.writeFileSync('public/board.html', html);
console.log('✅ Replaced Polling with SSE in board.html');
