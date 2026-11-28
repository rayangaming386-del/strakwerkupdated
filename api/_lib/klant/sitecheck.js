// GRATIS WEBSITECHECK (leadmagneet op /websitecheck). Een ondernemer vult zijn webadres in en
// ziet direct wat goed gaat en wat beter kan op een telefoon, met het passende pakket uit de
// prijslijst (CONFIG). Daarna kan hij zijn gegevens achterlaten, alleen met een vinkje dat Rayan
// contact mag opnemen; dan komt er een warme aanvraag binnen (verkoopkanaal "websitecheck").
// Regels:
// - alleen publieke GET-verzoeken via de veilige fetcher (geen privé-adressen, robots.txt,
//   tijd- en groottelimieten); geen formulieren, geen scans;
// - alleen gemeten feiten; een AI-samenvatting (goedkoopste model, eigen budgetpost) gaat door
//   de claimcontrole en valt anders terug op een vaste tekst;
// - geen account en geen cookies: de uitslag staat achter een geheime link (alleen de hash
//   wordt bewaard); zonder achtergelaten gegevens na 90 dagen verwijderd;
// - tegen misbruik: dagmaximum (instelling checks_per_day), maximaal 5 per bezoeker per dag
//   (wisselende hash, geen IP-adres), honeypot, herkomstcontrole, en een recente uitslag van
//   hetzelfde domein wordt hergebruikt (geen nieuwe meting, geen AI-kosten).
import { createHash, randomBytes } from "node:crypto";
import { q, one, tx } from "../db.js";
import { HttpError, str } from "../http.js";
import { normalizeUrl, FetchError } from "../agents/fetcher.js";
import { salesCheck, saveObservations } from "./salescheck.js";
import { SITE } from "../content/studio.js";
import { salesAiSettings } from "../budget.js";
import { structured, llmConfigured, refreshAi, aiContext } from "../agents/llm.js";
import { safeText } from "./claims.js";
import { intakeRequest } from "./sales.js";
import { recordConsent, normEmail, normPhone } from "./contact.js";
import { waitUntil, isWorkers } from "../runtime.js";

const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const secret = () => process.env.HQ_ENCRYPTION_KEY || process.env.CRON_SECRET || "strakwerk-websitecheck";
// Per dag wisselend en niet terug te rekenen naar een IP-adres; na 2 dagen gewist (retention.js).
const visitorHash = (ip) => sha(`${ip}|${new Date().toISOString().slice(0, 10)}|${secret()}|websitecheck`).slice(0, 32);
const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;
const sec = (ms) => (ms / 1000).toFixed(1).replace(".", ",");
const took = (ms) => (ms < 1000 ? "in minder dan een seconde" : `in ${sec(ms)} seconden`);
// Volgorde van belang voor "het belangrijkste verbeterpunt".
const PRIORITY = ["bereikbaar", "links", "mobiel", "contact", "https", "google", "kop", "afbeeldingen"];
const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
export const MAX_PER_VISITOR = 5;

function friendlyError(e) {
  const m = String(e?.message || e || "");
  if (e instanceof FetchError) return m;
  return "De check kon niet worden uitgevoerd. Probeer het later nog eens, of stuur je adres via WhatsApp.";
}

