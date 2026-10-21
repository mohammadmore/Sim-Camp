const fs = require('fs');
let html = fs.readFileSync('public/operator.html', 'utf8');

// Remove old CSS
html = html.replace(/\/\* Field Judging Styles \*\/[\s\S]*?\/\* End Field Judging Styles \*\//, '');
html = html.replace(/\/\* Field Judging Styles \*\/[\s\S]*?<\/style>/, '</style>'); // wait, we did not put end comment before.

// Find the start of the injected Field Judging Modal
const modalStartIdx = html.indexOf('<!-- Field Judging Modal -->');
if (modalStartIdx !== -1) {
    html = html.substring(0, modalStartIdx);
}

// Ensure </body></html> is present
if (!html.includes('</body>')) {
    html += '\n</body>\n</html>';
}

const styles = `
    /* Field Judging Styles V2 */
    #fieldJudgingModal {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: var(--bg-color); z-index: 10000;
        display: none; flex-direction: column;
    }
    
    .fj-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 20px;
    }
    
    .fj-teams-grid {
        display: flex; flex-wrap: wrap; justify-content: center; gap: 15px;
        padding: 20px; flex-grow: 1; align-content: flex-start;
        position: relative;
    }
    
    .fj-team-circle {
        width: 100px; height: 100px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        text-align: center; color: #fff; font-weight: bold; font-size: 18px;
        cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        text-shadow: 0px 1px 3px rgba(0,0,0,0.8);
        border: 2px solid rgba(255,255,255,0.2);
        position: relative;
        z-index: 1;
        padding: 5px;
        line-height: 1.2;
    }

    .fj-team-circle.fj-hidden {
        transform: scale(0);
        opacity: 0;
        pointer-events: none;
        position: absolute;
    }

    .fj-team-circle.fj-selected {
        transform: scale(1.2);
        z-index: 10;
        margin-bottom: 20px;
        cursor: default;
    }

    .fj-scoring-area {
        width: 100%; display: flex; flex-direction: column; align-items: center;
        opacity: 0; transform: translateY(20px); pointer-events: none;
        transition: all 0.4s ease;
        position: absolute; top: 160px; left: 0; right: 0; padding: 0 20px;
    }

    .fj-scoring-area.visible {
        opacity: 1; transform: translateY(0); pointer-events: auto;
    }

    .wheel-container {
        width: 130px; height: 200px; overflow-y: scroll; scroll-snap-type: y mandatory;
        scrollbar-width: none; -ms-overflow-style: none;
        border: 2px solid var(--glass-border); border-radius: 15px;
        background: var(--input-bg); position: relative;
    }
    .wheel-container::-webkit-scrollbar { display: none; }
    
    .wheel-item {
        height: 60px; display: flex; align-items: center; justify-content: center;
        scroll-snap-align: center; font-size: 30px; font-weight: bold;
        opacity: 0.3; transition: all 0.2s; user-select: none;
    }
    .wheel-item.active { opacity: 1; font-size: 40px; }
    
    .wheel-highlight {
        position: absolute; top: 50%; left: 0; right: 0; height: 60px; margin-top: -30px;
        border-top: 2px solid var(--glass-border); border-bottom: 2px solid var(--glass-border);
        background: rgba(255,255,255,0.05); pointer-events: none;
    }
    
    .fj-wheels-wrapper {
        display: flex; gap: 20px; justify-content: center; width: 100%; margin-bottom: 30px;
    }
    /* End Field Judging Styles V2 */
`;
html = html.replace('</style>', styles + '\n    </style>');

const modalHtml = `
    <!-- Field Judging Modal V2 -->
    <div id="fieldJudgingModal">
        <div class="fj-header">
            <button id="fjBackBtn" onclick="backToFjGrid()" class="icon-btn" style="padding: 10px 20px; opacity: 0; pointer-events: none; transition: 0.3s;">بازگشت</button>
            <h2 id="fjMainTitle" style="margin: 0; font-size: 22px; transition: 0.3s;">داوری میدانی</h2>
            <button onclick="closeFieldJudging()" class="icon-btn remove-btn" style="width: 40px; height: 40px; border-radius: 50%; font-size: 20px;">×</button>
        </div>
        
        <div class="fj-teams-grid" id="fjTeamsContainer">
            <!-- Circles injected here -->
        </div>

        <div class="fj-scoring-area" id="fjScoringArea">
            <div class="fj-wheels-wrapper">
                <!-- Sign Wheel -->
                <div id="fjSignWheel" class="wheel-container">
                    <div class="wheel-highlight"></div>
                    <div style="height: 70px;"></div>
                    <div class="wheel-item" data-val="+">+</div>
                    <div class="wheel-item" data-val="-">-</div>
                    <div style="height: 70px;"></div>
                </div>

                <!-- Value Wheel -->
                <div id="fjValueWheel" class="wheel-container">
                    <div class="wheel-highlight"></div>
                    <div style="height: 70px;"></div>
                    <!-- populated by JS -->
                </div>
            </div>

            <!-- Big Submit Button -->
            <button id="fjSubmitBtn" onclick="submitFjScore()" style="width: 100%; max-width: 400px; padding: 20px; font-size: 24px; border-radius: 15px; border: none; font-weight: bold; cursor: pointer; display: flex; justify-content: center; align-items: center; gap: 15px; transition: all 0.2s;">
                ثبت <span id="fjPreviewValue" dir="ltr" style="font-size: 28px;">+5</span>
            </button>
        </div>
    </div>
    
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
        resetFjGrid();
        
        const container = document.getElementById('fjTeamsContainer');
        container.innerHTML = '';
        currentTeams.forEach(team => {
            const circle = document.createElement('div');
            circle.className = 'fj-team-circle';
            circle.style.backgroundColor = team.color;
            circle.innerText = team.name;
            circle.dataset.id = team.id;
            circle.onclick = () => selectFjTeam(circle, team);
            container.appendChild(circle);
        });
    }

    function closeFieldJudging() {
        document.getElementById('fieldJudgingModal').style.display = 'none';
    }

    function resetFjGrid() {
        fjSelectedTeamId = null;
        document.getElementById('fjScoringArea').classList.remove('visible');
        document.getElementById('fjBackBtn').style.opacity = '0';
        document.getElementById('fjBackBtn').style.pointerEvents = 'none';
        document.getElementById('fjMainTitle').innerText = 'داوری میدانی';
        
        const circles = document.querySelectorAll('.fj-team-circle');
        circles.forEach(c => {
            c.classList.remove('fj-hidden');
            c.classList.remove('fj-selected');
        });
    }

    function backToFjGrid() {
        resetFjGrid();
    }

    function selectFjTeam(circleEl, team) {
        if (fjSelectedTeamId) return; // already selected
        fjSelectedTeamId = team.id;
        
        document.getElementById('fjMainTitle').innerText = team.name;
        document.getElementById('fjBackBtn').style.opacity = '1';
        document.getElementById('fjBackBtn').style.pointerEvents = 'auto';

        const allCircles = document.querySelectorAll('.fj-team-circle');
        allCircles.forEach(c => {
            if (c === circleEl) {
                c.classList.add('fj-selected');
            } else {
                c.classList.add('fj-hidden');
            }
        });

        document.getElementById('fjScoringArea').classList.add('visible');

        // Reset selections to defaults (+ and 5)
        setTimeout(() => {
            const signWheel = document.getElementById('fjSignWheel');
            const valWheel = document.getElementById('fjValueWheel');
            signWheel.scrollTo({ top: 0, behavior: 'auto' });
            valWheel.scrollTo({ top: 0, behavior: 'auto' });
            fjCurrentSign = '+';
            fjCurrentValue = 5;
            updateFjPreview();
        }, 50);
    }

    // Populate Value Wheel
    document.addEventListener("DOMContentLoaded", () => {
        const valWheel = document.getElementById('fjValueWheel');
        let valHtml = '<div class="wheel-highlight"></div><div style="height: 70px;"></div>';
        for (let i = 5; i <= 100; i += 5) {
            valHtml += \`<div class="wheel-item" data-val="\${i}">\${i}</div>\`;
        }
        valHtml += '<div style="height: 70px;"></div>';
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
        const teamName = document.getElementById('fjMainTitle').innerText;
        const userName = currentUser ? (currentUser.firstName + ' ' + currentUser.lastName) : 'نامشخص';
        
        fetch('/api/instant?id=' + currentCampId, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ teamId: fjSelectedTeamId, delta: delta, teamName: teamName, user: userName })
        }).then(r => r.json()).then(res => {
            if(res.success) {
                const btn = document.getElementById('fjSubmitBtn');
                const oldHtml = btn.innerHTML;
                const oldBg = btn.style.background;
                btn.innerHTML = '✔ ثبت شد';
                btn.style.background = '#3b82f6'; // Blue
                setTimeout(() => {
                    btn.innerHTML = oldHtml;
                    btn.style.background = oldBg;
                    backToFjGrid();
                }, 700);
            }
        });
    }
</script>
`;

html = html.replace('</body>', modalHtml + '\n</body>');
fs.writeFileSync('public/operator.html', html);
console.log("Patched successfully!");
