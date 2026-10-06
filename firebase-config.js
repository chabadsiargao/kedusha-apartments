// Firebase web app settings (Project settings -> Your apps -> Web app "site").
// These identify the project; they are not secrets. Access is enforced by firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyCdiDh_-SmGgV5oMOq34DQ7GdGpFVlCcrE",
  authDomain: "kedusha-apartments.firebaseapp.com",
  projectId: "kedusha-apartments",
  storageBucket: "kedusha-apartments.firebasestorage.app",
  messagingSenderId: "573751280302",
  appId: "1:573751280302:web:11c2d7fd36554984ae633f"
};

// Google Apps Script web app that emails the owner when someone registers. Empty = no email.
export const notifyUrl = "";
