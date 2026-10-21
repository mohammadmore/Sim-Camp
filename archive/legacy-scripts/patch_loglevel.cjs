const fs = require('fs');
let code = fs.readFileSync('db/firebaseAdapter.js', 'utf8');

if (!code.includes('setLogLevel')) {
    code = code.replace(
        /import \{ getFirestore, doc, setDoc, getDoc, collection, getDocs \} from 'firebase\/firestore';/,
        "import { getFirestore, doc, setDoc, getDoc, collection, getDocs, setLogLevel } from 'firebase/firestore';\nsetLogLevel('silent');"
    );
    fs.writeFileSync('db/firebaseAdapter.js', code);
    console.log('Patched log level!');
} else {
    console.log('Already patched!');
}
