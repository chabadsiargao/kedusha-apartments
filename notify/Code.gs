/**
 * Notifications for "דירות של קדושה" (Google Apps Script, runs as the owner).
 *
 * The site pings this web app after every action. The script then reads what
 * happened from Firestore itself (never from the request, which anyone could
 * forge), and sends:
 *   - an email + push to managers for each new access request
 *   - push notifications by role for events in the activity log
 * A 5-minute trigger (created by setup()) catches anything a ping missed.
 */
const PROJECT = "kedusha-apartments";
const SITE = "https://chabadsiargao.github.io/kedusha-apartments/";
const ICON = SITE + "icon-192.png";
const FS = "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents";
const FCM = "https://fcm.googleapis.com/v1/projects/" + PROJECT + "/messages:send";

function doPost() { return run_(); }
function doGet() { return run_(); }
function run_() {
  try { processAll(); } catch (err) { console.error(err); }
  return ContentService.createTextOutput("ok");
}

/** Run once from the editor: authorizes the script and creates the 5-minute trigger. */
function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("processAll").timeBased().everyMinutes(5).create();
  PropertiesService.getScriptProperties().setProperty("lastLogAt", String(Date.now()));
  processAll();
}

let cache_ = null;
function processAll() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    cache_ = {};
    processRegistrations_();
    processLog_();
  } finally {
    cache_ = null;
    lock.releaseLock();
  }
}

/* ---------- Firestore REST ---------- */
function api_(method, url, body) {
  const r = UrlFetchApp.fetch(url, {
    method: method, contentType: "application/json", muteHttpExceptions: true,
    payload: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }
  });
  let json = null;
  try { json = JSON.parse(r.getContentText() || "null"); } catch (e) {}
  return { code: r.getResponseCode(), json: json, text: r.getContentText() };
}
function val_(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(val_);
  if ("mapValue" in v) { const o = {}, f = v.mapValue.fields || {}; for (const k in f) o[k] = val_(f[k]); return o; }
  return null;
}
function doc_(d) {
  const o = {}, f = d.fields || {};
  for (const k in f) o[k] = val_(f[k]);
  o._id = d.name.split("/").pop();
  o._name = d.name;
  return o;
}
function query_(collection, where, orderBy, limit) {
  const sq = { from: [{ collectionId: collection }] };
  if (where) sq.where = where;
  if (orderBy) sq.orderBy = orderBy;
  if (limit) sq.limit = limit;
  const r = api_("post", FS + ":runQuery", { structuredQuery: sq });
  if (r.code !== 200) throw new Error("runQuery " + collection + " -> " + r.code + " " + r.text);
  return (r.json || []).filter(x => x.document).map(x => doc_(x.document));
}
function users_() { return cache_.users || (cache_.users = query_("users")); }
function tokens_() { return cache_.tokens || (cache_.tokens = query_("pushTokens")); }
function nameOf_(uid) { const u = users_().find(x => x._id === uid); return (u && u.name) || ""; }

/* ---------- push ---------- */
// Devices of active users with one of `roles`, except the person who did the action.
function devices_(roles, exceptUid) {
  const ok = {};
  users_().forEach(u => { if (!u.disabled && roles.indexOf(u.role) >= 0) ok[u._id] = true; });
  return tokens_().filter(t => ok[t.uid] && t.uid !== exceptUid);
}
function push_(devices, msg) {
  devices.forEach(t => {
    const en = t.lang === "en", m = en ? msg.en : msg.he;
    const r = api_("post", FCM, { message: { token: t._id, webpush: {
      notification: { title: m.title, body: m.body, icon: ICON, badge: ICON, lang: en ? "en" : "he", dir: en ? "ltr" : "rtl" },
      fcm_options: { link: msg.link || SITE }
    } } });
    // A token the phone no longer uses: forget it.
    if (r.code === 404 || /UNREGISTERED/.test(r.text)) api_("delete", "https://firestore.googleapis.com/v1/" + t._name);
    else if (r.code !== 200) console.warn("FCM " + r.code + " " + r.text);
  });
}

