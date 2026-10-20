if (typeof window._conflicts === 'undefined') {
    window._conflicts = new Map();
}

function validateRealTime() {
    let errorIds = new Set();
    let hasErrors = false;
    let errors = [];
    let newConflicts = [];

    const teamElements = document.querySelectorAll('#teamsList .dynamic-item, #editTeamsList .dynamic-item');
    if(teamElements.length > 0) {
        const teams = Array.from(teamElements).map(el => {
            const inputs = el.querySelectorAll('input');
            const colorBtn = el.querySelector('.color-btn');
            return { 
                id: el.dataset.id, 
                name: inputs[0] ? inputs[0].value.trim() : '', 
                color: colorBtn ? colorBtn.dataset.value : '',
                el: el
            };
        }).filter(t => t.name !== '');

        const nameMap = new Map();
        const colorMap = new Map();

        for (let t of teams) {
            if (!nameMap.has(t.name)) nameMap.set(t.name, []);
            nameMap.get(t.name).push(t);
            
            if (!colorMap.has(t.color)) colorMap.set(t.color, []);
            colorMap.get(t.color).push(t);
        }

        for (let [name, tms] of nameMap.entries()) {
            if (tms.length > 1) {
                hasErrors = true;
                tms.forEach(t => errorIds.add(t.id));
                errors.push(`نام تیم "${name}" تکراری است.`);
                
                tms.sort((a,b) => a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top);
                for(let i=0; i<tms.length-1; i++){
                    newConflicts.push({ id1: tms[i].id, id2: tms[i+1].id, el1: tms[i].el, el2: tms[i+1].el, type: 'name', text: 'اسم مشابه' });
                }
            }
        }

        for (let [color, tms] of colorMap.entries()) {
            if (tms.length > 1) {
                hasErrors = true;
                tms.forEach(t => errorIds.add(t.id));
                const teamNames = tms.map(t => t.name).join(' و ');
                errors.push(`رنگ تکراری برای تیم‌های: ${teamNames}`);
                
                tms.sort((a,b) => a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top);
                for(let i=0; i<tms.length-1; i++){
                    newConflicts.push({ id1: tms[i].id, id2: tms[i+1].id, el1: tms[i].el, el2: tms[i+1].el, type: 'color', text: 'رنگ مشابه' });
                }
            }
        }
    }

    const stageElements = document.querySelectorAll('#stagesList .dynamic-item, #editStagesList .dynamic-item');
    if (stageElements.length > 0) {
        const stages = Array.from(stageElements).map(el => {
            const input = el.querySelector('input');
            return { 
                id: el.dataset.id, 
                name: input ? input.value.trim() : '',
                el: el
            };
        }).filter(s => s.name !== '');

        const stageNameMap = new Map();
        for (let s of stages) {
            if (!stageNameMap.has(s.name)) stageNameMap.set(s.name, []);
            stageNameMap.get(s.name).push(s);
        }

        for (let [name, stgs] of stageNameMap.entries()) {
            if (stgs.length > 1) {
                hasErrors = true;
                stgs.forEach(s => errorIds.add(s.id));
                errors.push(`نام مرحله "${name}" تکراری است.`);
                
                stgs.sort((a,b) => a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top);
                for(let i=0; i<stgs.length-1; i++){
                    newConflicts.push({ id1: stgs[i].id, id2: stgs[i+1].id, el1: stgs[i].el, el2: stgs[i+1].el, type: 'stage', text: 'اسم مشابه' });
                }
            }
        }
    }

    const userElements = document.querySelectorAll('#usersList .dynamic-item');
    if (userElements.length > 0) {
        const users = Array.from(userElements).map(el => {
            const uInput = el.querySelector('.u-user');
            return { 
                id: el.dataset.id, 
                username: uInput ? uInput.value.trim() : '',
                el: el
            };
        }).filter(u => u.username !== '');

        const usernameMap = new Map();
        for (let u of users) {
            if (!usernameMap.has(u.username)) usernameMap.set(u.username, []);
            usernameMap.get(u.username).push(u);
        }

        for (let [username, usrs] of usernameMap.entries()) {
            if (usrs.length > 1) {
                hasErrors = true;
                usrs.forEach(u => errorIds.add(u.id));
                errors.push(`نام کاربری "${username}" تکراری است.`);
                
                usrs.sort((a,b) => a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top);
                for(let i=0; i<usrs.length-1; i++){
                    newConflicts.push({ id1: usrs[i].id, id2: usrs[i+1].id, el1: usrs[i].el, el2: usrs[i+1].el, type: 'username', text: 'نام مشابه' });
                }
            }
        }
    }

    const allElements = document.querySelectorAll('.dynamic-item');
    allElements.forEach(el => {
        const id = el.dataset.id;
        const wasRed = el.style.border.includes('ff4c4c') || el.style.border.includes('rgb(255, 76, 76)');
        
        if (errorIds.has(id)) {
            el.style.border = '2px solid #ff4c4c';
            el.style.boxShadow = '0 0 10px rgba(255, 76, 76, 0.4)';
            el.style.borderRadius = '10px';
        } else {
            if (wasRed) {
                el.style.border = '2px solid #4CAF50';
                el.style.boxShadow = '0 0 10px rgba(76, 175, 80, 0.4)';
                el.style.borderRadius = '10px';
            }
        }
    });

    let toast = document.getElementById('floatingErrorToast');
    
    if (!hasErrors) {
        if (toast && toast.classList.contains('error')) {
            if (typeof window.showToast === 'function') {
                window.showToast('مشکل برطرف شد!', 'success');
            } else {
                toast.style.background = '#4CAF50';
                toast.style.boxShadow = '0 5px 15px rgba(76, 175, 80, 0.4)';
                toast.innerHTML = 'مشکل برطرف شد!<span style="position: absolute; top: 5px; left: 15px; cursor: pointer; font-size: 24px;" onclick="this.parentElement.remove()">×</span>';
                setTimeout(() => { if (toast && toast.parentElement) toast.remove(); }, 3000);
            }
        }
    } else {
        const msg = "خطاهای زیر یافت شد:\n\n" + errors.join('\n');
        if (typeof window.showToast === 'function') {
            window.showToast(msg, 'error');
        } else if (typeof showFloatingError === 'function') {
            showFloatingError(msg);
        } else {
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'floatingErrorToast';
                toast.style.position = 'fixed';
                toast.style.bottom = '30px';
                toast.style.left = '50%';
                toast.style.transform = 'translateX(-50%)';
                toast.style.background = '#ff4c4c';
                toast.style.color = '#fff';
                toast.style.padding = '15px 40px 15px 25px';
                toast.style.borderRadius = '10px';
                toast.style.boxShadow = '0 5px 15px rgba(255, 76, 76, 0.4)';
                toast.style.zIndex = '10000';
                toast.style.textAlign = 'right';
                toast.style.direction = 'rtl';
                toast.style.fontSize = '14px';
                toast.style.lineHeight = '1.8';
                document.body.appendChild(toast);
            }
            toast.style.background = '#ff4c4c';
            toast.style.boxShadow = '0 5px 15px rgba(255, 76, 76, 0.4)';
            toast.innerHTML = msg.replace(/\n/g, '<br>') + '<span style="position: absolute; top: 5px; left: 15px; cursor: pointer; font-size: 24px;" onclick="this.parentElement.remove()">×</span>';
        }
    }

    updateConflictLines(newConflicts);
}

