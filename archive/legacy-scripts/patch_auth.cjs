const fs = require('fs');

// Patch operator.html
let html = fs.readFileSync('public/operator.html', 'utf8');
html = html.replace(
    /<input type="text" id="opUsername" placeholder="نام کاربری \(خالی برای اپراتور قدیمی\)"/g,
    '<input type="text" id="opUsername" placeholder="نام کاربری (مثال: admin)"'
);

const loginNew = `
        function login() {
            const username = document.getElementById('opUsername').value.trim();
            const password = document.getElementById('opPassword').value.trim();
            
            if (!username) {
                const err = document.getElementById('errorMsg');
                err.innerText = "لطفا نام کاربری را وارد کنید (اپراتور اصلی: admin)";
                err.style.display = 'block';
                return;
            }
            
            fetch('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: campId, password: password, username: username })
            })
`;
html = html.replace(
    /function login\(\) \{\s*const username = document\.getElementById\('opUsername'\)\.value;\s*const password = document\.getElementById\('opPassword'\)\.value;\s*fetch\('\/login', \{/g,
    loginNew.trim()
);
fs.writeFileSync('public/operator.html', html);


// Patch superadmin.html
let sh = fs.readFileSync('public/superadmin.html', 'utf8');
sh = sh.replace(/رمز عبور اپراتور \(پیش‌فرض قدیمی\):/g, 'رمز عبور اپراتور اصلی (نام کاربری ورود: admin):');
fs.writeFileSync('public/superadmin.html', sh);


// Patch server.js
let server = fs.readFileSync('server.js', 'utf8');
const oldLogin = `app.post('/login', (req, res) => {
    const { id, password, username } = req.body;
    const camp = db.prepare('SELECT * FROM camps WHERE id = ?').get(id);
    if (camp) {
        let loggedUser = null;
        if (username) {
            const users = camp.users ? JSON.parse(camp.users) : [];
            loggedUser = users.find(u => u.username === username && u.password === password);
        } else {
            if (camp.password === password) {
                loggedUser = { role: 'operator', firstName: 'اپراتور', lastName: 'اصلی', username: 'admin' };
            }
        }
        
        if (loggedUser) {`;

const newLogin = `app.post('/login', (req, res) => {
    const { id, password, username } = req.body;
    
    if (!username) {
        return res.json({ success: false, message: "نام کاربری الزامی است!" });
    }
    
    const camp = db.prepare('SELECT * FROM camps WHERE id = ?').get(id);
    if (camp) {
        let loggedUser = null;
        const users = camp.users ? JSON.parse(camp.users) : [];
        loggedUser = users.find(u => u.username === username && u.password === password);
        
        // Fallback for default operator (if not explicitly in the users list)
        if (!loggedUser && username === 'admin' && camp.password === password) {
            loggedUser = { role: 'operator', firstName: 'اپراتور', lastName: 'اصلی', username: 'admin' };
        }
        
        if (loggedUser) {`;

if (server.includes(oldLogin)) {
    server = server.replace(oldLogin, newLogin);
} else {
    // try regex replace for login route
    server = server.replace(/app\.post\('\/login'[\s\S]*?if\s*\(loggedUser\)\s*\{/g, newLogin);
}
fs.writeFileSync('server.js', server);

console.log('patched auth');
