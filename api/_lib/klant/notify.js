// Meldingen aan de eigenaar: elke belangrijke gebeurtenis (nieuwe aanvraag, reactie, offerte
// bekeken of geaccepteerd, voorbeeldsite geopend, warme lead via de websitecheck) komt in HQ én
// per e-mail (Gmail op je telefoon geeft dan een pushmelding). Nooit dubbel (vaste sleutel),
// stille uren worden gerespecteerd, en testgegevens geven nooit een e-mail.
import { q, one } from "../db.js";
import { env } from "../env.js";
import { salesAiSettings } from "../budget.js";
import { waitUntil } from "../runtime.js";
import { amsParts, amsToUtc } from "../content/studio.js";

async function quiet(d) {
  const r = (await d.query("select value from hq.settings where key='availability'")).rows[0]?.value || {};
  return { from: r.quiet_from || "21:00", to: r.quiet_to || "08:00" };
}
const mins = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };

/** Eerstvolgende moment buiten de stille uren (Nederlandse tijd). */
export function afterQuiet(now, { from, to }) {
  const p = amsParts(now), cur = p.hh * 60 + p.mm, f = mins(from), t = mins(to);
  const inQuiet = f > t ? (cur >= f || cur < t) : (cur >= f && cur < t);
  if (!inQuiet) return now;
  const [th, tm] = to.split(":").map(Number);
  const at = amsToUtc(p.y, p.m, p.d, th, tm);
  if (at > now) return at;
  // Morgen om dat tijdstip (via de kalenderdatum, dus ook goed rond zomer- en wintertijd).
  const n = amsParts(new Date(now.getTime() + 864e5));
  return amsToUtc(n.y, n.m, n.d, th, tm);
}

/**
 * Legt een melding vast (één keer per sleutel). Binnen een transactie: geef `db` mee; de
 * e-mail gaat dan na de commit (kort daarna of bij de volgende cron-run, uiterlijk 5 min).
 */
export async function notify({ key, kind, title, body = "", leadId = null, url = null, isTest = false }, db = null) {
  const d = db || { query: q };
  const deliver = afterQuiet(new Date(), await quiet(d));
  const r = (await d.query(`insert into hq.notifications (key, kind, title, body, url, lead_id, is_test, deliver_after) values ($1,$2,$3,$4,$5,$6,$7,$8)
    on conflict (key) do nothing returning id`, [String(key).slice(0, 200), kind, String(title).slice(0, 200), String(body).slice(0, 2000), url, leadId, isTest, deliver])).rows[0];
  if (r && !isTest) waitUntil(new Promise((ok) => setTimeout(ok, 1500)).then(() => flushNotifications({ limit: 5 })));
  return r ? r.id : null;
}

/** Naar wie meldingen per e-mail gaan: ingesteld adres, anders de eigenaar. */
export async function notifyTarget() {
  const s = await salesAiSettings();
  if (s.notify_email && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s.notify_email)) return s.notify_email;
  return (await one("select email from hq.members where role='eigenaar' and status in ('actief','uitgenodigd') order by created_at limit 1"))?.email || null;
}

/** Verstuurt openstaande meldingen (één poging per melding: nooit dubbel). */
export async function flushNotifications({ limit = 20 } = {}) {
  const { mailConfigured, sendSimpleMail } = await import("./mail.js");
  const due = (await q("select id from hq.notifications where sent_at is null and deliver_after <= now() order by created_at limit $1", [limit])).rows;
  if (!due.length) return 0;
  const to = mailConfigured() ? await notifyTarget() : null;
  let n = 0;
  for (const { id } of due) {
    // Claim: precies één verzender per melding.
    const m = (await q("update hq.notifications set sent_at=now() where id=$1 and sent_at is null returning *", [id])).rows[0];
    if (!m) continue;
    if (m.is_test) { await q("update hq.notifications set send_error='testgegevens: alleen in HQ' where id=$1", [id]); continue; }
    if (!to) { await q("update hq.notifications set send_error=$2 where id=$1", [id, mailConfigured() ? "geen eigenaar-adres" : "geen e-mailkoppeling: alleen in HQ"]); continue; }
    try {
      const link = m.url ? `${env.siteUrl}${m.url}` : `${env.siteUrl}/hq/vandaag`;
      await sendSimpleMail({ to, subject: `HQ: ${m.title}`, text: `${m.body ? `${m.body}\n\n` : ""}Open in HQ: ${link}\n\n(Melding van StrakWerk HQ)` });
      n++;
    } catch (e) {
      await q("update hq.notifications set send_error=$2 where id=$1", [id, String(e.message || e).slice(0, 300)]);
    }
  }
  return n;
}