/** Start een check (openbaar). Geeft het geheime token terug; de meting loopt op de achtergrond. */
export async function startCheck({ url, ip = null, isTest = false }) {
  let u;
  try { u = normalizeUrl(str(url, 300)); } catch (e) { throw new HttpError(400, "ongeldig", e instanceof FetchError ? e.message : "Ongeldig webadres."); }
  const domain = u.hostname.replace(/^www\./, "").toLowerCase();
  const s = await salesAiSettings();
  const vh = ip ? visitorHash(ip) : null;
  const n = await one(`select count(*) filter (where created_at > now() - interval '24 hours')::int as dag,
      count(*) filter (where $1::text is not null and ip_hash=$1 and created_at > now() - interval '24 hours')::int as bezoeker from hq.site_checks`, [vh]);
  if (n.bezoeker >= MAX_PER_VISITOR) throw new HttpError(429, "limiet", "Je hebt vandaag al een paar checks gedaan. Stuur je adres gerust via WhatsApp, dan kijk ik zelf mee.");
  if (n.dag >= s.checks_per_day) throw new HttpError(429, "vol", "De gratis check is vandaag even vol. Stuur je adres via WhatsApp, dan kijk ik zelf mee.");
  const token = randomBytes(24).toString("base64url");
  // Recente uitslag van hetzelfde domein: hergebruiken (geen nieuwe meting of AI-kosten).
  const recent = await one("select result, advice, advice_by from hq.site_checks where domain=$1 and status='klaar' and finished_at > now() - interval '6 hours' and is_test=$2 order by finished_at desc limit 1", [domain, isTest]);
  const row = (await q(`insert into hq.site_checks (url, domain, token_hash, status, result, advice, advice_by, ip_hash, is_test, finished_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [u.toString(), domain, sha(token), recent ? "klaar" : "bezig", recent?.result || null, recent?.advice || null, recent?.advice_by || null, vh, isTest, recent ? new Date() : null])).rows[0];
  if (!recent) waitUntil(runCheck(row.id));
  return { token, status: recent ? "klaar" : "bezig", reused: Boolean(recent) };
}

/** De meting zelf (binnen de tijd die de host na het antwoord toestaat). */
export async function runCheck(id) {
  const c = await one("select * from hq.site_checks where id=$1", [id]);
  if (!c || c.status !== "bezig") return;
  const hard = Date.now() + (isWorkers ? 26_000 : 45_000);
  try {
    const r = await salesCheck(c.url, { deadline: hard - 8000 });
    const result = buildResult(c.url, r);
    const advice = buildAdvice(result);
    const ai = await aiSummary(result, hard).catch(() => null);
    if (ai) { advice.summary = ai; advice.summary_by = "Claude"; }
    await q("update hq.site_checks set status='klaar', result=$2, advice=$3, advice_by=$4, finished_at=now() where id=$1 and status='bezig'", [id, result, advice, advice.summary_by]);
  } catch (e) {
    if (!(e instanceof FetchError)) console.error(`[websitecheck] ${e.message}`);
    await q("update hq.site_checks set status='mislukt', error=$2, finished_at=now() where id=$1 and status='bezig'", [id, friendlyError(e)]);
  }
}

/** Feiten → controles (ok: true/false; null = niet van toepassing). */
export function buildResult(url, r) {
  const at = new Date().toISOString();
  if (r.skipped) return { url, checked_at: at, skipped: "Deze website vraagt automatische bezoekers om niet mee te kijken (robots.txt). Daarom is er niets gecontroleerd.", checks: [], observations: [], tips: [] };
  const f = r.facts || {};
  const obs = r.observations || [];
  if (!f.reachable) {
    return { url, final_url: f.url, checked_at: at, reachable: false, observations: obs,
      checks: [{ key: "bereikbaar", label: "Website bereikbaar op een telefoon", ok: false, detail: obs[0]?.observation || "De homepage laadde niet." }], tips: [] };
  }
  const broken = obs.filter(o => o.strength === "concreet" && o.evidence?.link);
  const followed = f.followed || [];
  const checks = [
    { key: "bereikbaar", label: "Website bereikbaar op een telefoon", ok: true,
      detail: `De homepage (alleen de pagina zelf, zonder foto's en scripts) kwam bij deze meting ${took(f.ms)} binnen.` },
    { key: "https", label: "Beveiligde verbinding (https)", ok: Boolean(f.https),
      detail: f.https ? "Je site gebruikt een beveiligde verbinding." : "Je site draait zonder https: browsers zetten dan 'Niet veilig' naast je adres." },
    { key: "mobiel", label: "Ingesteld voor telefoons", ok: Boolean(f.viewport),
      detail: f.viewport ? "De pagina past zich aan het scherm van een telefoon aan." : "De pagina heeft geen instelling voor telefoons: hij verschijnt als een verkleinde computersite." },
    { key: "contact", label: "Direct bellen of appen vanaf de homepage", ok: f.tel > 0 || f.whatsapp,
      detail: f.tel > 0 && f.whatsapp ? "Er staat een klikbaar telefoonnummer en een WhatsApp-knop." : f.tel > 0 ? "Er staat een klikbaar telefoonnummer." : f.whatsapp ? "Er staat een WhatsApp-knop." : "Er staat geen klikbaar telefoonnummer en geen WhatsApp-knop: bezoekers moeten het nummer overtypen." },
    { key: "links", label: "Knoppen voor afspraak, prijzen en contact werken", ok: followed.length ? !broken.length : null,
      detail: broken.length ? broken.map(o => o.observation).join(" ")
        : followed.length ? `Gevolgd en in orde: ${followed.map(l => l.text ? `"${l.text}"` : l.label).join(", ")}.${f.notFollowed?.length ? ` Niet gecontroleerd (tijd op): ${f.notFollowed.join(", ")}.` : ""}`
        : "Geen knoppen voor afspraak, prijzen of contact gevonden om te volgen." },
    { key: "google", label: "Titel en omschrijving voor Google", ok: Boolean(f.title && f.description),
      detail: !f.title ? "Je homepage heeft geen titel. Die toont Google als kop in de zoekresultaten." : !f.description ? "Je homepage heeft geen omschrijving. Google maakt er dan zelf een van, uit losse stukjes tekst." : `Titel: "${String(f.title).slice(0, 90)}".` },
    { key: "kop", label: "Duidelijke hoofdkop", ok: f.h1Count >= 1,
      detail: f.h1Count >= 1 ? "De homepage heeft een hoofdkop." : "De homepage heeft geen hoofdkop (h1). Die helpt bezoekers en Google te snappen waar de pagina over gaat." },
    { key: "afbeeldingen", label: "Afbeeldingen met beschrijving", ok: f.imgCount ? f.imgNoAlt === 0 : null,
      detail: !f.imgCount ? "Geen afbeeldingen gevonden op de homepage." : f.imgNoAlt ? `${f.imgNoAlt} van de ${f.imgCount} afbeeldingen hebben geen beschrijving (alt-tekst). Die helpt Google en mensen die slecht zien.` : "Alle afbeeldingen hebben een beschrijving." },
  ];
  const tips = obs.filter(o => o.strength === "zwak").map(o => o.observation);
  if (f.ms > 3000) tips.push(`De homepage deed er bij deze meting ${sec(f.ms)} seconden over om binnen te komen. Een volledige snelheidstest doe je bij Google PageSpeed.`);
  return { url, final_url: f.url, checked_at: at, reachable: true, checks, observations: obs, tips };
}

const option = (id) => (SITE.options || []).find(o => o.id === id);
const pkg = (key, why) => ({ key, name: SITE.bases[key].name, price_eur: SITE.bases[key].price_eur, why });

/** Advies met prijzen uit de prijslijst: nooit een verzonnen bedrag. */
export function buildAdvice(result) {
  const checks = result.checks || [];
  const counted = checks.filter(c => c.ok !== null);
  const ok = counted.filter(c => c.ok).length;
  if (result.skipped) return { ok_count: 0, total: 0, summary: result.skipped, summary_by: "regels", package: null, options: [] };
  const bad = counted.filter(c => !c.ok);
  const serious = bad.filter(c => ["bereikbaar", "mobiel", "links", "contact"].includes(c.key));
  // Pakket alleen bij echte problemen; de omschrijving belooft alleen wat het pakket bevat (zie /prijzen).
  let p = null;
  if (!result.reachable || bad.some(c => c.key === "mobiel") || serious.length >= 2 || bad.length >= 3)
    p = pkg("redesign", "Je bestaande site opnieuw opgebouwd: strak, snel en gemaakt voor de telefoon. Je teksten en foto's gaan mee, je domein en e-mail blijven werken.");
  // Losse optie alleen bij een concreet kapotte afspraakroute (geen opties op basis van zwakke signalen).
  const options = [];
  const bookingBroken = (result.observations || []).some(o => o.strength === "concreet" && o.service?.key === "booking");
  const bk = option("booking");
  if (p && bookingBroken && bk && !(SITE.bases[p.key].incl || {}).booking) options.push({ id: bk.id, name: bk.name, price_eur: bk.price_eur, why: "Klanten plannen zelf een afspraak, ook buiten openingstijden, zonder kapotte link." });
  const first = [...bad].sort((a, b) => PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key))[0];
  const summary = !result.reachable ? `Je website laadde niet op een telefoon: ${lowerFirst(first?.detail || "de homepage gaf geen antwoord.")}`
    : !bad.length ? `Je website doet het goed op de punten die klanten op een telefoon direct merken.${result.tips?.length ? " Er zijn nog een paar kansen om meer aanvragen te krijgen." : ""}`
    : `Het belangrijkste verbeterpunt: ${lowerFirst(first.detail)}${bad.length > 1 ? " Hieronder zie je alle punten." : ""}`;
  const note = p ? null : bad.length ? "Dit zijn vaak kleine aanpassingen. Ik kijk gratis met je mee wat het snelst helpt."
    : "Je site staat er op deze punten goed voor. Wil je er meer aanvragen uit halen, of past hij niet meer bij je bedrijf? Dan denk ik graag met je mee.";
  return { ok_count: ok, total: counted.length, summary, summary_by: "regels", package: p, options, note };
}

/** Korte, persoonlijke samenvatting (goedkoopste model; zonder AI de vaste tekst). */
async function aiSummary(result, hard) {
  if (!result.reachable || Date.now() > hard - 7000) return null;
  if (!(await refreshAi()) || !llmConfigured()) return null;
  try {
    const r = await aiContext.run({ taskId: null, department: "auditor", post: "websitecheck" }, () => structured({
      tier: "snel", post: "websitecheck", maxTokens: 1200, effort: "low", signal: AbortSignal.timeout(Math.max(1000, hard - Date.now() - 1500)),
      system: "Je vat de uitslag van een gratis websitecheck samen voor een ondernemer, namens Rayan van StrakWerk (webdesign). Nederlands, je-vorm, vriendelijk en concreet, twee of drie korte zinnen. Noem eerst wat goed gaat en daarna het aangewezen belangrijkste verbeterpunt. Gebruik alleen de aangeleverde controles. Geen cijfers, prijzen, beloftes, reviews of links.",
      instruction: "Schrijf de samenvatting.",
      untrusted: { controles: (result.checks || []).map(c => ({ punt: c.label, in_orde: c.ok, toelichting: c.detail })), tips: result.tips || [],
        belangrijkste_verbeterpunt: [...(result.checks || [])].filter(c => c.ok === false).sort((a, b) => PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key))[0]?.label || null },
      schema: { type: "object", additionalProperties: false, required: ["samenvatting"], properties: { samenvatting: { type: "string" } } },
    }));
    const s = safeText(r.data?.samenvatting, null, 420);
    return s.text || null;
  } catch (e) {
    if (!e.budget) console.error(`[websitecheck] AI niet gebruikt: ${e.message}`);
    return null;
  }
}

