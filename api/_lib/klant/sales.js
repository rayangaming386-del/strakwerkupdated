// SALES: intake, kwalificatie, offertes, opvolging, reacties, afspraken en betalingen.
// Alles komt op één klantkaart (hq.leads + hq.interactions). Gewone code doet de regels;
// AI mag later alleen de samenvatting en het antwoord verfijnen (binnen het AI-budget).
import { randomUUID, createHash } from "node:crypto";
import { q, one, tx, audit } from "../db.js";
import { HttpError, assertUuid, str } from "../http.js";
import { normalizeDomain, companyKey } from "../crm.js";
import { SITE, amsParts, amsToUtc, projectFromQuote } from "../content/studio.js";
import { normEmail, normPhone, suppress, contactCheck, recordConsent } from "./contact.js";

const OPT = Object.fromEntries((SITE.options || []).map(o => [o.id, o]));
const BASE = SITE.bases;
const eur = (n) => `€${n}`;

export async function salesSettings(db) {
  const r = (await (db || { query: q }).query("select value from hq.settings where key='sales'")).rows[0]?.value || {};
  return { followup: { enabled: true, max: 2, days: [3, 7], only_with_interest: true, ...(r.followup || {}) }, capacity: { max_projects: 3, days_per_project: 14, ...(r.capacity || {}) }, reply_style: r.reply_style || "kort, persoonlijk, je-vorm" };
}

// ── Behoefte herkennen (gewone code; woorden uit het bericht) ─────────────────
const FEATURES = [
  { re: /afspra(ak|ken)|boek|reserv|agenda|planning/i, opt: "booking", need: "online afspraken" },
  { re: /kenteken|rdw|auto ?model|automerk/i, opt: "kenteken", need: "kentekencheck" },
  { re: /webshop|verkop|winkelwagen|bestell/i, opt: "webshop", need: "webshop" },
  { re: /zelf (aanpassen|wijzigen|bewerken)|beheer/i, opt: "beheer", need: "zelf aanpassen" },
  { re: /whatsapp/i, opt: "aanvraag", need: "aanvragen via WhatsApp" },
  { re: /prijs|prijzen|tarieven|prijslijst|calculator/i, opt: "calculator", need: "prijzen tonen" },
  { re: /logo/i, opt: "logo", need: "logo" },
  { re: /blog|nieuws/i, opt: "blog", need: "blog" },
  { re: /engels|meertalig|taal/i, opt: "taal", need: "extra taal" },
  { re: /onderhoud|hosting/i, opt: "onderhoud", need: "onderhoud" },
];
const SECTORS = [
  { re: /kapper|kapsalon|barber|salon|beauty|nagel|wimper|laser/i, segment: "salons", word: "salon" },
  { re: /garage|autobedrijf|auto|apk|banden|carplay|inbouw/i, segment: "autobedrijven", word: "autobedrijf" },
  { re: /loodgieter|elektric|schilder|timmer|aannemer|klus|installat|schoonmaak|dienstverl/i, segment: "dienstverleners", word: "bedrijf" },
];

