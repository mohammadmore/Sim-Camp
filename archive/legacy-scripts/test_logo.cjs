const admin = require('firebase-admin');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: config.projectId,
    clientEmail: config.clientEmail,
    privateKey: config.privateKey,
  })
});

const db = admin.firestore();

async function run() {
  const camps = await db.collection('camps').get();
  camps.forEach(doc => {
    console.log(doc.id, doc.data().logo);
  });
}
run();