/** Uitslag voor de pagina (alleen wat de bezoeker mag zien). */
export async function checkView(token) {
  if (!TOKEN_RE.test(String(token || ""))) throw new HttpError(404, "niet_gevonden", "Deze check bestaat niet (meer).");
  let c = await one("select * from hq.site_checks where token_hash=$1", [sha(token)]);
  if (!c) throw new HttpError(404, "niet_gevonden", "Deze check bestaat niet (meer).");
  // Achtergrondmeting onderbroken (bijv. herstart): na 2 minuten eerlijk "mislukt".
  if (c.status === "bezig" && Date.now() - new Date(c.created_at) > 120_000) {
    c = (await q("update hq.site_checks set status='mislukt', error=$2, finished_at=now() where id=$1 and status='bezig' returning *", [c.id, "De check duurde te lang. Probeer het opnieuw, of stuur je adres via WhatsApp."])).rows[0] || c;
  }
  const res = c.result || {};
  return {
    status: c.status, url: c.url, domain: c.domain, created_at: c.created_at, contact_sent: Boolean(c.lead_id), whatsapp: SITE.brand.whatsapp,
    error: c.status === "mislukt" ? c.error : null,
    result: c.status === "klaar" ? { skipped: res.skipped || null, reachable: res.reachable ?? null, checked_at: res.checked_at, checks: res.checks || [], tips: res.tips || [] } : null,
    advice: c.status === "klaar" ? c.advice : null,
  };
}