export function analyzeNeed({ message = "", type = "", company = "" }) {
  const text = `${type} ${message}`;
  const feats = FEATURES.filter(f => f.re.test(text));
  const sector = SECTORS.find(s => s.re.test(`${text} ${company}`));
  const redesign = /vernieuw|huidige site|oude site|redesign|opnieuw/i.test(text);
  const webshop = feats.some(f => f.opt === "webshop");
  const hasWebsiteWish = /website|site|webshop|pagina/i.test(text) || feats.length > 0;
  // Pakket: zelf aanpassen/afspraken → Premium; meertalig/blog → Pro; vernieuwen → Redesign; anders Starter.
  let pkg = redesign ? "redesign" : "nieuw";
  if (!redesign && feats.some(f => ["beheer", "booking", "aanvraag"].includes(f.opt))) pkg = "premium";
  if (!redesign && feats.some(f => ["taal", "blog"].includes(f.opt))) pkg = "pro";
  const incl = BASE[pkg]?.incl || {};
  const options = [...new Set(feats.map(f => f.opt))].filter(o => OPT[o] && !incl[o]);
  const missing = [];
  if (!company) missing.push("bedrijfsnaam");
  if (!/\d+\s*pagina|pagina'?s/i.test(text)) missing.push("hoeveel pagina's of welke onderdelen");
  if (!/www\.|\.nl|\.com|geen website|nog geen site/i.test(text) && !redesign) missing.push("of er al een website is (adres)");
  if (!/deadline|wanneer|voor (de|het)|week|maand|zo snel/i.test(text)) missing.push("gewenste startdatum");
  if (!/logo|huisstijl|kleur/i.test(text)) missing.push("logo en huisstijl (aanwezig of nodig)");
  const needs = feats.map(f => f.need);
  const summary = `${sector ? `${sector.word[0].toUpperCase()}${sector.word.slice(1)}` : "Ondernemer"} zoekt ${redesign ? "een vernieuwde website" : webshop ? "een webshop" : "een website"}${needs.length ? ` met ${needs.join(", ")}` : ""}.`;
  // Gekwalificeerd = concrete behoefte die bij onze diensten past + genoeg informatie voor een vervolgstap.
  const concrete = hasWebsiteWish;
  const enough = Boolean(company) || needs.length > 0;
  return { summary, segment: sector?.segment || null, package: pkg, options, needs, missing, qualified: concrete && enough,
    qualification: { concrete_behoefte: concrete, past_bij_diensten: concrete, genoeg_info_voor_vervolgstap: enough, definitie: "Een concrete behoefte die bij de diensten van StrakWerk past, plus genoeg informatie voor een vervolgstap." } };
}

export function quoteLines(pkg, options = []) {
  const b = BASE[pkg];
  if (!b) throw new HttpError(400, "ongeldig", "Onbekend pakket.");
  const lines = [{ kind: "pakket", key: pkg, name: `Pakket ${b.name}`, price_eur: b.price_eur, note: b.pitch }];
  for (const o of options) {
    const opt = OPT[typeof o === "string" ? o : o.id];
    if (!opt) continue;
    const qty = typeof o === "object" && o.qty ? Math.max(1, Math.min(12, Number(o.qty))) : 1;
    lines.push({ kind: "optie", key: opt.id, name: opt.name + (qty > 1 ? ` × ${qty}` : ""), price_eur: opt.price_eur * qty, per: opt.per, note: opt.desc });
  }
  const once = lines.filter(l => !l.per).reduce((s, l) => s + l.price_eur, 0);
  const monthly = lines.filter(l => l.per === "maand").reduce((s, l) => s + l.price_eur, 0);
  return { lines, once_eur: once, monthly_eur: monthly };
}

/** Antwoord in Rayans stijl: kort, persoonlijk, je-vorm, actuele prijs, één vervolgstap. */
export function draftReply({ name, company, analysis, earliestStart }) {
  const q1 = quoteLines(analysis.package, analysis.options);
  const hi = name ? `Hoi ${String(name).split(" ")[0]},` : "Hoi,";
  const ask = analysis.missing.slice(0, 2);
  return `${hi}

Dank voor je aanvraag${company ? ` voor ${company}` : ""}! ${analysis.summary.replace(/\.$/, "")}: dat kan ik goed voor je maken.

Mijn voorstel: pakket ${BASE[analysis.package].name} (${eur(BASE[analysis.package].price_eur)})${q1.lines.length > 1 ? ` met ${q1.lines.slice(1).map(l => `${l.name.toLowerCase()} (+${eur(l.price_eur)}${l.per ? ` per ${l.per}` : ""})`).join(" en ")}` : ""}. Totaal ${eur(q1.once_eur)} eenmalig${q1.monthly_eur ? ` en ${eur(q1.monthly_eur)} per maand` : ""}.
${ask.length ? `\nZou je me nog laten weten: ${ask.join(" en ")}?\n` : ""}${earliestStart ? `\nIk kan starten vanaf ${new Date(earliestStart).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}.\n` : ""}
Zal ik de offerte voor je klaarzetten, of bel je liever even kort?

Groet,
Rayan
StrakWerk · ${SITE.brand.site}`;
}

// ── Capaciteit ───────────────────────────────────────────────────────────────
export async function capacity(db) {
  const s = await salesSettings(db);
  const active = (await (db || { query: q }).query("select count(*)::int n from hq.projects where status in ('akkoord','intake','in_aanbouw','websitecontrole') and not is_test")).rows[0].n;
  const free = Math.max(0, s.capacity.max_projects - active);
  const earliest = new Date(Date.now() + (free > 0 ? 2 : (active - s.capacity.max_projects + 1) * s.capacity.days_per_project) * 864e5);
  return { max: s.capacity.max_projects, active, free, earliest_start: earliest.toISOString().slice(0, 10), days_per_project: s.capacity.days_per_project };
}

// ── Aanvraag binnenhalen (formulier, plakken, opdracht) ─────────────────────────
function cleanUtm(v) { return typeof v === "string" && /^[a-z0-9_\-.]{1,60}$/i.test(v) ? v.toLowerCase() : null; }

/**
 * Eén aanvraag → één klantkaart. Herhaalde inzendingen (zelfde formulier-id, of hetzelfde
 * bericht binnen 10 minuten) worden niet dubbel verwerkt. Bestaande klant: zelfde kaart.
 */
export async function intakeRequest(input, actor = null) {
  const name = str(input.name, 120), company = str(input.company, 160), email = normEmail(str(input.email, 254)), phone = normPhone(str(input.phone, 40));
  const message = str(input.message, 4000) || "", type = str(input.type, 120) || "";
  const channel = ["formulier", "email", "whatsapp", "telefoon", "gesprek"].includes(input.channel) ? input.channel : "formulier";
  if (!company && !name && !email && !phone) throw new HttpError(400, "ongeldig", "Vul minimaal een naam, bedrijf, e-mail of telefoon in.");
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new HttpError(400, "ongeldig", "Ongeldig e-mailadres.");
  const isTest = Boolean(input.is_test);
  const externalId = str(input.external_id, 120) || `aanvraag:${createHash("sha256").update(`${email || phone || company}|${message}|${Math.floor(Date.now() / 600_000)}`).digest("hex").slice(0, 24)}`;
  return tx(async (db) => {
    await db.query("select pg_advisory_xact_lock(hashtext('hq_intake'))");
    const dupe = (await db.query("select i.lead_id from hq.interactions i where i.external_id=$1", [externalId])).rows[0];
    if (dupe) return { lead_id: dupe.lead_id, duplicate: true };
    const analysis = analyzeNeed({ message, type, company });
    const website = str(input.website, 300);
    const domain = normalizeDomain(website);
    // Bestaande klantkaart zoeken: e-mail, telefoon, domein of bedrijfsnaam.
    let lead = (await db.query(`select * from hq.leads where (lower(contact_email)=$1 and $1 is not null) or (contact_phone=$2 and $2 is not null) or (domain=$3 and $3 is not null)
       or (company_key=$4 and $4 <> '') order by created_at limit 1`, [email, phone, domain, company ? companyKey(company) : ""])).rows[0];
    const src = { kanaal: channel, utm: { source: cleanUtm(input.utm?.source), medium: cleanUtm(input.utm?.medium), campaign: cleanUtm(input.utm?.campaign) }, pagina: str(input.page, 200), ref: str(input.ref, 40) };
    const sourceKey = channel === "email" ? "aanvraag_email" : channel === "telefoon" ? "aanvraag_telefoon" : channel === "whatsapp" ? "aanvraag_whatsapp" : "aanvraag_anders";
    if (!lead) {
      lead = (await db.query(`insert into hq.leads (company, company_key, website, domain, source, contact_name, contact_email, contact_phone, status, segment, need_summary, missing_info, source_detail, awaiting_reply_since, last_inbound_at, is_test, created_by)
        values ($1,$2,$3,$4,$5,$6,$7,$8,'aanvraag',$9,$10,$11,$12,now(),now(),$13,$14) returning *`,
        [company || name || email || phone, companyKey(company || name || email || phone), website, domain, sourceKey, name, email, phone, analysis.segment, analysis.summary, JSON.stringify(analysis.missing), src, isTest, actor?.userId || null])).rows[0];
      await db.query("insert into hq.lead_history (lead_id, actor, actor_label, to_status, note) values ($1,$2,$3,'aanvraag','Aanvraag ontvangen')", [lead.id, actor?.userId || null, actor?.email || channel]);
    } else {
      const ahead = ["offerte", "gewonnen"].includes(lead.status);
      lead = (await db.query(`update hq.leads set contact_name=coalesce(contact_name,$2), contact_email=coalesce(contact_email,$3), contact_phone=coalesce(contact_phone,$4),
          status=case when $5 then status else 'aanvraag' end, source=case when source like 'aanvraag_%' then source else $6 end, need_summary=$7, missing_info=$8, segment=coalesce(segment,$9),
          awaiting_reply_since=coalesce(awaiting_reply_since, now()), last_inbound_at=now(), source_detail=source_detail || $10, updated_at=now() where id=$1 returning *`,
        [lead.id, name, email, phone, ahead || lead.status === "afgemeld", sourceKey, analysis.summary, JSON.stringify(analysis.missing), analysis.segment, src])).rows[0];
    }
    await db.query(`insert into hq.interactions (lead_id, direction, channel, kind, classification, subject, body, summary, external_id, is_test, created_by, created_label)
      values ($1,'in',$2,'aanvraag','interesse',$3,$4,$5,$6,$7,$8,$9)`, [lead.id, channel, type || "Aanvraag", message, analysis.summary, externalId, isTest, actor?.userId || null, actor?.email || channel]);
    // Zelf contact gezocht: contactgrond om te antwoorden (alleen voor deze aanvraag).
    for (const ch of [email ? "email" : null, phone ? "whatsapp" : null].filter(Boolean)) {
      const has = (await db.query("select 1 from hq.consents where lead_id=$1 and channel=$2 and basis='zelf_contact_gezocht' and revoked_at is null", [lead.id, ch])).rows[0];
      if (!has) await recordConsent(lead.id, { channel: ch, basis: "zelf_contact_gezocht", source: `Aanvraag via ${channel}${src.pagina ? ` (${src.pagina})` : ""}`, scope: "Reageren op deze aanvraag en de offerte opvolgen", evidence: `Ondernemer stuurde zelf een aanvraag op ${new Date().toLocaleDateString("nl-NL")}.` }, null, db);
    }
    // Herkomst: campagnelink, WhatsApp-zoekwoord, doorverwijzing. Onbekend blijft onbekend.
    let attribution = null;
    if (src.utm.campaign) {
      const p = (await db.query("select id from hq.content_pieces where campaign_code=$1", [src.utm.campaign])).rows[0];
      if (p) attribution = { piece: p.id, via: "link", hoe: `utm_campaign=${src.utm.campaign} in de aanvraag` };
    }
    if (!attribution) {
      const kw = (await db.query("select id, keyword from hq.content_pieces where keyword is not null and $1 ~* ('\\m' || keyword || '\\M') order by created_at desc limit 1", [message])).rows[0];
      if (kw) attribution = { piece: kw.id, via: "whatsapp_woord", hoe: `zoekwoord ${kw.keyword} in het bericht` };
    }
    if (attribution && !lead.campaign_piece_id) await db.query("update hq.leads set campaign_piece_id=$2, campaign_via=$3, source_detail=source_detail || $4 where id=$1", [lead.id, attribution.piece, attribution.via, { herkomst: attribution.hoe }]);
    if (src.ref) {
      const partner = (await db.query("select id from hq.partners where ref_code=$1", [src.ref])).rows[0];
      const refLead = !partner ? (await db.query("select id from hq.leads where substr(id::text,1,8)=$1", [src.ref])).rows[0] : null;
      if (partner) await db.query("update hq.leads set referral_partner_id=$2, source_detail=source_detail || $3 where id=$1", [lead.id, partner.id, { verwijzing: `ref=${src.ref} (partner)` }]);
      if (refLead && refLead.id !== lead.id) await db.query("update hq.leads set referral_lead_id=$2, source_detail=source_detail || $3 where id=$1", [lead.id, refLead.id, { verwijzing: `ref=${src.ref} (klant)` }]);
    }
    // De klant zocht zelf contact: koude acquisitie voor deze klant stopt.
    await db.query("update hq.outreach set status='geannuleerd', cancel_reason='Klant stuurde zelf een aanvraag', updated_at=now() where lead_id=$1 and kind in ('eerste_contact','opvolging') and status in ('concept','gepland','klaar_handmatig')", [lead.id]);
    if (analysis.qualified && !lead.qualified_at) {
      await db.query("update hq.leads set qualified_at=now(), qualification=$2 where id=$1", [lead.id, analysis.qualification]);
      if (["aanvraag", "nieuw"].includes(lead.status)) await db.query("update hq.leads set status='gekwalificeerd' where id=$1 and status='aanvraag'", [lead.id]);
    }
    const cap = await capacity(db);
    const reply = draftReply({ name, company, analysis, earliestStart: cap.earliest_start });
    await db.query(`insert into hq.outreach (lead_id, channel, kind, status, subject, body, to_address, idempotency_key, is_test)
      values ($1,$2,'antwoord','concept',$3,$4,$5,$6,$7) on conflict (idempotency_key) do nothing`,
      [lead.id, email ? "email" : "whatsapp", `Je aanvraag bij StrakWerk${company ? ` (${company})` : ""}`, reply, email || phone, `antwoord:${externalId}`, isTest]);
    await audit(db, { actor: actor?.userId || null, label: actor?.email || "systeem", action: "aanvraag.ontvangen", entity: "lead", entityId: lead.id, details: { kanaal: channel, test: isTest } });
    return { lead_id: lead.id, duplicate: false, analysis, attribution, capacity: cap };
  });
}

// ── Reacties ───────────────────────────────────────────────────────────────────
export function classify(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(afmelden|uitschrijven|unsubscribe|geen berichten meer|stop met mailen|niet meer mailen)\b/.test(t)) return "afmelding";
  if (/\b(geen interesse|niet geïnteresseerd|nee bedankt|niet nodig|heb al een)\b/.test(t)) return "afwijzing";
  if (/\b(later|volgend jaar|na de zomer|over een (paar )?maand|nu even niet|kom ik op terug)\b/.test(t)) return "later";
  if (/\b(ja|graag|leuk|interesse|laat (maar )?zien|akkoord|doen|wanneer kun|kunnen we bellen|afspraak)\b/.test(t)) return "interesse";
  if (/\?|wat kost|hoeveel|prijs/.test(t)) return "vraag";
  return "onbekend";
}

