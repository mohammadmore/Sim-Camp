const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');

const html = fs.readFileSync('public/superadmin.html', 'utf8');

// The HTML has scripts directly in it.
// We can extract them and run them manually in context.
const dom = new JSDOM(html, { 
  runScripts: "dangerously",
  url: "http://localhost:3000/superadmin.html"
});

const window = dom.window;
const document = window.document;

// Mock fetch
window.fetch = async (url, options) => {
    console.log('FETCH CALLED:', url, options);
    return {
        json: async () => ({ success: true, campId: 'test_123' })
    };
};

window.alert = (msg) => { console.log('ALERT:', msg); };

// Mock COLORS since it's used in addTeam
window.COLORS = ['#ff0000', '#00ff00'];

// Initialize the UI
try {
    // Open setup mode for new camp
    window.openSetupMode(null);
    
    // Fill form
    document.getElementById('orgName').value = 'Test Org';
    document.getElementById('campTitle').value = 'Test Title';
    document.getElementById('opPassword').value = 'pass123';
    document.getElementById('campType').value = 'professional';
    
    // Add dummy teams
    window.addTeam('Team A', '#ff0000');
    window.addTeam('Team B', '#00ff00');
    
    // Add dummy stage
    window.addStage('Stage 1');
    
    // Click save
    console.log('Clicking createCamp...');
    window.createCamp();
    console.log('createCamp finished');
} catch (e) {
    console.error('ERROR during test:', e);
}
