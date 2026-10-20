const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');

const html = fs.readFileSync('public/operator.html', 'utf8');

const dom = new JSDOM(html, { 
  runScripts: "dangerously",
  url: "http://localhost:3000/operator.html?id=camp_123",
  resources: "usable"
});

const window = dom.window;
const document = window.document;

setTimeout(() => {
    window.fetch = async (url, options) => {
        console.log('FETCH CALLED:', url, options);
        if (url.includes('/api?id=')) {
            return {
                json: async () => ({ status: 'success' })
            };
        }
        if (url === '/api/state?id=camp_123') {
            return {
                json: async () => ({
                    camp: {
                        id: 'camp_123',
                        orgName: 'Org',
                        title: 'Title',
                        logo: '',
                        teams: [{id: 't1', name: 'T1', color: 'red', score: 0, scoreLogs: [], stageScores: {}}],
                        stages: [{id: 's1', name: 'S1'}],
                        numLang: 'fa',
                        dir: 'rtl',
                        locked: false
                    }
                })
            }
        }
    };

    window.alert = (msg) => { console.log('ALERT:', msg); };

    try {
        console.log('Starting operator test...');
        // simulate a user clicking saveSettings
        // Note: JS in operator.html initializes automatically on load
        
        setTimeout(() => {
            console.log('Opening settings modal...');
            window.openSettings();
            
            setTimeout(() => {
                document.getElementById('editOrgName').value = 'New Org Name';
                console.log('Clicking saveSettings...');
                window.saveSettings();
                console.log('saveSettings finished');
            }, 100);
        }, 500);
    } catch (e) {
        console.error('ERROR during test:', e);
    }
}, 500);