/**
 * Binnenkomende reactie: koppelen aan het juiste gesprek, geplande standaardopvolging
 * stoppen, status bijwerken en de eerstvolgende actie klaarzetten.
 */
export async function registerReply({ lead_id, text, channel = "email", external_id = null, subject = null, in_reply_to = null, from = null, is_test = false }, actor = null) {
  return tx(async (db) => {
    let lead = lead_id ? (await db.query("select * from hq.leads where id=$1 for update", [lead_id])).rows[0] : null;
    let outreach = null;
    if (in_reply_to) outreach = (await db.query("select * from hq.outreach where provider_id=$1", [in_reply_to])).rows[0] || null;
    if (!lead && outreach) lead = (await db.query("select * from hq.leads where id=$1 for update", [outreach.lead_id])).rows[0];
    if (!lead && from) lead = (await db.query("select * from hq.leads where lower(contact_email)=$1 order by updated_at desc limit 1 for update", [normEmail(from)])).rows[0];
    if (!lead) throw new HttpError(404, "niet_gevonden", "Geen klantkaart gevonden voor deze reactie.");
    if (external_id && (await db.query("select 1 from hq.interactions where external_id=$1", [external_id])).rows[0]) return { lead_id: lead.id, duplicate: true };
    const bounce = /mailer-daemon|postmaster|undeliverable|delivery status notification|niet afgeleverd|onbestelbaar/i.test(`${from || ""} ${subject || ""}`);
    const cls = bounce ? "afmelding" : classify(text);
    const kind = bounce ? "bounce" : cls === "afmelding" ? "afmelding" : "antwoord";
    const quote = outreach?.quote_id ? { id: outreach.quote_id } : (await db.query("select id from hq.quotes where lead_id=$1 and status in ('verstuurd','concept') order by created_at desc limit 1", [lead.id])).rows[0];
    await db.query(`insert into hq.interactions (lead_id, direction, channel, kind, classification, subject, body, external_id, outreach_id, quote_id, is_test, created_by, created_label)
      values ($1,'in',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [lead.id, channel, kind, bounce ? null : cls, subject, String(text || "").slice(0, 8000), external_id, outreach?.id || null, quote?.id || null, is_test || lead.is_test, actor?.userId || null, actor?.email || channel]);
    // Iemand reageert: geplande standaardopvolging vervalt (wordt vlak voor verzenden ook nog gecontroleerd).
    const cancelled = (await db.query(`update hq.outreach set status='geannuleerd', cancel_reason=$2, updated_at=now()
        where lead_id=$1 and kind in ('opvolging','offerte_opvolging','eerste_contact') and status in ('concept','gepland','klaar_handmatig') returning id`, [lead.id, `Klant reageerde (${cls})`])).rowCount;
    const out = { lead_id: lead.id, classification: cls, kind, cancelled_followups: cancelled };
    if (bounce) {
      await suppress({ lead, reason: "bounce", note: subject, kind: "email" }, db);
    } else if (cls === "afmelding") {
      await suppress({ lead, reason: "afmelding", note: "Afgemeld via reactie" }, db);
      await db.query("update hq.leads set status='afgemeld', awaiting_reply_since=null, updated_at=now() where id=$1", [lead.id]);
      await db.query("insert into hq.lead_history (lead_id, actor_label, from_status, to_status, note) values ($1,'systeem',$2,'afgemeld','Afgemeld: alle afdelingen stoppen met contact')", [lead.id, lead.status]);
    } else if (cls === "afwijzing") {
      await db.query("update hq.leads set awaiting_reply_since=null, last_inbound_at=now(), status=case when status in ('gewonnen') then status else 'verloren' end, lost_reason=coalesce(lost_reason,'Geen interesse (reactie)'), updated_at=now() where id=$1", [lead.id]);
    } else if (cls === "later") {
      await db.query("update hq.leads set awaiting_reply_since=null, last_inbound_at=now(), next_action_at=(now() + interval '30 days')::date, updated_at=now() where id=$1", [lead.id]);
    } else {
      // Interesse of vraag: de klant wacht op ons; krijgt voorrang op nieuw koud onderzoek.
      await db.query("update hq.leads set awaiting_reply_since=coalesce(awaiting_reply_since, now()), last_inbound_at=now(), priority='hoog', priority_reason='Klant reageerde en wacht op antwoord', status=case when status in ('benaderd','nieuw','onderzocht','goedgekeurd') then 'gesprek' else status end, updated_at=now() where id=$1", [lead.id]);
      if (quote?.id && cls === "interesse") await db.query("update hq.quotes set interest=true where id=$1", [quote.id]);
    }
    await audit(db, { actor: actor?.userId || null, label: actor?.email || "systeem", action: "reactie.ontvangen", entity: "lead", entityId: lead.id, details: { classificatie: cls, opvolging_gestopt: cancelled } });
    return out;
  });
}

// ── Offertes ─────────────────────────────────────────────────────────────────
/**
 * Offerteconcept uit de actuele pakketten en opties (CONFIG). Extra wensen of afwijkende
 * prijzen staan apart en moeten eerst door Rayan worden beoordeeld.
 */
export async function prepareQuote(leadId, body = {}, actor = null) {
  assertUuid(leadId, "klant");
  return tx(async (db) => {
    const lead = (await db.query("select * from hq.leads where id=$1 for update", [leadId])).rows[0];
    if (!lead) throw new HttpError(404, "niet_gevonden", "Klant niet gevonden.");
    const last = (await db.query("select body, subject from hq.interactions where lead_id=$1 and kind='aanvraag' order by at desc limit 1", [leadId])).rows[0];
    const analysis = analyzeNeed({ message: last?.body || lead.need_summary || "", type: last?.subject || "", company: lead.company });
    const pkg = BASE[body.package] ? body.package : analysis.package;
    const options = Array.isArray(body.options) ? body.options.filter(o => OPT[o.id || o]) : analysis.options;
    const extras = (Array.isArray(body.extras) ? body.extras : []).map(e => ({ omschrijving: str(e.omschrijving || e.description, 200), prijs_eur: Number(e.prijs_eur ?? e.price_eur) })).filter(e => e.omschrijving && Number.isFinite(e.prijs_eur));
    const origin = body.origin_key || `offerte:${leadId}:${pkg}:${options.map(o => o.id || o).sort().join(",")}:${extras.length}`;
    const ex = (await db.query("select id from hq.quotes where origin_key=$1", [origin])).rows[0];
    if (ex) return { id: ex.id, duplicate: true };
    const pk = (await db.query("select * from hq.packages where key=$1 and active", [pkg])).rows[0];
    if (!pk) throw new HttpError(400, "ongeldig", "Pakket niet actief.");
    if (Math.round(pk.price_cents / 100) !== BASE[pkg].price_eur) throw new HttpError(409, "prijs_afwijkend", `Prijs van ${pk.name} in HQ wijkt af van de website. Zet ze eerst gelijk.`);
    const ql = quoteLines(pkg, options);
    const cap = await capacity(db);
    const extraSum = extras.reduce((s, e) => s + e.prijs_eur, 0);
    const description = `${analysis.summary} Pakket ${BASE[pkg].name}: ${BASE[pkg].pitch}.${ql.lines.length > 1 ? ` Inclusief ${ql.lines.slice(1).map(l => l.name.toLowerCase()).join(", ")}.` : ""}`;
    const info = analysis.missing.length ? analysis.missing : ["teksten en beelden (via de intake-link na akkoord)"];
    const next = "Akkoord geven op deze offerte; daarna ontvang je een persoonlijke intake-link voor logo, beelden en teksten.";
    const r = (await db.query(`insert into hq.quotes (lead_id, package_key, price_cents, terms, status, note, created_by, description, items, extras, info_needed, next_step, earliest_start, is_test, origin_key)
      values ($1,$2,$3,$4,'concept',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
      [leadId, pkg, (ql.once_eur + extraSum) * 100, pk.terms || "", extras.length ? "Bevat extra wensen buiten de prijslijst: eerst beoordelen." : "", actor?.userId || null,
       description, JSON.stringify(ql.lines), JSON.stringify(extras), JSON.stringify(info), next, cap.earliest_start, lead.is_test, origin])).rows[0];
    await db.query("update hq.leads set status=case when status in ('aanvraag','gekwalificeerd','gesprek','afspraak','nieuw','benaderd') then 'offerte' else status end, updated_at=now() where id=$1", [leadId]);
    await audit(db, { actor: actor?.userId || null, label: actor?.email || "systeem", action: "offerte.concept", entity: "quote", entityId: r.id, details: { pakket: pkg, totaal: ql.once_eur + extraSum } });
    return { id: r.id, duplicate: false, quote: r, needs_review: extras.length > 0 || !pk.terms, monthly_eur: ql.monthly_eur };
  });
}

