const fs = require('fs');

let adapter = fs.readFileSync('db/firebaseAdapter.js', 'utf8');

// The `firebase-admin` SDK requires explicitly ignoring undefined properties
adapter = adapter.replace(
    /const db = getFirestore\(app, config\.firestoreDatabaseId \|\| '\(default\)'\);/,
    `const db = getFirestore(app, config.firestoreDatabaseId || '(default)');
db.settings({ ignoreUndefinedProperties: true });`
);

fs.writeFileSync('db/firebaseAdapter.js', adapter);
console.log("Patched firebaseAdapter.js");
