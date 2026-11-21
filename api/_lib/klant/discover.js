// SCOUT (ontdekken): zoekt bedrijven via OpenStreetMap (Overpass API; gratis, open data
// onder ODbL, bronvermelding "© OpenStreetMap-bijdragers"). Per bedrijf: bron, datum,
// websitestatus (gevonden / alleen sociaal profiel / onzeker / geen eigen website gevonden
// na deze controles), activiteit en de reden waarom StrakWerk zou kunnen helpen.
// Geen scraping van sociale netwerken; die profielen worden alleen genoteerd.
import { q, one, tx } from "../db.js";
import { fetchPublic, robotsAllows, normalizeUrl } from "../agents/fetcher.js";
import { extract } from "../agents/html.js";
import { normalizeDomain, companyKey } from "../crm.js";
import { normEmail, normPhone } from "./contact.js";
import { enqueue } from "../queue.js";

const OVERPASS = () => (process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter").trim();
export const OSM_SOURCE = "OpenStreetMap (Overpass API) · © OpenStreetMap-bijdragers, ODbL";

export function overpassQuery(tags, city, limit = 40) {
  const sel = tags.map(t => Object.entries(t).map(([k, v]) => `["${k}"="${v}"]`).join("")).flatMap(f => [`node(area.a)${f};`, `way(area.a)${f};`]).join("");
  return `[out:json][timeout:25];area["name"="${city.replace(/"/g, "")}"]["boundary"="administrative"]->.a;(${sel});out center tags ${Math.min(limit, 100)};`;
}

async function overpass(query) {
  let res;
  try {
    res = await fetch(OVERPASS(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "StrakWerkHQ/1.0 (+https://www.strakwerkk.nl)" }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(40_000) });
  } catch (e) { throw Object.assign(new Error(`OpenStreetMap niet bereikbaar (${e.name}).`), { retryable: true }); }
  if (res.status === 429 || res.status === 504) throw Object.assign(new Error("OpenStreetMap is druk (limiet); later opnieuw."), { retryable: true });
  if (!res.ok) throw Object.assign(new Error(`OpenStreetMap gaf ${res.status}.`), { retryable: false });
  return (await res.json()).elements || [];
}

const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "en").replace(/[^a-z0-9]+/g, "").slice(0, 40);

/** Websitestatus vaststellen met controleerbare stappen. Onzekerheid blijft zichtbaar. */
export async function websiteStatus({ name, city, website, social }) {
  const checks = [];
  const at = new Date().toISOString();
  const tryUrl = async (url, label) => {
    try {
      const u = normalizeUrl(url);
      const robots = await robotsAllows(u).catch(() => ({ allowed: true, note: "robots.txt niet te lezen" }));
      if (!robots.allowed) { checks.push({ controle: label, url: u.toString(), uitkomst: "niet bekeken: robots.txt staat het niet toe", at }); return { error: true }; }
      const p = await fetchPublic(u.toString(), { timeoutMs: 8000, maxBytes: 400_000 });
      const x = extract(p.body, p.url);
      const ok = p.status < 400;
      checks.push({ controle: label, url: p.url, uitkomst: ok ? `bereikbaar (HTTP ${p.status})${x.title ? `, titel "${x.title.slice(0, 80)}"` : ""}` : `HTTP ${p.status}`, at });
      return { ok, page: p, x };
    } catch (e) {
      checks.push({ controle: label, url, uitkomst: `niet bereikbaar (${String(e.message).slice(0, 80)})`, at });
      return { error: !/ENOTFOUND|EAI_AGAIN|bestaat niet|dns/i.test(String(e.message)) };
    }
  };
  if (website) {
    const r = await tryUrl(website, "Website uit OpenStreetMap");
    if (r.ok) return { status: "gevonden", website: r.page.url, checks, active: true };
  } else checks.push({ controle: "Websitevelden in OpenStreetMap (website, contact:website, url)", uitkomst: "leeg", at });
  // Bedrijfsnaam met plaatsnaam als domein (vaak gebruikt door kleine ondernemers).
  let uncertain = false;
  const n = slug(name), c = slug(city);
  for (const d of [...new Set([`${n}.nl`, c && !n.endsWith(c) ? `${n}${c}.nl` : null].filter(Boolean))]) {
    if (n.length < 3) break;
    const r = await tryUrl(`https://${d}`, `Domein op bedrijfsnaam: ${d}`);
    if (r.ok) {
      const title = `${r.x.title || ""} ${r.x.h1.join(" ")}`.toLowerCase();
      const words = String(name).toLowerCase().split(/\s+/).filter(w => w.length > 3);
      if (words.some(w => title.includes(w))) return { status: "gevonden", website: r.page.url, checks: [...checks, { controle: "Naam op gevonden site", uitkomst: "komt overeen met bedrijfsnaam", at }], active: true };
      checks.push({ controle: "Naam op gevonden site", uitkomst: "bedrijfsnaam niet herkend: waarschijnlijk een ander bedrijf", at });
    }
    if (r.error) uncertain = true;
  }
  if (social) checks.push({ controle: "Officieel bedrijfsprofiel", url: social, uitkomst: "profiel gevonden; links op het profiel zijn niet automatisch te controleren (platformvoorwaarden)", at });
  if (uncertain) return { status: "onzeker", website: null, checks, active: null };
  if (social) return { status: "alleen_sociaal", website: null, checks, active: null };
  return { status: "geen_gevonden", website: null, checks: [...checks, { controle: "Conclusie", uitkomst: "geen eigen website gevonden na deze controles", at }], active: null };
}