/** Offerte versturen (eigenaar). Plant opvolging volgens de instellingen. */
export async function sendQuote(quoteId, body = {}, auth) {
  assertUuid(quoteId, "offerte");
  return tx(async (db) => {
    const qu = (await db.query("select * from hq.quotes where id=$1 for update", [quoteId])).rows[0];
    if (!qu) throw new HttpError(404, "niet_gevonden", "Offerte niet gevonden.");
    if (qu.status !== "concept") return { status: qu.status, duplicate: true };
    if ((qu.extras || []).length && !body.extras_approved) throw new HttpError(409, "beoordelen", "Deze offerte bevat extra wensen of afwijkende prijzen. Bevestig dat je ze hebt beoordeeld.");
    if (!qu.terms && !body.terms_ok) throw new HttpError(409, "geen_voorwaarden", "Vul eerst de voorwaarden van dit pakket in (Instellingen › Pakketten), of bevestig dat je ze apart meestuurt.");
    await db.query("update hq.quotes set status='verstuurd', sent_at=now(), interest=coalesce($2, interest) where id=$1", [quoteId, body.interest ?? null]);
    await db.query("update hq.leads set status=case when status in ('gewonnen','afgemeld') then status else 'offerte' end, awaiting_reply_since=null, last_outbound_at=now(), updated_at=now() where id=$1", [qu.lead_id]);
    await db.query("insert into hq.interactions (lead_id, direction, channel, kind, subject, body, quote_id, is_test, created_by, created_label) values ($1,'uit',$2,'bericht','Offerte verstuurd',$3,$4,$5,$6,$7)",
      [qu.lead_id, body.channel || "email", `Offerte ${qu.package_key} · €${qu.price_cents / 100}`, quoteId, qu.is_test, auth?.userId || null, auth?.email || "systeem"]);
    const planned = await scheduleQuoteFollowups(db, { ...qu, interest: body.interest ?? qu.interest });
    await audit(db, { actor: auth?.userId || null, label: auth?.email || "systeem", action: "offerte.verstuurd", entity: "quote", entityId: quoteId });
    return { status: "verstuurd", followups: planned };
  });
}

