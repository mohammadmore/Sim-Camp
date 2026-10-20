const fs = require('fs');

let html = fs.readFileSync('public/operator.html', 'utf8');

// 1. Add the CSS styles
const styles = `
    /* Field Judging Styles */
    .wheel-container {
        width: 140px;
        height: 250px;
        overflow-y: scroll;
        scroll-snap-type: y mandatory;
        scrollbar-width: none;
        -ms-overflow-style: none;
        border: 2px solid var(--glass-border);
        border-radius: 15px;
        background: var(--input-bg);
        position: relative;
    }
    .wheel-container::-webkit-scrollbar { display: none; }
    
    .wheel-item {
        height: 80px;
        display: flex;
        align-items: center;
        justify-content: center;
        scroll-snap-align: center;
        font-size: 35px;
        font-weight: bold;
        opacity: 0.3;
        transition: all 0.2s;
        user-select: none;
    }
    .wheel-item.active {
        opacity: 1;
        font-size: 45px;
    }
    .wheel-highlight {
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        height: 80px;
        margin-top: -40px;
        border-top: 2px solid var(--glass-border);
        border-bottom: 2px solid var(--glass-border);
        background: rgba(255,255,255,0.05);
        pointer-events: none;
    }
    
    .fj-team-btn {
        width: 100%;
        padding: 20px;
        font-size: 24px;
        border-radius: 15px;
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        color: var(--text-color);
        cursor: pointer;
        transition: all 0.2s;
        font-weight: bold;
    }
    .fj-team-btn:active {
        transform: scale(0.98);
        background: var(--glass-border);
    }
`;
html = html.replace('</style>', styles + '\n    </style>');

// 2. Insert the button in the header
const btnHtml = `
                <button id="btnFieldJudging" onclick="openFieldJudging()" class="icon-btn" style="border-radius: 8px; font-size: 14px; padding: 0 16px; height: 42px; box-sizing: border-box; background: var(--purple-bg, #9333ea20); color: var(--purple-color, #c084fc); border-color: var(--purple-color, #c084fc); display: none;" title="داوری سریع میدانی">داوری میدانی <i data-lucide="smartphone" style="width: 16px; height: 16px; margin-right: 6px;"></i></button>
`;
// Find a good place to insert it. Before btnSettings
html = html.replace('<button onclick="openSettings()" id="btnSettings"', btnHtml + '                <button onclick="openSettings()" id="btnSettings"');

// 3. Show button if role allows
const roleLogic = `
            if (typeof refreshIcons === 'function') refreshIcons();
            
            const fieldBtn = document.getElementById('btnFieldJudging');
            if (currentUser && (currentUser.role === 'referee' || currentUser.role === 'head_referee')) {
                if(fieldBtn) fieldBtn.style.display = 'flex';
            } else {
                if(fieldBtn) fieldBtn.style.display = 'none';
            }
`;
html = html.replace(/if \(typeof refreshIcons === 'function'\) refreshIcons\(\);/, roleLogic);

// 4. Inject Modal HTML before </body>
const modalHtml = `
    <!-- Field Judging Modal -->
    <div id="fieldJudgingModal" class="modal-overlay" style="z-index: 10000; background: var(--bg-color);">
        <!-- Team List View -->
        <div id="fjTeamList" style="width: 100%; height: 100%; max-width: 600px; margin: 0 auto; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 15px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2 style="margin: 0; font-size: 24px;">داوری میدانی (انتخاب تیم)</h2>
                <button onclick="closeFieldJudging()" class="icon-btn remove-btn" style="width: 40px; height: 40px; border-radius: 50%;">×</button>
            </div>
            <div id="fjTeamsContainer" style="display: flex; flex-direction: column; gap: 15px;"></div>
        </div>

        <!-- Scoring View -->
        <div id="fjScoringView" style="width: 100%; height: 100%; max-width: 600px; margin: 0 auto; padding: 20px; display: none; flex-direction: column; align-items: center; justify-content: space-between;">
            <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <button onclick="backToFjTeamList()" class="icon-btn" style="padding: 10px 20px;">بازگشت</button>
                <h2 id="fjSelectedTeamName" style="margin: 0; font-size: 26px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60%;">نام تیم</h2>
                <div style="width: 70px;"></div> <!-- Spacer -->
            </div>

            <div style="display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 20px; flex-grow: 1;">
                
                <!-- Sign Wheel -->
                <div id="fjSignWheel" class="wheel-container">
                    <div class="wheel-highlight"></div>
                    <div style="height: 85px;"></div>
                    <div class="wheel-item" data-val="+">+</div>
                    <div class="wheel-item" data-val="-">-</div>
                    <div style="height: 85px;"></div>
                </div>

                <!-- Value Wheel -->
                <div id="fjValueWheel" class="wheel-container">
                    <div class="wheel-highlight"></div>
                    <div style="height: 85px;"></div>
                    <!-- populated by JS -->
                </div>

            </div>

            <!-- Big Submit Button -->
            <button id="fjSubmitBtn" onclick="submitFjScore()" style="width: 100%; padding: 25px; font-size: 26px; border-radius: 15px; margin-top: 30px; border: none; font-weight: bold; cursor: pointer; display: flex; justify-content: center; align-items: center; gap: 15px; transition: all 0.2s;">
                ثبت <span id="fjPreviewValue" dir="ltr" style="font-size: 32px;">+5</span>
            </button>
        </div>
    </div>
`;
html = html.replace('</body>', modalHtml + '\n</body>');

// 5. Inject JavaScript Logic
const jsLogic = `
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
        valWheel.innerHTML = valHtml;

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
        preview.innerText = text;
        
        if (fjCurrentSign === '+') {
            submitBtn.style.background = 'var(--success-color)';
            submitBtn.style.color = '#000';
            valWheelItems.forEach(i => i.style.color = 'var(--success-color)');
        } else {
            submitBtn.style.background = 'var(--danger-color)';
            submitBtn.style.color = '#fff';
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
html = html.replace('</script>\n    <div class="asva-spacer"', jsLogic + '    <div class="asva-spacer"');

fs.writeFileSync('public/operator.html', html);
console.log("Patched successfully!");
