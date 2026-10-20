const fs = require('fs');
const files = ['public/board.html', 'public/operator.html', 'public/superadmin.html'];

// Emoji regex
const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F251}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2B50}\u{2B55}]/gu;

for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const matches = content.match(emojiRegex);
    if (matches) {
        console.log(`File: ${file}`);
        console.log([...new Set(matches)]);
    }
}
