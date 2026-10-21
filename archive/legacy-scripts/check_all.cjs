const fs = require('fs');
for (const file of ['public/board.html', 'public/operator.html']) {
    const html = fs.readFileSync(file, 'utf8');
    const scriptRegex = /<script>([\s\S]*?)<\/script>/g;
    let match;
    let i = 1;
    while ((match = scriptRegex.exec(html)) !== null) {
        fs.writeFileSync(`temp_${file.replace('/', '_')}_${i}.js`, match[1]);
        try {
            new Function(match[1]);
        } catch(e) {
            console.error(`Syntax Error in ${file} script ${i}:`, e.message);
        }
        i++;
    }
}
