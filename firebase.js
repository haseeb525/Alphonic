// firebase.js
const admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey.json"); // 🔐 Download this from Firebase Console > Project Settings > Service Accounts

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://voicebotai-39243.firebaseio.com" // Replace with your actual database URL
});

const db = admin.database();

module.exports = db;