/** Prioriteit: aansluiting, concrete behoefte, interesse en beschikbare vervolgstap. */
export function scoreLead({ segmentActive = true, websiteStatus: ws, concrete = false, hasContact, active, interest = false }) {
  let s = 0; const why = [];
  if (segmentActive) { s += 25; why.push("past in een actief segment"); }
  if (ws === "geen_gevonden") { s += 30; why.push("geen eigen website gevonden (Starter €200 past)"); }
  else if (ws === "alleen_sociaal") { s += 25; why.push("alleen een sociaal profiel"); }
  else if (concrete) { s += 30; why.push("concreet probleem op de site"); }
  if (interest) { s += 30; why.push("toonde zelf interesse"); }
  if (hasContact) { s += 15; why.push("zakelijke contactmogelijkheid bekend"); } else why.push("geen contactmogelijkheid bekend");
  if (active === false) { s -= 40; why.push("lijkt niet actief"); } else if (active) { s += 10; why.push("lijkt actief"); }
  const priority = s >= 70 ? "hoog" : s >= 45 ? "middel" : "laag";
  return { score: Math.max(0, Math.min(100, s)), priority, reason: why.join("; ") };
}

/**
 * Eén ontdekronde voor één segment en plaats. Dubbele vondsten (zelfde OSM-object, domein
 * of naam+plaats) worden niet opnieuw aangemaakt; bestaande gesprekken blijven leidend.
 */
export async function discover({ segment, city, limit = 20, isTest = false, actorLabel = "agent:scout" }) {
  const seg = await one("select * from hq.segments where key=$1", [segment]);
  if (!seg) throw Object.assign(new Error("Onbekend segment."), { retryable: false });
  const els = await overpass(overpassQuery(seg.osm_tags, city, limit * 2));
  const out = { found: els.length, new: [], existing: [], skipped: [] };
  for (const el of els.slice(0, limit * 2)) {
    if (out.new.length >= limit) break;
    const t = el.tags || {};
    const name = t.name; if (!name) { out.skipped.push({ osm: `${el.type}/${el.id}`, reden: "geen naam" }); continue; }
    const osmId = `${el.type}/${el.id}`;
    const website = t.website || t["contact:website"] || t.url || null;
    const social = t["contact:facebook"] || t["contact:instagram"] || t.facebook || t.instagram || null;
    const email = normEmail(t.email || t["contact:email"]);
    const phone = normPhone(t.phone || t["contact:phone"]);
    const place = t["addr:city"] || city;
    const domain = normalizeDomain(website);
    const ex = await one(`select id, company, status from hq.leads where osm_id=$1 or (domain=$2 and $2 is not null) or (company_key=$3 and coalesce(city,'')=$4)`, [osmId, domain, companyKey(name), place]);
    if (ex) { out.existing.push({ id: ex.id, company: ex.company, status: ex.status, reden: "al in HQ" }); continue; }
    const closed = Object.keys(t).some(k => /^(disused|was|abandoned):/.test(k));
    const ws = await websiteStatus({ name, city: place, website, social });
    const active = closed ? false : ws.active ?? (t.opening_hours ? true : null);
    const sc = scoreLead({ segmentActive: seg.active, websiteStatus: ws.status, hasContact: Boolean(email || phone), active });
    const reason = ws.status === "geen_gevonden" ? "Geen eigen website gevonden na deze controles: een Starter-site kan helpen." : ws.status === "alleen_sociaal" ? "Alleen een sociaal profiel: een eigen site met contact en diensten kan helpen." : ws.status === "onzeker" ? "Websitestatus onzeker: handmatig controleren." : "Website gevonden: Auditor controleert de mobiele verkoopkans.";
    const lead = await tx(async (db) => {
      const r = (await db.query(`insert into hq.leads (company, company_key, website, domain, source, source_url, city, contact_email, contact_phone, status, segment, website_status, website_checks, social_url, active_status, fit_score, priority, priority_reason, osm_id, notes, source_detail, is_test)
        values ($1,$2,$3,$4,'scout_osm',$5,$6,$7,$8,'nieuw',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) on conflict do nothing returning *`,
        [name, companyKey(name), ws.website, normalizeDomain(ws.website), `https://www.openstreetmap.org/${osmId}`, place, email, phone, segment, ws.status, JSON.stringify(ws.checks), social,
         active === false ? "gesloten" : active ? "actief" : "onzeker", sc.score, sc.priority, `${reason} (${sc.reason})`, osmId, "", { bron: OSM_SOURCE, onderzocht_op: new Date().toISOString(), reden: reason }, isTest])).rows[0];
      if (r) await db.query("insert into hq.lead_history (lead_id, actor_label, to_status, note) values ($1,$2,'nieuw',$3)", [r.id, actorLabel, `Gevonden via ${OSM_SOURCE}`]);
      // Met website: Auditor controleert wat een echte klant op mobiel wil doen.
      if (r && ws.status === "gevonden") await enqueue(db, { agent: "auditor", kind: "verkoopkans", title: `Verkoopkans ${name}`, input: { url: ws.website }, leadId: r.id, idempotencyKey: `verkoopkans:${r.id}:1` });
      return r;
    });
    if (lead) out.new.push({ id: lead.id, company: name, website_status: ws.status, priority: sc.priority });
  }
  return out;
}
