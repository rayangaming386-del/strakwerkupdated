// AUDITOR (verkoopkans): bekijkt wat een echte klant op mobiel wil doen: diensten bekijken,
// een afspraak maken, een prijs vinden of contact opnemen. Alleen publieke GET-verzoeken
// (geen formulieren versturen, geen scans). Per observatie: exacte pagina, bewijs, sterkte
// (concreet of zwak) en één passende dienst van StrakWerk.
import { fetchPublic, robotsAllows, normalizeUrl } from "../agents/fetcher.js";
import { extract } from "../agents/html.js";
import { q } from "../db.js";
import { SITE } from "../content/studio.js";

const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 StrakWerkHQ";
const GOALS = {
  afspraak: { re: /afspra|boek|reserv|booking|agenda|plan je|maak een afspraak/i, label: "afspraak maken" },
  prijs: { re: /prijs|prijzen|tarie|kosten|price/i, label: "prijs vinden" },
  contact: { re: /contact|bel ons|neem contact|route/i, label: "contact opnemen" },
  diensten: { re: /dienst|behandel|service|werkzaamheden|aanbod|reparat|onderhoud/i, label: "diensten bekijken" },
};
const opt = (id) => (SITE.options || []).find(o => o.id === id);
const svc = (key) => {
  if (key === "booking") { const o = opt("booking"); return { key: "booking", text: `${o?.name || "Afspraken plannen"} (+€${o?.price_eur ?? 35}) op een nieuwe of bestaande site` }; }
  if (key === "aanvraag") { const o = opt("aanvraag"); return { key: "aanvraag", text: `${o?.name || "Aanvraag via WhatsApp"} (+€${o?.price_eur ?? 15})` }; }
  if (key === "calculator") { const o = opt("calculator"); return { key: "calculator", text: `${o?.name || "Prijscalculator"} (+€${o?.price_eur ?? 35})` }; }
  if (key === "redesign") return { key: "redesign", text: `Pakket Redesign (€${SITE.bases.redesign.price_eur}): bestaande site strak vernieuwd, mobiel eerst` };
  return { key: "nieuw", text: `Pakket Starter (€${SITE.bases.nieuw.price_eur}): complete website tot 3 pagina's` };
};

async function get(url) {
  const t0 = Date.now();
  try {
    const p = await fetchPublic(url, { timeoutMs: 9000, maxBytes: 600_000, userAgent: MOBILE_UA });
    return { ok: p.status < 400, status: p.status, url: p.url, body: p.body, ms: Date.now() - t0 };
  } catch (e) { return { ok: false, status: null, url, error: String(e.message).slice(0, 120), ms: Date.now() - t0 }; }
}

function linksWithText(html, base) {
  const out = [];
  for (const m of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = (m[1].match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href || /^(mailto|tel|javascript|#)/i.test(href)) continue;
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    try { const u = new URL(href, base); if (/^https?:$/.test(u.protocol)) out.push({ url: u.toString(), text }); } catch {}
  }
  return out;
}

export async function salesCheck(url, { step = async () => {} } = {}) {
  const u = normalizeUrl(url);
  await step("robots.txt controleren");
  const robots = await robotsAllows(u);
  if (!robots.allowed) return { skipped: `robots.txt staat dit niet toe (${robots.note})`, observations: [] };
  await step("Homepage op mobiel bekijken");
  const home = await get(u.toString());
  const at = new Date().toISOString();
  const obs = [];
  const push = (o) => obs.push({ ...o, evidence: { ...o.evidence, gemeten_op: at, user_agent: "mobiel (iPhone Safari)" } });
  if (!home.ok) {
    push({ goal: "diensten", page_url: u.toString(), observation: `De homepage gaf ${home.status ? `HTTP ${home.status}` : `geen antwoord (${home.error})`} op mobiel.`, strength: "concreet", evidence: { status: home.status, fout: home.error || null }, service: svc("redesign") });
    return { home: { status: home.status }, observations: obs };
  }
  const x = extract(home.body, home.url);
  if (!x.viewport) push({ goal: "diensten", page_url: home.url, observation: "De pagina heeft geen viewport-instelling: op een telefoon verschijnt hij als verkleinde desktopsite.", strength: "concreet", evidence: { meta_viewport: "ontbreekt" }, service: svc("redesign") });
  if (!x.tel.length && !x.whatsapp) push({ goal: "contact", page_url: home.url, observation: "Op de homepage staat geen klikbaar telefoonnummer en geen WhatsApp-knop.", strength: "concreet", evidence: { tel_links: 0, whatsapp_links: 0 }, service: svc("aanvraag") });
  // Volg de links voor afspraak, prijs en contact zoals een bezoeker zou doen.
  const links = linksWithText(home.body, home.url);
  const host = new URL(home.url).hostname;
  for (const [goal, g] of Object.entries(GOALS)) {
    const l = links.find(k => g.re.test(k.text) || g.re.test(k.url));
    if (!l) {
      if (goal === "afspraak") push({ goal, page_url: home.url, observation: "Er is op de homepage geen link om een afspraak te maken.", strength: "zwak", evidence: { gezocht_op: "afspraak, boeken, reserveren" }, service: svc("booking") });
      if (goal === "prijs") push({ goal, page_url: home.url, observation: "Er is op de homepage geen link naar prijzen of tarieven.", strength: "zwak", evidence: { gezocht_op: "prijs, prijzen, tarieven" }, service: svc("calculator") });
      continue;
    }
    // Externe boekingssystemen (andere host) worden alleen opgevraagd, niet gebruikt.
    await step(`Link "${l.text || goal}" volgen`);
    const r = await get(l.url);
    if (!r.ok) push({ goal, page_url: l.url, observation: `De link "${l.text || g.label}" op de homepage gaat op mobiel naar ${r.status ? `een foutpagina (HTTP ${r.status})` : `een pagina die niet laadt (${r.error})`}.`, strength: "concreet",
      evidence: { link_tekst: l.text, link: l.url, status: r.status, fout: r.error || null, vanaf: home.url, extern: new URL(l.url).hostname !== host }, service: svc(goal === "afspraak" ? "booking" : goal === "contact" ? "aanvraag" : goal === "prijs" ? "calculator" : "redesign") });
  }
  if (x.copyrightYear && x.copyrightYear < new Date().getFullYear() - 3) push({ goal: "diensten", page_url: home.url, observation: `Het copyrightjaar is ${x.copyrightYear}. Een oudere uitstraling of datum is alleen een zwak signaal.`, strength: "zwak", evidence: { copyright: x.copyrightYear }, service: svc("redesign") });
  return { home: { status: 200, url: home.url, ms: home.ms }, observations: obs };
}

/** Briefing voor een kansrijk bedrijf: probleem, bewijs, één passende dienst. */
export function briefingFrom(company, observations) {
  const best = observations.find(o => o.strength === "concreet") || observations[0];
  if (!best) return null;
  return { bedrijf: company, probleem: best.observation, bewijs: `${best.page_url}${best.evidence?.status ? ` · HTTP ${best.evidence.status}` : ""} · gemeten ${new Date(best.evidence.gemeten_op).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })}`, dienst: best.service.text, sterkte: best.strength };
}

export async function saveObservations(leadId, taskId, observations) {
  for (const o of observations) {
    await q(`insert into hq.opportunities (lead_id, task_id, page_url, goal, observation, evidence, strength, service_key, service_text) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [leadId, taskId, o.page_url, o.goal, o.observation, o.evidence, o.strength, o.service.key, o.service.text]);
  }
}
