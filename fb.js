// Thin wrapper around Firebase so the app talks to one small interface.
// The app never imports Firebase directly; tests swap this file for an in-memory mock.
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  onSnapshot, query, orderBy, limit, where, writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getMessaging, getToken, deleteToken, isSupported, onMessage } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js";

// Firestore error codes -> the codes the app already handles.
function mapErr(e) {
  const c = e && e.code;
  if (c === "permission-denied" || c === "invalid-argument" || c === "failed-precondition" || c === "not-found") return { code: "invalid_argument", message: String(e.message || c) };
  if (c === "resource-exhausted") return { code: "quota_exceeded", message: String(e.message || c) };
  if (c === "unauthenticated") return { code: "revoked", message: String(e.message || c) };
  return { code: "unavailable", message: String((e && e.message) || c || "error") };
}
async function wrap(p) { try { return await p; } catch (e) { throw mapErr(e); } }

const snapDoc = s => ({ id: s.id, exists: s.exists(), data: () => s.data(), metadata: s.metadata });
const snapQuery = s => ({ docs: s.docs.map(snapDoc), size: s.size, empty: s.empty, metadata: s.metadata });

function mkDoc(ref) {
  return {
    id: ref.id, path: ref.path,
    get: async () => snapDoc(await wrap(getDoc(ref))),
    set: d => wrap(setDoc(ref, d)),
    update: d => wrap(updateDoc(ref, d)),
    delete: () => wrap(deleteDoc(ref)),
    onSnapshot: (next, err) => onSnapshot(ref, s => next(snapDoc(s)), e => err && err(mapErr(e))),
    collection: p => mkCol(collection(ref, p))
  };
}
function mkQuery(q) {
  return {
    where: (f, op, v) => mkQuery(query(q, where(f, op, v))),
    orderBy: (f, d) => mkQuery(query(q, orderBy(f, d || "asc"))),
    limit: n => mkQuery(query(q, limit(n))),
    get: async () => snapQuery(await wrap(getDocs(q))),
    onSnapshot: (next, err) => onSnapshot(q, s => next(snapQuery(s)), e => err && err(mapErr(e)))
  };
}
function mkCol(ref) {
  return Object.assign(mkQuery(ref), {
    path: ref.path,
    doc: id => mkDoc(id ? doc(ref, id) : doc(ref)),
    add: async d => mkDoc(await wrap(addDoc(ref, d)))
  });
}

function authErr(e) { return { code: (e && e.code) || "auth/unknown", message: String((e && e.message) || "") }; }

export async function connect(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  let fs;
  try { fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch (e) { fs = getFirestore(app); }

  const db = {
    doc: p => mkDoc(doc(fs, p)),
    collection: p => mkCol(collection(fs, p)),
    // Several writes that succeed or fail together.
    batch: () => {
      const b = writeBatch(fs);
      return {
        set(p, d) { b.set(doc(fs, p), d); return this; },
        update(p, d) { b.update(doc(fs, p), d); return this; },
        delete(p) { b.delete(doc(fs, p)); return this; },
        commit: () => wrap(b.commit())
      };
    }
  };

  return {
    db,
    onAuth: cb => onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email } : null)),
    signIn: async (email, pass) => { try { await signInWithEmailAndPassword(auth, email, pass); } catch (e) { throw authErr(e); } },
    // Creates an account and signs this device in as it (first-time setup).
    signUp: async (email, pass) => {
      try { const c = await createUserWithEmailAndPassword(auth, email, pass); return { uid: c.user.uid, remove: () => c.user.delete() }; }
      catch (e) { throw authErr(e); }
    },
    // Creates an account for someone else without signing this device out.
    createLogin: async (email, pass) => {
      const app2 = initializeApp(config, "creator-" + Date.now());
      try {
        const a2 = initializeAuth(app2, { persistence: inMemoryPersistence });
        const c = await createUserWithEmailAndPassword(a2, email, pass);
        const uid = c.user.uid;
        await signOut(a2);
        return uid;
      } catch (e) { throw authErr(e); }
      finally { deleteApp(app2).catch(() => {}); }
    },
    changePassword: async (oldPass, newPass) => {
      const u = auth.currentUser; if (!u) throw { code: "auth/no-user" };
      try { await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, oldPass)); await updatePassword(u, newPass); }
      catch (e) { throw authErr(e); }
    },
    signOut: () => signOut(auth),
    // Push notifications for this device.
    push: {
      supported: () => isSupported().catch(() => false),
      // Returns the device token. Uses the SDK's default web push key.
      enable: async swReg => getToken(getMessaging(app), { serviceWorkerRegistration: swReg }),
      disable: async () => { try { await deleteToken(getMessaging(app)); } catch (e) {} },
      onForeground: cb => { isSupported().then(ok => { if (ok) onMessage(getMessaging(app), p => cb(p)); }).catch(() => {}); }
    }
  };
}