/** Gegevens achterlaten na de check (alleen met het vinkje voor contact). */
export async function checkContact(token, body) {
  if (!TOKEN_RE.test(String(token || ""))) throw new HttpError(404, "niet_gevonden", "Deze check bestaat niet (meer).");
  const c = await one("select * from hq.site_checks where token_hash=$1", [sha(token)]);
  if (!c) throw new HttpError(404, "niet_gevonden", "Deze check bestaat niet (meer).");
  if (body?.consent !== true) throw new HttpError(400, "toestemming", "Zet het vinkje aan als Rayan contact met je mag opnemen.");
  const name = str(body.name, 120), company = str(body.company, 160), note = str(body.message, 1000);
  const email = body.email ? normEmail(str(body.email, 254)) : null;
  const phone = body.phone ? normPhone(str(body.phone, 40)) : null;
  if (!email && !phone) throw new HttpError(400, "ongeldig", "Vul je telefoonnummer of e-mailadres in.");
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new HttpError(400, "ongeldig", "Ongeldig e-mailadres.");
  if (phone && !/^\+\d{9,15}$/.test(phone)) throw new HttpError(400, "ongeldig", "Ongeldig telefoonnummer.");
  const res = c.result || {}, adv = c.advice || {};
  const points = (res.checks || []).filter(x => x.ok === false).map(x => `- ${x.label}: ${x.detail}`);
  const message = [`Gratis websitecheck voor ${c.url}`, c.status === "klaar" && adv.total ? `${adv.ok_count} van de ${adv.total} punten in orde.` : "Uitslag nog niet klaar.", ...points, note ? `Bericht: ${note}` : null].filter(Boolean).join("\n");
  const r = await intakeRequest({ name, company: company || name || c.domain, email, phone, message, type: "Websitecheck", website: c.url, channel: "formulier",
    page: "/websitecheck", ref: str(body.ref, 40), utm: body.utm, sales_channel: "websitecheck", external_id: `websitecheck:${c.id}`, is_test: c.is_test });
  if (r.duplicate) return { ok: true, duplicate: true };
  const date = new Date().toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam" });
  await tx(async (db) => {
    await db.query("update hq.site_checks set lead_id=$2 where id=$1", [c.id, r.lead_id]);
    await db.query("update hq.leads set website=coalesce(website,$2), website_status=coalesce(website_status,$3), updated_at=now() where id=$1", [r.lead_id, c.url, res.reachable ? "gevonden" : null]);
    // Het vinkje = toestemming voor contact over deze check (ook bellen, ook bij een eenmanszaak).
    for (const ch of [email ? "email" : null, phone ? "whatsapp" : null, phone ? "telefoon" : null].filter(Boolean)) {
      const has = (await db.query("select 1 from hq.consents where lead_id=$1 and channel=$2 and basis='toestemming' and revoked_at is null", [r.lead_id, ch])).rows[0];
      if (!has) await recordConsent(r.lead_id, { channel: ch, basis: "toestemming", source: "Vinkje op strakwerkk.nl/websitecheck",
        scope: "Over de uitslag van de websitecheck bellen, appen of mailen en een voorstel sturen, plus opvolging daarover",
        evidence: `Ondernemer zette op ${date} het vinkje "Rayan van StrakWerk mag mij hierover bellen, appen of mailen" aan bij de check van ${c.domain}.` }, null, db);
    }
  });
  // Bevindingen op de klantkaart (voor de belcoach en de voorbeeldsite).
  if ((res.observations || []).length) await saveObservations(r.lead_id, null, res.observations);
  return { ok: true };
}