export async function scheduleQuoteFollowups(db, quote) {
  const s = (await salesSettings(db)).followup;
  if (!s.enabled || (s.only_with_interest && !quote.interest)) return 0;
  const lead = (await db.query("select * from hq.leads where id=$1", [quote.lead_id])).rows[0];
  const ch = lead.contact_email ? "email" : "whatsapp";
  let n = 0;
  for (let i = 0; i < Math.min(s.max, 2, s.days.length); i++) {
    const at = new Date(Date.now() + s.days[i] * 864e5);
    const body = i === 0
      ? `Hoi${lead.contact_name ? ` ${lead.contact_name.split(" ")[0]}` : ""},\n\nIk wilde even checken of je de offerte goed hebt ontvangen. Heb je nog vragen, of zal ik iets aanpassen?\n\nGroet,\nRayan\nStrakWerk`
      : `Hoi${lead.contact_name ? ` ${lead.contact_name.split(" ")[0]}` : ""},\n\nZal ik de offerte nog even voor je openhouden? Laat gerust weten als het nu niet uitkomt, dan stop ik met opvolgen.\n\nGroet,\nRayan\nStrakWerk`;
    const r = await db.query(`insert into hq.outreach (lead_id, quote_id, channel, kind, sequence, status, subject, body, to_address, scheduled_at, idempotency_key, is_test)
      values ($1,$2,$3,'offerte_opvolging',$4,'gepland',$5,$6,$7,$8,$9,$10) on conflict (idempotency_key) do nothing`,
      [lead.id, quote.id, ch, i + 1, "Je offerte van StrakWerk", body, lead.contact_email || lead.contact_phone, at, `offerte_opvolging:${quote.id}:${i + 1}`, quote.is_test]);
    n += r.rowCount;
  }
  return n;
}

