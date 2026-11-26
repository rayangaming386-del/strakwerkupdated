// Contactregels voor álle afdelingen: afmeldingen, bezwaren en onbestelbare adressen,
// contactgronden per kanaal, contactfrequentie en de stand van elke verzendroute.
// Twee aparte vragen: past dit bedrijf bij ons? en: mogen we het via dit kanaal benaderen?
import { q, one } from "../db.js";
import { HttpError, assertUuid, str } from "../http.js";
import { audit } from "../db.js";

export const normEmail = (v) => (v ? String(v).trim().toLowerCase() : null);
export const normPhone = (v) => { if (!v) return null; let d = String(v).replace(/[^\d+]/g, ""); if (d.startsWith("00")) d = "+" + d.slice(2); if (d.startsWith("06")) d = "+316" + d.slice(2); if (/^0\d{9}$/.test(d)) d = "+31" + d.slice(1); return d || null; };
export const domainOf = (email) => (email && email.includes("@") ? email.split("@")[1].toLowerCase() : null);

export const BASIS_LABEL = {
  toestemming: "Toestemming gegeven",
  zelf_contact_gezocht: "Klant zocht zelf contact (reactie op aanvraag)",
  bestaande_klant: "Bestaande klant (eigen vergelijkbare dienst)",
  gerechtvaardigd_belang_zakelijk: "Gerechtvaardigd belang, zakelijk (alleen bellen of langsgaan, met onderbouwing)",
};

// Elektronische berichten (e-mail, WhatsApp) voor marketing vragen in Nederland vooraf
// toestemming, ook bij bedrijven (Telecommunicatiewet art. 11.7); uitzonderingen: de klant
// zocht zelf contact, of een bestaande klant (eigen vergelijkbare dienst, met afmeldoptie).
// "Gerechtvaardigd belang" telt daarom alleen voor bellen of langsgaan, nooit voor mail/app.
export const ELECTRONIC = new Set(["email", "whatsapp"]);
export const ELECTRONIC_RULE = "Voor mail en WhatsApp is vooraf toestemming nodig, ook bij bedrijven (Telecommunicatiewet). Vraag het eerst telefonisch of persoonlijk (\"Mag ik je een voorbeeld sturen?\") en leg het vast als toestemming.";

export async function getRoutes(db) {
  const r = (await (db || { query: q }).query("select value from hq.settings where key='routes'")).rows[0]?.value || {};
  const d = { auto: false, paused: false, pause_reason: null, live: false, max_per_day: 10, min_days_between: 7 };
  return { email: { ...d, ...(r.email || {}) }, whatsapp: { ...d, ...(r.whatsapp || {}) }, telefoon: { ...d, ...(r.telefoon || {}) } };
}

export async function putRoutes(body, auth) {
  const cur = await getRoutes();
  for (const ch of ["email", "whatsapp", "telefoon"]) if (body[ch]) {
    const b = body[ch];
    // Automatisch of live versturen vraagt eenmalig een bevestiging dat de voorwaarden van de
    // verzenddienst (bijv. Gmail) zakelijke berichten op deze manier toestaan.
    if ((b.auto || b.live) && !cur[ch].terms_checked_at && !b.terms_checked) throw new HttpError(409, "voorwaarden", "Bevestig eerst dat je de voorwaarden van je verzenddienst hebt gecontroleerd (zakelijke berichten, limieten).");
    if (b.terms_checked && !cur[ch].terms_checked_at) cur[ch].terms_checked_at = new Date().toISOString();
    if ("auto" in b) cur[ch].auto = Boolean(b.auto);
    if ("live" in b) cur[ch].live = Boolean(b.live);
    if ("max_per_day" in b) { const n = Number(b.max_per_day); if (!(n >= 0 && n <= 50)) throw new HttpError(400, "ongeldig", "Maximaal 50 per dag."); cur[ch].max_per_day = Math.round(n); }
    if ("min_days_between" in b) { const n = Number(b.min_days_between); if (!(n >= 1 && n <= 60)) throw new HttpError(400, "ongeldig", "Tussen 1 en 60 dagen."); cur[ch].min_days_between = Math.round(n); }
  }
  // WhatsApp en telefoon hebben geen gratis automatische route: alleen klaarzetten.
  cur.whatsapp.auto = false; cur.telefoon.auto = false;
  await q("insert into hq.settings (key, value, updated_by, updated_at) values ('routes',$1,$2,now()) on conflict (key) do update set value=excluded.value, updated_by=excluded.updated_by, updated_at=now()", [cur, auth?.userId || null]);
  if (auth) await audit(null, { actor: auth.userId, label: auth.email, action: "routes.gewijzigd", details: cur });
  return cur;
}

