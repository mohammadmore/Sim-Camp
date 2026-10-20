const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');

const html = fs.readFileSync('public/superadmin.html', 'utf8');

const dom = new JSDOM(html, { 
  runScripts: "dangerously",
  url: "http://localhost:3000/superadmin.html",
  resources: "usable"
});

const window = dom.window;
const document = window.document;

setTimeout(() => {
    window.fetch = async (url, options) => {
        console.log('FETCH CALLED:', url, options);
        return {
            json: async () => ({ success: true, campId: 'test_123' })
        };
    };

    window.alert = (msg) => { console.log('ALERT:', msg); };

    try {
        window.openSetupMode(null);
        document.getElementById('orgName').value = 'Test Org';
        document.getElementById('campTitle').value = 'Test Title';
        document.getElementById('opPassword').value = 'pass123';
        document.getElementById('campType').value = 'professional';
        
        window.addTeam('Team A', '#ff0000');
        window.addTeam('Team B', '#00ff00');
        window.addStage('Stage 1');
        
        console.log('Clicking createCamp...');
        window.createCamp();
        console.log('createCamp finished');
    } catch (e) {
        console.error('ERROR during test:', e);
    }
}, 500);

