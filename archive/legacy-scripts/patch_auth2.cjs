const fs = require('fs');

let html = fs.readFileSync('public/operator.html', 'utf8');

const regexFixLogin = /function login\(\) \{[\s\S]*?fetch\('\/login', \{\s*method: 'POST',\s*headers: \{ 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(\{ id: campId, password: password, username: username \}\)\s*\}\)[\s\S]*?method: 'POST',[\s\S]*?headers: \{ 'Content-Type': 'application\/json' \},[\s\S]*?body: JSON\.stringify\(\{ id: campId, password: password, username: username \}\)[\s\S]*?\}\)/g;

const correctLogin = `function login() {
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
            })`;

html = html.replace(regexFixLogin, correctLogin);
fs.writeFileSync('public/operator.html', html);
console.log("Fixed duplication");