function updateConflictLines(newConflicts) {
    let nextConflictsMap = new Map();
    
    newConflicts.forEach(c => {
        let key = `${c.id1}-${c.id2}-${c.type}`;
        if (c.id1 > c.id2) key = `${c.id2}-${c.id1}-${c.type}`;
        
        let existing = window._conflicts.get(key);
        if (existing) {
            if (existing.timer) clearTimeout(existing.timer);
            nextConflictsMap.set(key, { ...existing, el1: c.el1, el2: c.el2, status: 'error', text: c.text });
        } else {
            nextConflictsMap.set(key, { ...c, status: 'error', key });
        }
    });

    window._conflicts.forEach((existing, key) => {
        if (!nextConflictsMap.has(key)) {
            if (existing.status === 'error') {
                existing.status = 'resolved';
                existing.text = 'حل شد';
                existing.timer = setTimeout(() => {
                    window._conflicts.delete(key);
                    renderConflictLines();
                }, 3000);
                nextConflictsMap.set(key, existing);
            } else {
                nextConflictsMap.set(key, existing);
            }
        }
    });

    window._conflicts = nextConflictsMap;
    renderConflictLines();
}

function renderConflictLines() {
    let container = document.getElementById('conflict-lines-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'conflict-lines-container';
        container.style.position = 'absolute';
        container.style.top = '0';
        container.style.left = '0';
        container.style.width = '100%';
        container.style.height = '100%';
        container.style.pointerEvents = 'none';
        container.style.zIndex = '9998';
        container.style.overflow = 'hidden';
        document.body.appendChild(container);
    }
    
    let svg = container.querySelector('svg');
    if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';
        container.appendChild(svg);
    }
    
    const docWidth = document.documentElement.scrollWidth;
    const docHeight = document.documentElement.scrollHeight;
    container.style.width = docWidth + 'px';
    container.style.height = docHeight + 'px';
    svg.setAttribute('width', docWidth);
    svg.setAttribute('height', docHeight);
    svg.setAttribute('viewBox', `0 0 ${docWidth} ${docHeight}`);
    
    svg.innerHTML = '';
    
    if (window._conflicts.size === 0) return;
    
    let lines = Array.from(window._conflicts.values()).map(c => {
        let rect1 = c.el1.getBoundingClientRect();
        let rect2 = c.el2.getBoundingClientRect();
        
        let topY = Math.min(rect1.top, rect2.top) + window.scrollY + rect1.height / 2;
        let bottomY = Math.max(rect1.top, rect2.top) + window.scrollY + rect1.height / 2;
        
        // Calculate true boundaries including any children that might overflow the flex container
        let leftX = Infinity;
        let rightX = -Infinity;
        
        [c.el1, c.el2].forEach(el => {
            let r = el.getBoundingClientRect();
            if (r.left < leftX) leftX = r.left;
            if (r.right > rightX) rightX = r.right;
            
            Array.from(el.children).forEach(child => {
                let cr = child.getBoundingClientRect();
                if (cr.width > 0) { // Ignore hidden/empty children
                    if (cr.left < leftX) leftX = cr.left;
                    if (cr.right > rightX) rightX = cr.right;
                }
            });
        });
        
        leftX += window.scrollX;
        rightX += window.scrollX;
        
        return { ...c, topY, bottomY, leftX, rightX };
    });
    
    lines.sort((a,b) => (a.bottomY - a.topY) - (b.bottomY - b.topY));
    
    let tracks = [];
    
    for (let line of lines) {
        let placed = false;
        let attempt = 0;
        
        let spaceLeft = line.leftX;
        let spaceRight = docWidth - line.rightX;
        
        // Smart side selection: prefer the side that actually has space
        let sidesToTry = [];
        if (spaceRight >= 45 && spaceLeft < 45) {
            sidesToTry = ['right'];
        } else if (spaceLeft >= 45 && spaceRight < 45) {
            sidesToTry = ['left'];
        } else if (spaceRight >= spaceLeft) {
            sidesToTry = ['right', 'left'];
        } else {
            sidesToTry = ['left', 'right'];
        }
        
        while (!placed && attempt < 30) {
            let side = sidesToTry[attempt % sidesToTry.length];
            let trackIndex = Math.floor(attempt / sidesToTry.length);
            
            let trackInfo = tracks.find(t => t.side === side && t.trackIndex === trackIndex);
            if (!trackInfo) {
                tracks.push({ side, trackIndex, segments: [{top: line.topY, bottom: line.bottomY}] });
                line.side = side;
                line.trackIndex = trackIndex;
                placed = true;
            } else {
                let overlap = trackInfo.segments.some(seg => {
                    return Math.max(line.topY - 50, seg.top) < Math.min(line.bottomY + 50, seg.bottom);
                });
                if (!overlap) {
                    trackInfo.segments.push({top: line.topY, bottom: line.bottomY});
                    line.side = side;
                    line.trackIndex = trackIndex;
                    placed = true;
                }
            }
            attempt++;
        }
    }
    
    const SPACING = 30; // Increased spacing so lines are more distinct
    const BASE_OFFSET_RIGHT = 40; // Offset for right side
    const BASE_OFFSET_LEFT = 55; // Increased offset for left side to clear the buttons
    
    for (let line of lines) {
        let color = line.status === 'error' ? '#ff4c4c' : '#4CAF50';
        let isRight = line.side === 'right';
        let offsetX = isRight ? line.rightX + BASE_OFFSET_RIGHT + (line.trackIndex * SPACING) : line.leftX - BASE_OFFSET_LEFT - (line.trackIndex * SPACING);
        
        // We purposely do NOT clamp offsetX to the screen edges anymore.
        // If the screen is very small, the smart selection above uses the side with more space.
        // If it still goes slightly off-screen, it is better than squishing inward and overlapping the action buttons.

        let startX = isRight ? line.rightX : line.leftX;
        
        let path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        let d = `M ${startX} ${line.topY} L ${offsetX} ${line.topY} L ${offsetX} ${line.bottomY} L ${startX} ${line.bottomY}`;
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-linejoin', 'round');
        
        let g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        
        let text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.textContent = line.text;
        text.setAttribute('fill', '#fff');
        text.setAttribute('font-size', '11px');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        
        let midY = (line.topY + line.bottomY) / 2;
        let textOffsetX = offsetX;
        
        let rotation = isRight ? -90 : 90;
        
        g.setAttribute('transform', `translate(${textOffsetX}, ${midY}) rotate(${rotation})`);
        
        let rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('fill', color);
        rect.setAttribute('rx', '4');
        
        let textWidth = line.text.length * 6 + 10; 
        rect.setAttribute('width', textWidth);
        rect.setAttribute('height', '18');
        rect.setAttribute('x', -textWidth/2);
        rect.setAttribute('y', '-9');
        
        g.appendChild(rect);
        g.appendChild(text);
        
        svg.appendChild(path);
        svg.appendChild(g);
    }
}

let runValidateTimer = null;
function triggerValidation() {
    if (runValidateTimer) clearTimeout(runValidateTimer);
    runValidateTimer = setTimeout(validateRealTime, 100);
}

document.addEventListener('input', (e) => {
    if (e.target.tagName === 'INPUT') {
        triggerValidation();
    }
});

// Watch for DOM changes (add/remove/reorder items)
const observer = new MutationObserver((mutations) => {
    let shouldValidate = false;
    for (let m of mutations) {
        if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
            // Ignore SVG changes
            if (m.target.id !== 'conflict-lines-container' && m.target.tagName !== 'svg' && m.target.tagName !== 'g') {
                shouldValidate = true;
                break;
            }
        }
    }
    if (shouldValidate) {
        triggerValidation();
    }
});

window.addEventListener('DOMContentLoaded', () => {
    const listIds = ['teamsList', 'stagesList', 'usersList', 'editTeamsList', 'editStagesList'];
    listIds.forEach(id => {
        let el = document.getElementById(id);
        if (el) observer.observe(el, { childList: true, subtree: true });
    });
    
    window.addEventListener('resize', () => {
        if (window._conflicts && window._conflicts.size > 0) {
            renderConflictLines();
        }
    });
});