export async function pauseRoute(channel, reason) {
  const r = await getRoutes();
  r[channel].paused = true; r[channel].pause_reason = reason;
  await q("insert into hq.settings (key, value, updated_at) values ('routes',$1,now()) on conflict (key) do update set value=excluded.value, updated_at=now()", [r]);
}
export async function unpauseRoute(channel) {
  const r = await getRoutes();
  r[channel].paused = false; r[channel].pause_reason = null;
  await q("insert into hq.settings (key, value, updated_at) values ('routes',$1,now()) on conflict (key) do update set value=excluded.value, updated_at=now()", [r]);
}

/**
 * Staat dit adres, nummer, domein of deze klant op de afmeldlijst? Met `channel` alleen wat
 * voor dat kanaal geldt: een onbestelbaar e-mailadres blokkeert bellen niet.
 */
export async function suppressedFor(lead, db, channel = null) {
  const d = db || { query: q };
  const email = normEmail(lead.contact_email), phone = normPhone(lead.contact_phone), dom = domainOf(email);
  const kinds = channel === "email" ? ["lead", "email", "domein"] : channel === "whatsapp" || channel === "telefoon" ? ["lead", "telefoon"] : ["lead", "email", "telefoon", "domein"];
  const r = (await d.query(`select kind, value, reason, at from hq.suppressions where kind = any($5::text[]) and ((kind='lead' and value=$1) or (kind='email' and value=$2) or (kind='telefoon' and value=$3) or (kind='domein' and value=$4)) order by at limit 1`,
    [lead.id, email || "-", phone || "-", dom || "-", kinds])).rows[0];
  return r || null;
}

export async function suppress({ lead, reason, note = null, kind = null }, db) {
  const d = db || { query: q };
  const rows = [["lead", lead.id]];
  if (normEmail(lead.contact_email)) rows.push(["email", normEmail(lead.contact_email)]);
  if (normPhone(lead.contact_phone)) rows.push(["telefoon", normPhone(lead.contact_phone)]);
  for (const [k, v] of rows) {
    if (kind && k !== kind) continue; // kanaal-specifiek (bounce: alleen e-mail); zonder kind: alles
    await d.query("insert into hq.suppressions (value, kind, reason, lead_id, note) values ($1,$2,$3,$4,$5) on conflict (kind, value) do nothing", [v, k, reason, lead.id, note]);
  }
  // Alles wat nog gepland staat voor deze klant vervalt (alle afdelingen). Een bounce of een
  // bezwaar tegen één kanaal raakt alleen dat kanaal; een afmelding raakt alles.
  const ch = kind === "email" ? "email" : kind === "telefoon" ? "telefoon" : null;
  await d.query("update hq.outreach set status='geannuleerd', cancel_reason=$2, updated_at=now() where lead_id=$1 and status in ('concept','gepland','klaar_handmatig') and ($3::text is null or channel=$3)", [lead.id, `Afgemeld/bezwaar: ${reason}`, ch]);
  await d.query("update hq.consents set revoked_at=now(), revoke_reason=$2 where lead_id=$1 and revoked_at is null and ($3::text is null or channel=$3)", [lead.id, reason, ch]);
  // Voorbeeldsite offline en niet meer bellen (een bounce op e-mail raakt bellen niet).
  if (!kind || kind === "lead") await d.query("update hq.previews set status='ingetrokken' where lead_id=$1 and status<>'ingetrokken'", [lead.id]);
  if (!kind || kind === "telefoon" || kind === "lead") await d.query("update hq.calls set outcome='niet_bellen', done_at=now(), notes=coalesce(notes,'') || $2 where lead_id=$1 and outcome is null", [lead.id, ` [${reason}]`]);
}

export async function validConsent(leadId, channel, db) {
  // Voor mail en WhatsApp telt "gerechtvaardigd belang" nooit als grond (zie ELECTRONIC_RULE).
  return (await (db || { query: q }).query(`select * from hq.consents where lead_id=$1 and channel=$2 and revoked_at is null
      and not ($2 in ('email','whatsapp') and basis = 'gerechtvaardigd_belang_zakelijk') order by recorded_at desc limit 1`, [leadId, channel])).rows[0] || null;
}

