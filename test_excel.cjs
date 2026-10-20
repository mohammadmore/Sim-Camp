const fs = require('fs');

async function doTest() {
    try {
        const fetch = (await import('node-fetch')).default || global.fetch;
        const res = await fetch('http://localhost:3000/setup', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                campId: null,
                orgName: "Test",
                title: "Test",
                campType: "simple",
                teams: [{id: 't1', name: 'team 1', color: '#000'}],
                stages: [{id: 's1', name: 'stage 1'}],
                users: [{username: 'admin', password: '123', role: 'operator'}],
            })
        });
        const text = await res.text();
        console.log("Status:", res.status);
        console.log("Response:", text);
    } catch (e) {
        console.error(e);
    }
}
doTest();
