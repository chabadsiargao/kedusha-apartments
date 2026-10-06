// Service worker that receives push notifications (Firebase Cloud Messaging).
// Messages carry a webpush `notification` payload, which the SDK shows by itself,
// and `fcm_options.link`, which it opens on tap.
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js");

// Keep in sync with firebase-config.js (a classic worker can't import that ES module).
firebase.initializeApp({
  apiKey: "AIzaSyCdiDh_-SmGgV5oMOq34DQ7GdGpFVlCcrE",
  authDomain: "kedusha-apartments.firebaseapp.com",
  projectId: "kedusha-apartments",
  storageBucket: "kedusha-apartments.firebasestorage.app",
  messagingSenderId: "573751280302",
  appId: "1:573751280302:web:11c2d7fd36554984ae633f"
});
firebase.messaging();

// Taps on notifications the site popped up itself (FCM handles its own via fcm_options.link).
self.addEventListener("notificationclick", e => {
  if (e.notification.data && e.notification.data.FCM_MSG) return;
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow("./");
  }));
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
