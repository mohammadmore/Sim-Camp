const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

const jsLogic = `
<script>
    let fjSelectedTeamId = null;
    let fjCurrentSign = '+';
    let fjCurrentValue = 5;

    function openFieldJudging() {
        if (isLocked) {
            showFloatingError("مسابقه قفل است.");
            return;
        }
        document.getElementById('fieldJudgingModal').style.display = 'flex';
        document.getElementById('fjScoringView').style.display = 'none';
        document.getElementById('fjTeamList').style.display = 'flex';
        
        const container = document.getElementById('fjTeamsContainer');
        container.innerHTML = '';
        currentTeams.forEach(team => {
            const btn = document.createElement('button');
            btn.className = 'fj-team-btn';
            btn.style.borderRight = '10px solid ' + team.color;
            btn.innerText = team.name;
            btn.onclick = () => openFjScoring(team);
            container.appendChild(btn);
        });
    }

    function closeFieldJudging() {
        document.getElementById('fieldJudgingModal').style.display = 'none';
    }

    function backToFjTeamList() {
        document.getElementById('fjScoringView').style.display = 'none';
        document.getElementById('fjTeamList').style.display = 'flex';
    }

    function openFjScoring(team) {
        fjSelectedTeamId = team.id;
        document.getElementById('fjSelectedTeamName').innerText = team.name;
        document.getElementById('fjTeamList').style.display = 'none';
        document.getElementById('fjScoringView').style.display = 'flex';
        
        // Reset selections to defaults (+ and 5)
        setTimeout(() => {
            const signWheel = document.getElementById('fjSignWheel');
            const valWheel = document.getElementById('fjValueWheel');
            signWheel.scrollTo({ top: 0, behavior: 'smooth' });
            valWheel.scrollTo({ top: 0, behavior: 'smooth' });
            updateFjPreview();
        }, 50);
    }

    // Populate Value Wheel
    document.addEventListener("DOMContentLoaded", () => {
        const valWheel = document.getElementById('fjValueWheel');
        let valHtml = '<div class="wheel-highlight"></div><div style="height: 85px;"></div>';
        for (let i = 5; i <= 100; i += 5) {
            valHtml += \`<div class="wheel-item" data-val="\${i}">\${i}</div>\`;
        }
        valHtml += '<div style="height: 85px;"></div>';
        if (valWheel) valWheel.innerHTML = valHtml;

        initWheel('fjSignWheel', (val) => {
            fjCurrentSign = val;
            updateFjPreview();
        });

        initWheel('fjValueWheel', (val) => {
            fjCurrentValue = parseInt(val);
            updateFjPreview();
        });
    });

    function initWheel(containerId, onSelect) {
        const container = document.getElementById(containerId);
        if(!container) return;
        container.addEventListener('scroll', () => {
            clearTimeout(container.scrollTimeout);
            container.scrollTimeout = setTimeout(() => {
                const items = container.querySelectorAll('.wheel-item');
                let closest = null;
                let minDiff = Infinity;
                const containerCenter = container.scrollTop + container.clientHeight / 2;
                
                items.forEach(item => {
                    const itemCenter = item.offsetTop + item.offsetHeight / 2;
                    const diff = Math.abs(containerCenter - itemCenter);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closest = item;
                    }
                    item.classList.remove('active');
                });
                
                if (closest) {
                    closest.classList.add('active');
                    onSelect(closest.dataset.val);
                }
            }, 50); // fast snap response
        });
    }

    function updateFjPreview() {
        const preview = document.getElementById('fjPreviewValue');
        const submitBtn = document.getElementById('fjSubmitBtn');
        const valWheelItems = document.querySelectorAll('#fjValueWheel .wheel-item');
        
        const text = fjCurrentSign + fjCurrentValue;
        if(preview) preview.innerText = text;
        
        if (fjCurrentSign === '+') {
            if(submitBtn) {
                submitBtn.style.background = 'var(--success-color)';
                submitBtn.style.color = '#000';
            }
            valWheelItems.forEach(i => i.style.color = 'var(--success-color)');
        } else {
            if(submitBtn) {
                submitBtn.style.background = 'var(--danger-color)';
                submitBtn.style.color = '#fff';
            }
            valWheelItems.forEach(i => i.style.color = 'var(--danger-color)');
        }
    }

    function submitFjScore() {
        if(isLocked) {
            showFloatingError("مسابقه قفل است.");
            return;
        }
        const delta = parseInt(fjCurrentSign + fjCurrentValue);
        const teamName = document.getElementById('fjSelectedTeamName').innerText;
        const userName = currentUser ? (currentUser.firstName + ' ' + currentUser.lastName) : 'نامشخص';
        
        fetch('/api/instant?id=' + currentCampId, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ teamId: fjSelectedTeamId, delta: delta, teamName: teamName, user: userName })
        }).then(r => r.json()).then(res => {
            if(res.success) {
                // Show a quick success overlay or just go back
                const btn = document.getElementById('fjSubmitBtn');
                const oldHtml = btn.innerHTML;
                const oldBg = btn.style.background;
                btn.innerHTML = '✔ ثبت شد';
                btn.style.background = '#3b82f6'; // Blue for success tick
                setTimeout(() => {
                    btn.innerHTML = oldHtml;
                    btn.style.background = oldBg;
                    backToFjTeamList();
                }, 700);
            }
        });
    }
</script>
`;
html = html.replace('</body>', jsLogic + '\n</body>');
fs.writeFileSync('public/operator.html', html);