export async function markInterest(quoteId, auth) {
  assertUuid(quoteId);
  return tx(async (db) => {
    const qu = (await db.query("update hq.quotes set interest=true where id=$1 returning *", [quoteId])).rows[0];
    if (!qu) throw new HttpError(404, "niet_gevonden", "Offerte niet gevonden.");
    const n = qu.status === "verstuurd" ? await scheduleQuoteFollowups(db, qu) : 0;
    await audit(db, { actor: auth.userId, label: auth.email, action: "offerte.belangstelling", entity: "quote", entityId: quoteId });
    return { followups: n };
  });
}

/** Akkoord: offerte geaccepteerd → project met afgesproken inhoud, prijs en intake-link. */
export async function acceptQuote(quoteId, auth) {
  assertUuid(quoteId);
  return tx(async (db) => {
    const qu = (await db.query("select * from hq.quotes where id=$1 for update", [quoteId])).rows[0];
    if (!qu) throw new HttpError(404, "niet_gevonden", "Offerte niet gevonden.");
    if (!["verstuurd", "geaccepteerd"].includes(qu.status)) throw new HttpError(409, "ongeldige_overgang", "Alleen een verstuurde offerte kan akkoord krijgen.");
    if (qu.status !== "geaccepteerd") {
      await db.query("update hq.quotes set status='geaccepteerd', decided_at=now(), accepted_at=now() where id=$1", [quoteId]);
      await db.query("update hq.leads set status='gewonnen', awaiting_reply_since=null, updated_at=now() where id=$1 and status<>'gewonnen'", [qu.lead_id]);
      await db.query("insert into hq.lead_history (lead_id, actor, actor_label, to_status, note) values ($1,$2,$3,'gewonnen','Offerte geaccepteerd')", [qu.lead_id, auth?.userId || null, auth?.email || "systeem"]);
      // Opvolging van deze offerte is niet meer nodig.
      await db.query("update hq.outreach set status='geannuleerd', cancel_reason='Offerte geaccepteerd', updated_at=now() where quote_id=$1 and status in ('concept','gepland','klaar_handmatig')", [quoteId]);
    }
    const pid = await projectFromQuote(db, qu.lead_id, auth) || (await db.query("select id from hq.projects where lead_id=$1", [qu.lead_id])).rows[0]?.id;
    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 16);
    const p = (await db.query(`update hq.projects set quote_id=coalesce(quote_id,$2), price_cents=coalesce(price_cents,$3), scope=case when scope='{}'::jsonb then $4 else scope end,
        intake_token_hash=coalesce(intake_token_hash,$5), status=case when status='akkoord' then 'intake' else status end, is_test=$6, updated_at=now() where id=$1 returning *`,
      [pid, quoteId, qu.price_cents, { omschrijving: qu.description, onderdelen: qu.items, extra: qu.extras, start_vanaf: qu.earliest_start }, createHash("sha256").update(token).digest("hex"), qu.is_test])).rows[0];
    // Token alleen teruggeven als het net is aangemaakt (daarna niet meer op te vragen; opnieuw maken kan).
    const fresh = p.intake_token_hash === createHash("sha256").update(token).digest("hex");
    await audit(db, { actor: auth?.userId || null, label: auth?.email || "systeem", action: "offerte.akkoord", entity: "quote", entityId: quoteId, details: { project: pid } });
    return { project_id: pid, intake_url: fresh ? `/intake?t=${token}` : null };
  });
}

