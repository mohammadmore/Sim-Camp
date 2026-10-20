const fs = require('fs');
let content = fs.readFileSync('public/operator.html', 'utf-8');

// The corrupted part is inside openScoreModal and saveScores
const corruptedStart = "        function openScoreModal(stageId) {";
const cleanPart = `        function openScoreModal(stageId) {
            if(isLocked) return alert("مسابقه قفل است.");
            const stage = currentStages.find(s => s.id === stageId);
            if(!stage) return;
            document.getElementById('scoreStageTitle').innerText = 'امتیازات مرحله: ' + stage.name;
            document.getElementById('currentStageId').value = stage.id;
            
            const list = document.getElementById('scoreTeamsList');
            list.innerHTML = '';
            currentTeams.forEach(team => {
                let currentScore = 0;
                if(team.stageScores && team.stageScores[stage.id] !== undefined) {
                    currentScore = team.stageScores[stage.id];
                }
                list.innerHTML += \`
                    <div class="glass" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 15px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 15px; height: 15px; border-radius: 50%; background: \${team.color};"></div>
                            <span style="font-weight: bold;">\${team.name}</span>
                        </div>
                        <input type="number" id="score_\${team.id}" value="\${currentScore}" class="stage-input" style="width: 70px; padding: 5px;">
                    </div>
                \`;
            });
            document.getElementById('scoreModal').style.display = 'flex';
        }

        function saveScores() {
            if (isLocked) return;
            const stageId = document.getElementById('currentStageId').value;
            currentTeams.forEach(team => {
                const input = document.getElementById(\`score_\${team.id}\`);
                if(input) {
                    const val = parseInt(input.value) || 0;
                    if (!team.stageScores) team.stageScores = {};
                    team.stageScores[stageId] = val;
                    
                    let stageSum = 0;
                    for (let s in team.stageScores) stageSum += (parseInt(team.stageScores[s]) || 0);
                    let logsSum = (team.scoreLogs || []).reduce((a, b) => a + (parseInt(b.value)||0), 0);
                    team.score = stageSum + logsSum;
                }
            });
            syncData();
            document.getElementById('scoreModal').style.display = 'none';
        }

        function syncData() {`;

const idx = content.indexOf(corruptedStart);
const syncDataIdx = content.indexOf("        function syncData() {", idx);
if (idx > -1 && syncDataIdx > -1) {
    content = content.substring(0, idx) + cleanPart + content.substring(syncDataIdx + 29);
    fs.writeFileSync('public/operator.html', content);
    console.log("Fixed!");
} else {
    console.log("Failed to find indices");
}
