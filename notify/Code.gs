/**
 * Google Apps Script web app: emails the account owner when someone registers
 * on "דירות של קדושה". Deploy as Web app, execute as: Me, access: Anyone.
 * The site posts {name, username, note}; nothing else is accepted.
 */
const SITE_URL = "https://chabadsiargao.github.io/kedusha-apartments/#requests";
const DAILY_LIMIT = 30; // protects the inbox if the address is abused

function doPost(e) {
  try {
    const p = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const props = PropertiesService.getScriptProperties();
    const key = "count_" + Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd");
    const n = Number(props.getProperty(key) || 0);
    if (n >= DAILY_LIMIT) return reply("limit");
    props.setProperty(key, String(n + 1));

    // The site sends ASCII-only JSON (\uXXXX escapes), so Hebrew arrives intact.
    // If a sender ever used the wrong encoding, say so plainly instead of mailing garbage.
    const BROKEN = "(הטקסט לא נקלט כראוי, הפרטים המלאים מופיעים באתר)";
    const clean = (v, max) => {
      const s = String(v || "").replace(/[\r\n]+/g, " ").slice(0, max);
      return /�/.test(s) ? BROKEN : s;
    };
    const name = clean(p.name, 60), username = clean(p.username, 30), note = clean(p.note, 200);
    if (!name || !username) return reply("bad");

    MailApp.sendEmail({
      to: Session.getEffectiveUser().getEmail(),
      subject: "בקשת הצטרפות חדשה: " + name,
      body:
        name + " (שם משתמש: " + username + ") ביקש/ה להצטרף ל\"דירות של קדושה\".\n" +
        (note ? "הערה: " + note + "\n" : "") +
        "\nלאישור ולבחירת תפקיד:\n" + SITE_URL + "\n"
    });
    return reply("ok");
  } catch (err) {
    return reply("error");
  }
}

function reply(s) { return ContentService.createTextOutput(s); }