/** Betaling vastleggen: echt (handmatig/bank) of gesimuleerd (alleen testomgeving). */
export async function registerPayment(leadId, body, auth) {
  assertUuid(leadId, "klant");
  const cents = Math.round(Number(body.amount_eur) * 100);
  if (!Number.isFinite(cents) || cents <= 0) throw new HttpError(400, "ongeldig", "Ongeldig bedrag.");
  const lead = await one("select is_test from hq.leads where id=$1", [leadId]);
  if (!lead) throw new HttpError(404, "niet_gevonden", "Klant niet gevonden.");
  const sim = body.method === "simulatie";
  if (sim && !lead.is_test) throw new HttpError(409, "ongeldig", "Een gesimuleerde betaling kan alleen bij testgegevens.");
  const p = await one(`insert into hq.payments (lead_id, quote_id, amount_cents, received_on, note, created_by, is_test, method) values ($1,$2,$3,coalesce($4::date, current_date),$5,$6,$7,$8) returning *`,
    [leadId, body.quote_id || null, cents, /^\d{4}-\d{2}-\d{2}$/.test(body.received_on || "") ? body.received_on : null, str(body.note, 200) || (sim ? "TEST: gesimuleerde betaling" : ""), auth?.userId || null, lead.is_test || sim, sim ? "simulatie" : body.method === "bank" ? "bank" : "handmatig"]);
  await audit(null, { actor: auth?.userId || null, label: auth?.email || "systeem", action: "betaling.vastgelegd", entity: "payment", entityId: p.id, details: { bedrag: cents, test: p.is_test } });
  return p;
}

// ── Afspraken ──────────────────────────────────────────────────────────────────
export async function availability(db) {
  const r = (await (db || { query: q }).query("select value from hq.settings where key='availability'")).rows[0]?.value || {};
  return { weekdays: [1, 2, 3, 4, 5], from: "09:00", to: "17:00", slot_min: 30, quiet_from: "21:00", quiet_to: "08:00", ...r };
}

export async function freeSlots({ days = 7, from = new Date() } = {}) {
  const a = await availability();
  const booked = (await q("select starts_at, ends_at from hq.appointments where status='gepland' and starts_at > now() - interval '1 day'")).rows;
  const [fh, fm] = a.from.split(":").map(Number), [th, tm] = a.to.split(":").map(Number);
  const out = [];
  for (let d = 0; d < days && out.length < 40; d++) {
    const p = amsParts(new Date(from.getTime() + d * 864e5));
    if (!a.weekdays.includes(p.wd)) continue;
    for (let m = fh * 60 + fm; m + a.slot_min <= th * 60 + tm; m += a.slot_min) {
      const s = amsToUtc(p.y, p.m, p.d, Math.floor(m / 60), m % 60), e = new Date(s.getTime() + a.slot_min * 60_000);
      if (s < new Date(Date.now() + 60 * 60_000)) continue;
      if (booked.some(b => s < new Date(b.ends_at) && e > new Date(b.starts_at))) continue;
      out.push({ starts_at: s.toISOString(), ends_at: e.toISOString() });
    }
  }
  return out;
}