export async function recordConsent(leadId, body, auth, db) {
  assertUuid(leadId, "klant");
  const channel = String(body.channel || ""), basis = String(body.basis || "");
  if (!["email", "whatsapp", "telefoon"].includes(channel)) throw new HttpError(400, "ongeldig", "Onbekend kanaal.");
  if (!BASIS_LABEL[basis]) throw new HttpError(400, "ongeldig", "Onbekende contactgrond.");
  if (ELECTRONIC.has(channel) && basis === "gerechtvaardigd_belang_zakelijk") throw new HttpError(400, "ongeldig", ELECTRONIC_RULE);
  const source = str(body.source, 300), scope = str(body.scope, 300), evidence = str(body.evidence, 1000);
  if (!source || !scope || !evidence) throw new HttpError(400, "ongeldig", "Vul bron, reikwijdte en onderbouwing in. Een openbaar e-mailadres alleen is geen contactgrond.");
  if (basis === "gerechtvaardigd_belang_zakelijk" && evidence.length < 40) throw new HttpError(400, "ongeldig", "Onderbouw het gerechtvaardigd belang concreet (afweging, waarom dit bedrijf, waarom dit kanaal).");
  if (/openbaar.*(e-?mail|adres)/i.test(evidence) && evidence.length < 80) throw new HttpError(400, "ongeldig", "Een openbaar e-mailadres is op zichzelf onvoldoende als contactgrond.");
  const r = (await (db || { query: q }).query("insert into hq.consents (lead_id, channel, basis, source, scope, evidence, recorded_by) values ($1,$2,$3,$4,$5,$6,$7) returning *",
    [leadId, channel, basis, source, scope, evidence, auth?.userId || null])).rows[0];
  if (auth) await audit(db, { actor: auth.userId, label: auth.email, action: "contactgrond.vastgelegd", entity: "lead", entityId: leadId, details: { channel, basis } });
  return r;
}

/**
 * Mag HQ deze klant nu via dit kanaal benaderen? Geeft alle redenen terug.
 * Wordt vlak voor elke verzending opnieuw gecontroleerd.
 */
export async function contactCheck(lead, channel, { kind = "eerste_contact", db } = {}) {
  const d = db || { query: q };
  const reasons = [];
  const routes = await getRoutes(d);
  const route = routes[channel];
  const sup = await suppressedFor(lead, d, channel);
  if (sup) reasons.push(`afgemeld/geblokkeerd (${sup.reason}, ${new Date(sup.at).toLocaleDateString("nl-NL")})`);
  if (lead.status === "afgemeld") reasons.push("klant heeft zich afgemeld");
  const consent = await validConsent(lead.id, channel, d);
  // Reactie op een eigen aanvraag of een bestaande klant: grond moet wel vastgelegd zijn.
  if (!consent) reasons.push(ELECTRONIC.has(channel) ? "geen toestemming voor mail of WhatsApp vastgelegd: vraag het eerst telefonisch of persoonlijk" : `geen geldige contactgrond voor ${channel} vastgelegd`);
  if (channel === "email" && !normEmail(lead.contact_email)) reasons.push("geen e-mailadres");
  if (route?.paused) reasons.push(`route ${channel} gepauzeerd: ${route.pause_reason || "fout"}`);
  if (route && kind !== "antwoord") {
    const last = (await d.query("select max(sent_at) as t from hq.outreach where lead_id=$1 and channel=$2 and status in ('verzonden','handmatig_verzonden','test_verzonden') and kind not in ('antwoord','afspraak_bevestiging')", [lead.id, channel])).rows[0]?.t;
    // Opvolging van een lopende offerte of nazorg bij een klant: kortere minimale tussenpoos (3 dagen).
    const minDays = ["offerte_opvolging", "nazorg", "intake_herinnering"].includes(kind) ? Math.min(route.min_days_between, 3) : route.min_days_between;
    if (last && Date.now() - new Date(last) < minDays * 864e5) reasons.push(`laatste bericht minder dan ${minDays} dagen geleden`);
    const today = (await d.query("select count(*)::int n from hq.outreach where channel=$1 and status in ('verzonden','test_verzonden') and sent_at > date_trunc('day', now() at time zone 'Europe/Amsterdam') at time zone 'Europe/Amsterdam'", [channel])).rows[0].n;
    if (today >= route.max_per_day) reasons.push(`daglimiet ${route.max_per_day} berichten bereikt`);
  }
  return { allowed: reasons.length === 0, reasons, consent, route, automatic: Boolean(route?.auto && !route?.paused) };
}
