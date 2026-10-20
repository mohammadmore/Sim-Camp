const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');

const html = fs.readFileSync('public/superadmin.html', 'utf8');
const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost:3000/superadmin.html", resources: "usable" });
const window = dom.window;
const document = window.document;

setTimeout(() => {
    window.fetch = async (url, options) => {
        console.log('FETCH CALLED:', url, options);
        if (url === '/superadmin/camps/camp_123') {
            return {
                json: async () => ({
                    success: true,
                    camp: {
                        id: 'camp_123', orgName: 'Existing Org', title: 'Existing Title', campType: 'simple', password: 'ex_password', logo: '',
                        teams: [{id: 't1', name: 'Team Ex', color: '#ff0000', score: 0, stageScores: {}, scoreLogs: []}],
                        stages: [{id: 's1', name: 'Stage Ex'}], users: []
                    }
                })
            }
        }
        return { json: async () => ({ success: true, campId: 'test_123' }) };
    };

    window.alert = (msg) => { console.log('ALERT:', msg); };

    try {
        console.log('Opening setup for camp_123');
        window.openSetupMode('camp_123');
        
        setTimeout(() => {
            console.log('campType before:', document.getElementById('campType').value);
            // Change it to professional
            document.getElementById('campType').value = 'professional';
            // trigger onchange
            const event = new window.Event('change');
            document.getElementById('campType').dispatchEvent(event);
            
            console.log('Clicking createCamp...');
            window.createCamp();
            console.log('createCamp finished');
        }, 100);
    } catch (e) {
        console.error('ERROR during test:', e);
    }
}, 500);
