const fs = require('fs');

let srv = fs.readFileSync('server.js', 'utf8');

const migrations = `
try {
    db.exec("ALTER TABLE camps ADD COLUMN numLang TEXT DEFAULT 'fa'");
    db.exec("ALTER TABLE camps ADD COLUMN dir TEXT DEFAULT 'rtl'");
    db.exec("ALTER TABLE camps ADD COLUMN users TEXT DEFAULT '[]'");
    db.exec("ALTER TABLE camps ADD COLUMN campType TEXT DEFAULT 'simple'");
} catch (e) {
    // Columns might already exist
}
`;

srv = srv.replace(
    /try \{\n    db.exec\("ALTER TABLE camps ADD COLUMN numLang TEXT DEFAULT 'fa'"\);\n    db.exec\("ALTER TABLE camps ADD COLUMN dir TEXT DEFAULT 'rtl'"\);\n    db.exec\("ALTER TABLE camps ADD COLUMN users TEXT DEFAULT '\[\]'"\);\n\} catch \(e\) \{\}/,
    migrations
);

// If the pattern above isn't exactly matched, let's just insert it manually.
if (!srv.includes('ALTER TABLE camps ADD COLUMN campType TEXT')) {
    srv = srv.replace(
        /db\.exec\("ALTER TABLE camps ADD COLUMN users TEXT DEFAULT '\[\]'"\);/,
        "db.exec(\"ALTER TABLE camps ADD COLUMN users TEXT DEFAULT '[]'\");\n    db.exec(\"ALTER TABLE camps ADD COLUMN campType TEXT DEFAULT 'simple'\");"
    );
}

fs.writeFileSync('server.js', srv);
console.log('db migration added');
