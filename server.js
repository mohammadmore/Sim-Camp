import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));


import { getCamp, updateCamp, getSetting, setSetting, getAllCamps } from './db/index.js';

// Global Settings Endpoints
app.get('/api/settings', async (req, res) => {
    try {
        const adminPassVal = await getSetting('admin_password');
        const systemLogoVal = await getSetting('systemLogo');
        res.json({ admin_password: adminPassVal, systemLogo: systemLogoVal });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/settings', async (req, res) => {
    const { key, value } = req.body;
    try {
        
        await setSetting(key, value);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// NoSQL structure needs no PRAGMA check

const SUPERADMIN_PASS = process.env.SUPERADMIN_PASS || 'admin123';
const sseClients = new Map();
const campLocks = new Map(); // Mutex locks per camp // Map<campId, Set<Response>>

// Simple Mutex to prevent Race Conditions on simultaneous requests
async function withLock(id, fn) {
    if (!campLocks.has(id)) campLocks.set(id, Promise.resolve());
    const lock = campLocks.get(id);
    let release;
    const next = new Promise(resolve => release = resolve);
    campLocks.set(id, lock.then(() => next));
    try { return await lock.then(fn); }
    finally { release(); }
}
app.get('/', (req, res) => res.redirect('/superadmin.html'));

app.post('/superadmin/login', async (req, res) => {
    if (req.body.password === SUPERADMIN_PASS) res.json({ success: true });
    else res.json({ success: false, message: "رمز عبور سوپرادمین اشتباه است!" });
});

app.get('/superadmin/camps', async (req, res) => {
    try {
        const camps = await getAllCamps();
        res.json({ success: true, camps });
    } catch(err) { res.status(500).json({error: err.message}); }
});

const defaultPositiveTags = ['نظم', 'خلاقیت', 'کار تیمی', 'اخلاق ورزشی'];
const defaultNegativeTags = ['بی‌نظمی', 'تاخیر', 'نقض قوانین', 'رفتار نامناسب'];
const defaultFieldJudgingValues = [5, 10, 15, 20];

function sanitizeCampData(camp) {
    if (!camp) return null;
    return {
        ...camp,
        teams: typeof camp.teams === 'string' ? JSON.parse(camp.teams || '[]') : (camp.teams || []),
        stages: typeof camp.stages === 'string' ? JSON.parse(camp.stages || '[]') : (camp.stages || []),
        users: typeof camp.users === 'string' ? JSON.parse(camp.users || '[]') : (camp.users || []),
        fieldJudgingMode: camp.fieldJudgingMode || 'free',
        fieldJudgingValues: camp.fieldJudgingValues ? (typeof camp.fieldJudgingValues === 'string' ? JSON.parse(camp.fieldJudgingValues) : camp.fieldJudgingValues) : defaultFieldJudgingValues,
        positiveTags: camp.positiveTags ? (typeof camp.positiveTags === 'string' ? JSON.parse(camp.positiveTags) : camp.positiveTags) : defaultPositiveTags,
        negativeTags: camp.negativeTags ? (typeof camp.negativeTags === 'string' ? JSON.parse(camp.negativeTags) : camp.negativeTags) : defaultNegativeTags,
        locked: camp.locked === 1,
        campType: camp.campType || 'simple',
        tieredPointsLadder: camp.tieredPointsLadder ? (typeof camp.tieredPointsLadder === 'string' ? JSON.parse(camp.tieredPointsLadder) : camp.tieredPointsLadder) : [500, 400, 300, 200, 100],
        closedStages: camp.closedStages ? (typeof camp.closedStages === 'string' ? JSON.parse(camp.closedStages) : camp.closedStages) : {},
        stageTieredResults: camp.stageTieredResults ? (typeof camp.stageTieredResults === 'string' ? JSON.parse(camp.stageTieredResults) : camp.stageTieredResults) : {},
        numLang: camp.numLang || 'fa',
        dir: camp.dir || 'rtl'
    };
}

app.get('/superadmin/camps/:id', async (req, res) => {
    const camp = await getCamp(req.params.id);
    if (camp) {
        res.json({ 
            success: true, 
            camp: sanitizeCampData(camp)
        });
    } else {
        res.json({ success: false, message: "یافت نشد" });
    }
});

app.post('/superadmin/camps/:id/lock', async (req, res) => {
    const isLocked = req.body.locked ? 1 : 0;
    await updateCamp(req.params.id, { locked: isLocked });
    await broadcastState(req.params.id);
    res.json({ success: true });
});

app.post('/superadmin/camps/:id/archive', async (req, res) => {
    const isArchived = req.body.archived ? true : false;
    await updateCamp(req.params.id, { archived: isArchived });
    res.json({ success: true });
});

app.post('/setup', async (req, res) => {
    const { campId, orgName, title, logo, password, teams, stages, numLang, dir, users, campType,
            tieredPointsLadder, fieldJudgingMode, fieldJudgingValues, positiveTags, negativeTags } = req.body;
    let cleanLadder = [500, 400, 300, 200, 100];
    if (Array.isArray(tieredPointsLadder)) cleanLadder = tieredPointsLadder;
    else if (typeof tieredPointsLadder === 'string') cleanLadder = tieredPointsLadder.split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x));

    const payload = {
        orgName, title, logo, password, teams, stages,
        numLang: numLang || 'fa',
        dir: dir || 'rtl',
        users: users || [],
        campType: campType || 'simple',
        tieredPointsLadder: cleanLadder,
        fieldJudgingMode: fieldJudgingMode || 'free',
        fieldJudgingValues: fieldJudgingValues || defaultFieldJudgingValues,
        positiveTags: positiveTags || defaultPositiveTags,
        negativeTags: negativeTags || defaultNegativeTags
    };
    if (campId) {
        await updateCamp(campId, payload);
        await broadcastState(campId);
        res.json({ success: true, campId });
    } else {
        const newCampId = 'camp_' + Math.random().toString(36).substr(2, 9);
        await updateCamp(newCampId, { id: newCampId, ...payload, locked: 0, closedStages: {}, stageTieredResults: {} });
        res.json({ success: true, campId: newCampId });
    }
});

app.post('/login', async (req, res) => {
    const { id, password, username } = req.body;
    
    if (!username) {
        return res.json({ success: false, message: "نام کاربری الزامی است!" });
    }
    
    const camp = await getCamp(id);
    if (camp) {
        let loggedUser = null;
        const users = camp.users ? (typeof camp.users === 'string' ? JSON.parse(camp.users) : camp.users) : [];
        loggedUser = users.find(u => u.username === username && u.password === password);
        
        // Fallback for default operator (if not explicitly in the users list)
        if (!loggedUser && username === 'admin' && camp.password === password) {
            loggedUser = { role: 'operator', firstName: 'اپراتور', lastName: 'اصلی', username: 'admin' };
        }
        
        if (loggedUser) {
            const clean = sanitizeCampData(camp);
            return res.json({ 
                success: true, 
                teams: clean.teams, 
                stages: clean.stages,
                orgName: clean.orgName, 
                title: clean.title, 
                logo: clean.logo, 
                locked: clean.locked, 
                numLang: clean.numLang, 
                dir: clean.dir,
                campType: clean.campType,
                tieredPointsLadder: clean.tieredPointsLadder,
                closedStages: clean.closedStages,
                stageTieredResults: clean.stageTieredResults,
                fieldJudgingMode: clean.fieldJudgingMode,
                fieldJudgingValues: clean.fieldJudgingValues,
                positiveTags: clean.positiveTags,
                negativeTags: clean.negativeTags,
                user: loggedUser
            });
        }
    }
    res.json({ success: false, message: "نام کاربری یا رمز عبور اشتباه است یا مسابقه یافت نشد!" });
});

app.post('/api/user/profile-pic', async (req, res) => {
    const { campId, username, profilePic } = req.body;
    if (!campId || !username) {
        return res.status(400).json({ success: false, message: "شناسه مسابقه و نام کاربری الزامی است." });
    }
    await withLock(campId, async () => {
        const camp = await getCamp(campId);
        if (camp) {
            let users = camp.users ? (typeof camp.users === 'string' ? JSON.parse(camp.users) : camp.users) : [];
            const user = users.find(u => u.username === username);
            if (user) {
                user.profilePic = profilePic || '';
                await updateCamp(campId, { users });
                return res.json({ success: true, profilePic: user.profilePic });
            }
        }
        res.status(404).json({ success: false, message: "کاربر یا مسابقه یافت نشد." });
    });
});


setInterval(() => {
    for (const [id, clients] of sseClients.entries()) {
        for (const client of clients) {
            try { client.write(':\n\n'); } catch (e) { clients.delete(client); }
        }
    }
}, 15000);

async function broadcastState(id) {
    const clients = sseClients.get(id);
    if (clients && clients.size > 0) {
        const camp = await getCamp(id);
        if (camp) {
            const clean = sanitizeCampData(camp);
            const dataStr = `data: ${JSON.stringify(clean)}\n\n`;
            for (const client of clients) { try { client.write(dataStr); } catch(e) { clients.delete(client); } }
        }
    }
}

app.get('/api', async (req, res) => {
    const { id, action } = req.query;
    if (action === 'info') {
        if (!id) return res.json({success: false});
        const camp = await getCamp(id);
        if (camp) return res.json({success: true, ...sanitizeCampData(camp)});
        return res.json({success: false});
    } else if (action === 'poll') {
        const camp = await getCamp(id);
        if (camp) {
            res.json(sanitizeCampData(camp));
        } else {
            res.status(404).json({error: 'not found'});
        }
    } else if (action === 'stream') {
        if (!id) return res.status(400).send("شناسه مسابقه وارد نشده است.");
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Connection', 'keep-alive');
        
        res.flushHeaders();
        if (!sseClients.has(id)) sseClients.set(id, new Set());
        const clients = sseClients.get(id);
        clients.add(res);
        
        const camp = await getCamp(id);
        if (camp) {
            res.write(`data: ${JSON.stringify(sanitizeCampData(camp))}\n\n`);
        }
        req.on('close', () => clients.delete(res));
    } else res.status(400).send("Invalid action");
});

app.post('/api', async (req, res) => {
    const { id } = req.query;
    const { teams, stages, orgName, title, logo, numLang, dir, fieldJudgingMode, fieldJudgingValues, positiveTags, negativeTags } = req.body;
    if (!id) return res.status(400).json({ error: "شناسه مسابقه وارد نشده است." });
    
    let isLockedError = false;
    let isNotFound = false;
    try {
        await withLock(id, async () => {
            const camp = await getCamp(id);
            if (!camp) {
                isNotFound = true;
                return;
            }
            if (camp.locked === 1) {
                isLockedError = true;
                return;
            }
            
            const updatePayload = { 
                teams: teams || (typeof camp.teams === 'string' ? JSON.parse(camp.teams) : camp.teams), 
                stages: stages || (camp.stages ? (typeof camp.stages === 'string' ? JSON.parse(camp.stages) : camp.stages) : []), 
                orgName: orgName || camp.orgName, 
                title: title !== undefined ? title : camp.title, 
                logo: logo !== undefined ? logo : camp.logo, 
                numLang: numLang || camp.numLang || 'fa', 
                dir: dir || camp.dir || 'rtl' 
            };
            if (fieldJudgingMode !== undefined) updatePayload.fieldJudgingMode = fieldJudgingMode;
            if (fieldJudgingValues !== undefined) updatePayload.fieldJudgingValues = fieldJudgingValues;
            if (positiveTags !== undefined) updatePayload.positiveTags = positiveTags;
            if (negativeTags !== undefined) updatePayload.negativeTags = negativeTags;
            if (req.body.campType !== undefined) updatePayload.campType = req.body.campType;
            if (req.body.tieredPointsLadder !== undefined) {
                let l = req.body.tieredPointsLadder;
                if (typeof l === 'string') l = l.split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x));
                updatePayload.tieredPointsLadder = l;
            }
            if (req.body.closedStages !== undefined) updatePayload.closedStages = req.body.closedStages;
            if (req.body.stageTieredResults !== undefined) updatePayload.stageTieredResults = req.body.stageTieredResults;

            await updateCamp(id, updatePayload);
            await broadcastState(id);
        }); // end withLock

        if (isNotFound) return res.status(404).json({ status: "error", message: "مسابقه یافت نشد." });
        if (isLockedError) return res.status(403).json({ status: "error", message: "این مسابقه قفل شده است." });
        res.json({ status: "success" });
    } catch(err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

app.post('/api/instant', async (req, res) => {
    const { id } = req.query;
    const { teamId, delta, teamName, user, tag } = req.body;
    
    let createdLogId = 'log_' + Math.random().toString(36).substr(2, 9);
    let success = false;
    let locked = false;
    await withLock(id, async () => {
        const camp = await getCamp(id);
        if (!camp) return;
        if (camp.locked === 1) {
            locked = true;
            return;
        }
        let teams = typeof camp.teams === 'string' ? JSON.parse(camp.teams) : camp.teams;
        let targetTeam = teams.find(t => t.id === teamId);
        if (targetTeam) {
            if (!targetTeam.scoreLogs) targetTeam.scoreLogs = [];
            targetTeam.scoreLogs.push({
                id: createdLogId,
                type: 'instant',
                value: delta,
                timestamp: Date.now(),
                user: user,
                tag: tag || ''
            });
            
            let stageSum = 0;
            if (targetTeam.stageScores) {
                for (let s in targetTeam.stageScores) stageSum += (parseInt(targetTeam.stageScores[s]) || 0);
            }
            let logsSum = targetTeam.scoreLogs.reduce((sum, l) => sum + (l.type !== 'cancelled' ? (parseInt(l.value)||0) : 0), 0);
            targetTeam.score = stageSum + logsSum;
            
            await updateCamp(id, { teams });
            
            // Broadcast Splash Event
            const clients = sseClients.get(id);
            if (clients) {
                const splashPayload = `event: splash\ndata: ${JSON.stringify({
                    teamId, 
                    delta, 
                    teamName, 
                    score: targetTeam.score, 
                    user, 
                    tag: tag || '', 
                    logId: createdLogId,
                    image: targetTeam.image || '',
                    happyImage: targetTeam.happyImage || '',
                    sadImage: targetTeam.sadImage || '',
                    teamColor: targetTeam.color || '#3b82f6'
                })}\n\n`;
                for (const client of clients) { try { client.write(splashPayload); } catch(e) { clients.delete(client); } }
            }
            await broadcastState(id);
            success = true;
        }
    }); // end withLock
    if (locked) return res.status(403).json({ error: "این مسابقه قفل است." });
    if (!success) return res.status(400).json({ error: "مسابقه یا تیم یافت نشد." });
    res.json({ success: true, logId: createdLogId });
});


app.post('/api/undo_instant', async (req, res) => {
    const { id } = req.query;
    const { logId } = req.body;
    
    let success = false;
    await withLock(id, async () => {
        const camp = await getCamp(id);
    if (camp && camp.locked !== 1) {
        let teams = JSON.parse(camp.teams);
        let found = false;
        
        teams.forEach(t => {
            if (t.scoreLogs) {
                t.scoreLogs.forEach(l => {
                    if (l.id === logId && l.type === 'instant') {
                        l.type = 'cancelled';
                        l.timestamp = Date.now();
                        found = true;
                    }
                });
            }
            if (found) {
                let stageSum = 0;
                if (t.stageScores) {
                    for (let s in t.stageScores) stageSum += (parseInt(t.stageScores[s]) || 0);
                }
                let logsSum = t.scoreLogs.reduce((sum, l) => sum + (l.type !== 'cancelled' ? (parseInt(l.value)||0) : 0), 0);
                t.score = stageSum + logsSum;
                found = false; // reset for next? No, just keep going
            }
        });
        
        await updateCamp(id, { teams });
        await broadcastState(id); 
            success = true;
        }
    }); // end withLock
    if (success) res.json({success: true});
    else res.status(403).json({error: 'locked'});
});

app.post('/api/judge_stage_score', async (req, res) => {
    const { id } = req.query;
    const { stageId, scores, singleScore, user, action, targetJudgeKey } = req.body;
    if (!id || !stageId) return res.status(400).json({ error: "شناسه مسابقه یا مرحله نامعتبر است." });

    let updatedTeams = null;
    await withLock(id, async () => {
        const camp = await getCamp(id);
        if (camp && camp.locked !== 1) {
            let teams = typeof camp.teams === 'string' ? JSON.parse(camp.teams) : camp.teams;
            const isTiered = camp.campType === 'tiered';
            
            const judgeKey = (targetJudgeKey || (user ? (user.username || user.id || 'judge') : 'unknown_judge')).trim();
            const judgeName = user ? (user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user.username) : 'داور';
            const judgeRole = user ? (user.role || 'referee') : 'referee';
            const judgePhoto = user ? (user.profilePic || user.photo || user.avatar || user.image || '') : '';

            const scoreMap = scores || (singleScore ? { [singleScore.teamId]: singleScore.score } : {});
            const dnfMap = singleScore && singleScore.dnf ? { [singleScore.teamId]: true } : {};

            teams.forEach(team => {
                if (!team.judgeStageScores || typeof team.judgeStageScores !== 'object' || Array.isArray(team.judgeStageScores)) {
                    team.judgeStageScores = {};
                }
                if (!team.judgeStageScores[stageId] || typeof team.judgeStageScores[stageId] !== 'object' || Array.isArray(team.judgeStageScores[stageId])) {
                    team.judgeStageScores[stageId] = {};
                }

                if (action === 'delete') {
                    if (targetJudgeKey && team.judgeStageScores[stageId][targetJudgeKey]) {
                        delete team.judgeStageScores[stageId][targetJudgeKey];
                    }
                } else if (scoreMap[team.id] !== undefined) {
                    const rawVal = scoreMap[team.id];
                    const isDnf = rawVal === '-' || rawVal === 'dnf' || rawVal === 'DNF' || !!dnfMap[team.id];
                    const scoreVal = isDnf ? '-' : (parseFloat(rawVal) || 0);

                    team.judgeStageScores[stageId][judgeKey] = {
                        judgeKey,
                        judgeName,
                        judgeRole,
                        judgePhoto,
                        score: scoreVal,
                        dnf: isDnf,
                        timestamp: Date.now()
                    };
                }

                // If NOT tiered (simple or professional mode), recalculate stage score directly
                if (!isTiered) {
                    let stageSumFromJudges = 0;
                    let hasJudges = false;
                    for (const jk in team.judgeStageScores[stageId]) {
                        const entry = team.judgeStageScores[stageId][jk];
                        const sVal = typeof entry === 'object' ? (parseFloat(entry.score) || 0) : (parseFloat(entry) || 0);
                        stageSumFromJudges += sVal;
                        hasJudges = true;
                    }

                    if (!team.stageScores || typeof team.stageScores !== 'object' || Array.isArray(team.stageScores)) {
                        team.stageScores = {};
                    }
                    if (hasJudges) {
                        team.stageScores[stageId] = stageSumFromJudges;
                    } else if (action === 'delete') {
                        delete team.stageScores[stageId];
                    }

                    // Recalculate team total score
                    let totalStageSum = 0;
                    for (let s in team.stageScores) {
                        totalStageSum += (parseInt(team.stageScores[s]) || 0);
                    }
                    let logsSum = (team.scoreLogs || []).reduce((sum, l) => sum + (l.type !== 'cancelled' ? (parseInt(l.value)||0) : 0), 0);
                    team.score = totalStageSum + logsSum;
                }
                // If tiered mode: referee entries are recorded into team.judgeStageScores,
                // but team.stageScores and team.score remain untouched until operator closes the stage.
            });

            await updateCamp(id, { teams });
            await broadcastState(id);
            updatedTeams = teams;
        }
    });

    res.json({ success: true, teams: updatedTeams });
});

// Endpoint for closing stage and calculating tiered points (قواعد امتیازات پلکانی)
app.post('/api/stage/close_tiered', async (req, res) => {
    const { id, stageId, reopen, customLadder, customMultiplier } = req.body;
    if (!id || !stageId) return res.status(400).json({ error: "شناسه مسابقه یا مرحله الزامی است." });

    let resultPayload = null;
    await withLock(id, async () => {
        const camp = await getCamp(id);
        if (!camp) return res.status(404).json({ error: "مسابقه یافت نشد." });
        if (camp.locked === 1) return res.status(403).json({ error: "مسابقه قفل است." });

        let teams = typeof camp.teams === 'string' ? JSON.parse(camp.teams) : camp.teams;
        let stages = typeof camp.stages === 'string' ? JSON.parse(camp.stages) : camp.stages;
        let closedStages = camp.closedStages ? (typeof camp.closedStages === 'string' ? JSON.parse(camp.closedStages) : camp.closedStages) : {};
        let stageTieredResults = camp.stageTieredResults ? (typeof camp.stageTieredResults === 'string' ? JSON.parse(camp.stageTieredResults) : camp.stageTieredResults) : {};

        const stage = stages.find(s => s.id === stageId);
        if (!stage) return res.status(404).json({ error: "مرحله یافت نشد." });

        if (reopen) {
            // Reopen stage: remove closed mark and clear stageScores for this stage
            delete closedStages[stageId];
            delete stageTieredResults[stageId];
            teams.forEach(t => {
                if (t.stageScores && t.stageScores[stageId] !== undefined) {
                    delete t.stageScores[stageId];
                }
                let totalStageSum = 0;
                for (let s in t.stageScores) totalStageSum += (parseInt(t.stageScores[s]) || 0);
                let logsSum = (t.scoreLogs || []).reduce((sum, l) => sum + (l.type !== 'cancelled' ? (parseInt(l.value)||0) : 0), 0);
                t.score = totalStageSum + logsSum;
            });
            await updateCamp(id, { teams, closedStages, stageTieredResults });
            await broadcastState(id);
            resultPayload = { success: true, reopened: true, teams, closedStages };
            return;
        }

        // Tiered points ladder (چینش پلکانی مشخص شده)
        let ladder = customLadder || camp.tieredPointsLadder || [500, 400, 300, 200, 100];
        if (typeof ladder === 'string') {
            ladder = ladder.split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x));
        }

        const unit = stage.unit || 'points';
        const timeOrder = stage.timeOrder || (unit === 'time_desc' ? 'desc' : 'asc');
        const isTime = (unit === 'time' || unit === 'time_asc' || unit === 'time_desc');

        // Evaluate each team according to rules:
        // قانون ۱: اگر مبنا زمان است فقط داور ثبت‌کننده زمان ملاک است (نیازی نیست همه داوران ثبت کرده باشند)
        // قانون ۳: اگر دکمه - فشرده شده (تیم مرحله را به پایان نرسانده)، امتیاز آن تیم ۰ در نظر گرفته می‌شود
        const teamData = teams.map(t => {
            const jMap = (t.judgeStageScores && t.judgeStageScores[stageId]) ? t.judgeStageScores[stageId] : {};
            const entries = Object.values(jMap);

            let isDnf = false;
            let hasRecord = false;
            let rawValue = 0;

            if (entries.length > 0) {
                // Check if any judge marked DNF / '-'
                for (const e of entries) {
                    if (e.dnf || e.score === '-' || e.score === 'dnf' || e.score === 'DNF') {
                        isDnf = true;
                        break;
                    }
                }

                if (!isDnf) {
                    if (isTime) {
                        // قانون ۱: اولین داوری که زمان معتبر ثبت کرده
                        const validTimes = entries.map(e => parseFloat(e.score)).filter(v => !isNaN(v));
                        if (validTimes.length > 0) {
                            hasRecord = true;
                            rawValue = validTimes[0];
                        } else {
                            isDnf = true;
                        }
                    } else {
                        // Points: sum of all judges
                        let sum = 0;
                        let anyNum = false;
                        for (const e of entries) {
                            const val = parseFloat(e.score);
                            if (!isNaN(val)) { sum += val; anyNum = true; }
                        }
                        if (anyNum) {
                            hasRecord = true;
                            rawValue = sum;
                        }
                    }
                }
            } else {
                // No judge recorded anything
                if (isTime) {
                    isDnf = true;
                }
            }

            return {
                teamId: t.id,
                teamName: t.name,
                teamColor: t.color,
                isDnf,
                hasRecord,
                rawValue,
                rank: null,
                assignedScore: 0
            };
        });

        const completedTeams = teamData.filter(td => !td.isDnf && td.hasRecord);
        const dnfTeams = teamData.filter(td => td.isDnf || !td.hasRecord);

        // Sort completed teams
        if (isTime && timeOrder === 'asc') {
            // Speed: lower time is better
            completedTeams.sort((a, b) => a.rawValue - b.rawValue);
        } else {
            // Points or Endurance: higher value is better
            completedTeams.sort((a, b) => b.rawValue - a.rawValue);
        }

        if (customMultiplier !== undefined && !isNaN(parseFloat(customMultiplier)) && parseFloat(customMultiplier) > 0) {
            stage.multiplier = parseFloat(customMultiplier);
        }
        const stageMultiplier = (stage.multiplier !== undefined && !isNaN(parseFloat(stage.multiplier)) && parseFloat(stage.multiplier) > 0) ? parseFloat(stage.multiplier) : 1;

        // قانون ۲:
        // اگر دو تیم امتیاز مساوی یا زمان مساوی داشتند، هر دو در یک جایگاه قرار می‌گیرند و امتیاز مساوی آن جایگاه را می‌گیرند.
        // مثلا اگر دو تیم با هم اول شوند، هر دو امتیاز اول را می‌گیرند و تیم بعدی تیم دوم اعلام می‌شود. (Dense Ranking)
        let denseRank = 1;
        for (let i = 0; i < completedTeams.length; i++) {
            if (i > 0 && completedTeams[i].rawValue === completedTeams[i - 1].rawValue) {
                completedTeams[i].rank = completedTeams[i - 1].rank;
            } else {
                if (i > 0) denseRank++;
                completedTeams[i].rank = denseRank;
            }
            const rankIndex = completedTeams[i].rank - 1;
            const baseTieredScore = (rankIndex >= 0 && rankIndex < ladder.length) ? (parseInt(ladder[rankIndex]) || 0) : 0;
            completedTeams[i].baseScore = baseTieredScore;
            completedTeams[i].multiplier = stageMultiplier;
            completedTeams[i].assignedScore = Math.round(baseTieredScore * stageMultiplier);
        }

        // قانون ۳:
        // تیم‌هایی که مرحله را به پایان نرسانده‌اند، بدون توجه به قواعد پلکانی امتیازشان ۰ است
        dnfTeams.forEach(td => {
            td.rank = '-';
            td.baseScore = 0;
            td.multiplier = stageMultiplier;
            td.assignedScore = 0;
        });

        const allResults = [...completedTeams, ...dnfTeams];
        const assignedScoreMap = {};
        allResults.forEach(r => {
            assignedScoreMap[r.teamId] = r.assignedScore;
        });

        // Update team.stageScores and total score
        teams.forEach(t => {
            if (!t.stageScores || typeof t.stageScores !== 'object' || Array.isArray(t.stageScores)) {
                t.stageScores = {};
            }
            t.stageScores[stageId] = assignedScoreMap[t.id] !== undefined ? assignedScoreMap[t.id] : 0;

            let totalStageSum = 0;
            for (let s in t.stageScores) totalStageSum += (parseInt(t.stageScores[s]) || 0);
            let logsSum = (t.scoreLogs || []).reduce((sum, l) => sum + (l.type !== 'cancelled' ? (parseInt(l.value)||0) : 0), 0);
            t.score = totalStageSum + logsSum;
        });

        closedStages[stageId] = true;
        stageTieredResults[stageId] = {
            closedAt: Date.now(),
            ladder,
            multiplier: stageMultiplier,
            results: allResults
        };

        await updateCamp(id, { teams, closedStages, stageTieredResults, stages });
        await broadcastState(id);

        resultPayload = {
            success: true,
            closed: true,
            stageId,
            ladder,
            multiplier: stageMultiplier,
            results: allResults,
            teams,
            stages,
            closedStages
        };
    });

    res.json(resultPayload || { success: false });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
