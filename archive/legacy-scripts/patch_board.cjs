const fs = require('fs');
let bd = fs.readFileSync('public/board.html', 'utf8');

if(bd.includes('<button id="fullscreenBtn"')) {
    if (!bd.includes('title="تمام‌صفحه"')) {
        bd = bd.replace(/<button id="fullscreenBtn"[^>]*>/, '<button id="fullscreenBtn" class="theme-toggle" style="left: 85px;" title="تمام‌صفحه" onclick="toggleFullscreen()">');
        fs.writeFileSync('public/board.html', bd);
    }
} else {
    // maybe there's no fullscreen button, let's see if there is any button
    bd = bd.replace(/<button onclick="toggleFullscreen\(\)"([^>]*)>/g, '<button onclick="toggleFullscreen()" title="بزرگنمایی/خروج از تمام‌صفحه" $1>');
    fs.writeFileSync('public/board.html', bd);
}
console.log('patched board');