/** Afspraak vastleggen; beschikbaarheid wordt op het moment van vastleggen opnieuw gecontroleerd. */
export async function book(leadId, body, auth) {
  assertUuid(leadId, "klant");
  const s = new Date(body.starts_at);
  if (Number.isNaN(s.getTime())) throw new HttpError(400, "ongeldig", "Ongeldig tijdstip.");
  const a = await availability();
  const e = new Date(s.getTime() + a.slot_min * 60_000);
  return tx(async (db) => {
    await db.query("select pg_advisory_xact_lock(hashtext('hq_agenda'))");
    const clash = (await db.query("select id from hq.appointments where status='gepland' and starts_at < $2 and ends_at > $1", [s, e])).rows[0];
    if (clash) throw new HttpError(409, "bezet", "Dit tijdstip is net bezet. Kies een ander moment.");
    const lead = (await db.query("select is_test from hq.leads where id=$1", [leadId])).rows[0];
    const r = (await db.query("insert into hq.appointments (lead_id, quote_id, starts_at, ends_at, kind, note, is_test, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *",
      [leadId, body.quote_id || null, s, e, ["kennismaking", "intake", "oplevering", "nazorg"].includes(body.kind) ? body.kind : "kennismaking", str(body.note, 300) || "", lead?.is_test || false, auth?.userId || null])).rows[0];
    await db.query("update hq.leads set status=case when status in ('aanvraag','gekwalificeerd','gesprek','nieuw','benaderd') then 'afspraak' else status end, awaiting_reply_since=null, updated_at=now() where id=$1", [leadId]);
    await db.query("insert into hq.interactions (lead_id, direction, channel, kind, body, is_test, created_by, created_label) values ($1,'intern','systeem','afspraak',$2,$3,$4,$5)",
      [leadId, `Afspraak ${r.kind} op ${s.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "medium", timeStyle: "short" })}`, r.is_test, auth?.userId || null, auth?.email || "systeem"]);
    return r;
  });
}

/** Antwoord gemarkeerd als verstuurd (handmatig via WhatsApp/mail): klant wacht niet meer. */
export async function markAnswered(leadId, body, auth) {
  assertUuid(leadId);
  return tx(async (db) => {
    const o = body.outreach_id ? (await db.query("update hq.outreach set status='handmatig_verzonden', sent_at=now(), updated_at=now() where id=$1 and lead_id=$2 and status in ('concept','klaar_handmatig') returning *", [body.outreach_id, leadId])).rows[0] : null;
    await db.query("update hq.leads set awaiting_reply_since=null, last_outbound_at=now(), updated_at=now() where id=$1", [leadId]);
    await db.query("insert into hq.interactions (lead_id, direction, channel, kind, body, outreach_id, created_by, created_label) values ($1,'uit',$2,'bericht',$3,$4,$5,$6)",
      [leadId, o?.channel || body.channel || "whatsapp", o?.body || str(body.text, 4000) || "Beantwoord", o?.id || null, auth?.userId || null, auth?.email || "systeem"]);
    await db.query("update hq.actions set status='klaar', done_at=now(), result='Beantwoord' where lead_id=$1 and status in ('open','opgepakt') and source_key like 'antwoord:%'", [leadId]);
    return { ok: true };
  });
}

/** Klantkaart: één overzicht met commerciële opvolging en projectvoortgang apart. */
export async function customerCard(leadId) {
  assertUuid(leadId, "klant");
  const lead = await one("select * from hq.leads where id=$1", [leadId]);
  if (!lead) throw new HttpError(404, "niet_gevonden", "Klant niet gevonden.");
  const [timeline, consents, outreach, quotes, appts, project, opps, payments, sup, actions] = await Promise.all([
    q("select * from hq.interactions where lead_id=$1 order by at desc limit 100", [leadId]),
    q("select * from hq.consents where lead_id=$1 order by recorded_at desc", [leadId]),
    q("select * from hq.outreach where lead_id=$1 order by created_at desc limit 50", [leadId]),
    q("select * from hq.quotes where lead_id=$1 order by created_at desc", [leadId]),
    q("select * from hq.appointments where lead_id=$1 order by starts_at desc", [leadId]),
    one("select id, name, status, intake, intake_complete_at, briefing_at, price_cents, is_test from hq.projects where lead_id=$1", [leadId]),
    q("select * from hq.opportunities where lead_id=$1 order by created_at desc", [leadId]),
    q("select * from hq.payments where lead_id=$1 order by received_on desc", [leadId]),
    (await import("./contact.js")).suppressedFor(lead),
    q("select * from hq.actions where lead_id=$1 and status in ('open','opgepakt') order by day desc, rank", [leadId]),
  ]);
  const email = await contactCheck(lead, "email", { kind: "eerste_contact" });
  return { lead, timeline: timeline.rows, consents: consents.rows, outreach: outreach.rows, quotes: quotes.rows, appointments: appts.rows, project, opportunities: opps.rows, payments: payments.rows,
    suppressed: sup, actions: actions.rows, contact: { email }, capacity: await capacity(),
    wa_link: lead.contact_phone ? `https://wa.me/${String(lead.contact_phone).replace(/\D/g, "")}` : null };
}
