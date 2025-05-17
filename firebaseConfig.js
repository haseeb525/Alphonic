// firebaseConfig.js
const admin = require("firebase-admin");
const serviceAccount = require("./firebaseServiceKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://voicebotai-39243.firebaseio.com" // 🔁 update with your actual databaseURL
});

const db = admin.firestore();
module.exports = db;