const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

html = html.replace(
    /fetch\('\/api\/instant\?id=' \+ currentCampId, \{/g,
    "fetch('/api/instant?id=' + campId, {"
);

html = html.replace(
    /body: JSON\.stringify\(\{ teamId: fjSelectedTeamId, delta: delta, teamName: teamName, user: userName \}\)/g,
    "body: JSON.stringify({ teamId: fjSelectedTeamId, delta: delta, teamName: teamName, user: currentUser })"
);

fs.writeFileSync('public/operator.html', html);
console.log("Patched fj submit!");