/* ---------- access requests ---------- */
function processRegistrations_() {
  const pending = query_("users", { fieldFilter: { field: { fieldPath: "role" }, op: "EQUAL", value: { stringValue: "pending" } } })
    .filter(u => !u.notified && !u.disabled);
  if (!pending.length) return;
  const managers = devices_(["manager"]);
  pending.forEach(u => {
    const name = String(u.name || "").slice(0, 60), user = String(u.username || "").slice(0, 30), note = String(u.note || "").slice(0, 200);
    MailApp.sendEmail({
      to: Session.getEffectiveUser().getEmail(),
      subject: "בקשת הצטרפות חדשה: " + name,
      body: name + " (שם משתמש: " + user + ") ביקש/ה להצטרף ל\"דירות של קדושה\".\n" +
        (note ? "הערה: " + note + "\n" : "") + "\nלאישור ולבחירת תפקיד:\n" + SITE + "#requests\n"
    });
    push_(managers, {
      he: { title: "בקשת הצטרפות חדשה", body: name + " מבקש/ת להצטרף. לחצו כדי לאשר." },
      en: { title: "New access request", body: name + " wants to join. Tap to review." },
      link: SITE + "#requests"
    });
    api_("patch", "https://firestore.googleapis.com/v1/" + u._name + "?updateMask.fieldPaths=notified", { fields: { notified: { booleanValue: true } } });
  });
}

/* ---------- activity log ---------- */
const CAT = {
  he: { plumbing: "סתימה / אינסטלציה", light: "תאורה", electric: "חשמל", ac: "מזגן", water: "מים חמים / דוד", internet: "אינטרנט", appliance: "מכשיר חשמלי", lock: "מנעול / מפתח", door: "דלת / חלון / קיר", pest: "מזיקים", other: "אחר" },
  en: { plumbing: "Clog / plumbing", light: "Lighting", electric: "Electrical", ac: "Air conditioning", water: "Hot water", internet: "Internet", appliance: "Appliance", lock: "Lock / key", door: "Door / window / wall", pest: "Pests", other: "Other" }
};
function processLog_() {
  const props = PropertiesService.getScriptProperties();
  let last = Number(props.getProperty("lastLogAt") || 0);
  if (!last) { props.setProperty("lastLogAt", String(Date.now())); return; }
  const entries = query_("log",
    { fieldFilter: { field: { fieldPath: "at" }, op: "GREATER_THAN", value: { integerValue: String(last) } } },
    [{ field: { fieldPath: "at" }, direction: "ASCENDING" }], 50);
  entries.forEach(l => {
    try { notifyFor_(l); } catch (e) { console.error(e); }
    last = Math.max(last, Number(l.at) || 0);
  });
  if (entries.length) props.setProperty("lastLogAt", String(last));
}
function notifyFor_(l) {
  const u = l.u || "", p = l.p || {}, by = l.by, who = nameOf_(by);
  const whoHe = who || "משתמש", whoEn = who || "someone";
  const catHe = CAT.he[p.c] || "אחר", catEn = CAT.en[p.c] || "Other";
  switch (l.t) {
    case "clean":
      if (p.v === "dirty") push_(devices_(["cleaning", "manager"], by), {
        he: { title: "דירה " + u + " צריכה ניקיון", body: "סומן ע\"י " + whoHe },
        en: { title: "Apartment " + u + " needs cleaning", body: "Marked by " + whoEn } });
      else if (p.v === "clean") push_(devices_(["manager"], by), {
        he: { title: "דירה " + u + " נקייה", body: "נוקתה ע\"י " + whoHe },
        en: { title: "Apartment " + u + " is clean", body: "Cleaned by " + whoEn } });
      break;
    case "issue_new": {
      const urgent = p.prio === "urgent";
      push_(devices_(["manager", "maintenance"], by), {
        he: { title: (urgent ? "תקלה דחופה" : "תקלה חדשה") + " בדירה " + u, body: catHe + " · דווח ע\"י " + whoHe },
        en: { title: (urgent ? "Urgent issue" : "New issue") + " in apartment " + u, body: catEn + " · reported by " + whoEn } });
      break;
    }
    case "issue_st":
      if (p.s === "done") push_(devices_(["manager"], by), {
        he: { title: "טופלה תקלה בדירה " + u, body: catHe + " · " + whoHe },
        en: { title: "Issue fixed in apartment " + u, body: catEn + " · " + whoEn } });
      break;
    case "push_test":
      push_(tokens_().filter(t => t.uid === by), {
        he: { title: "התראת ניסיון", body: "ההתראות בטלפון עובדות ✓" },
        en: { title: "Test notification", body: "Phone notifications work ✓" } });
      break;
  }
}
