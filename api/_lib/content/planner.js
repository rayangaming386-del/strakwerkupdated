// Contentplanner: stelt per project drie verschillende verkoophoeken voor, met per hoek een
// openingszin, scènes (met de gebruikte beelden), één oproep tot actie en captions voor
// Instagram en TikTok. Werkt zonder taalmodel (vaste, controleerbare sjablonen op basis van
// echte projectinformatie). Met ANTHROPIC_API_KEY mag Claude de teksten schrijven; die gaan
// door dezelfde harde controle en vallen bij twijfel terug op de sjablonen.
import { structured, llmConfigured } from "../agents/llm.js";

export const AUDIENCES = {
  saloneigenaren: { label: "Saloneigenaren", one: "Saloneigenaar", place: "salon", keyword: "SALON", pain: "plan jij nog alles via DM?", tags: ["salon", "beautysalon", "saloneigenaar"] },
  kappers: { label: "Kappers", one: "Kapper", place: "kapsalon", keyword: "KAPPER", pain: "plan jij afspraken nog via DM?", tags: ["kapper", "kapsalon"] },
  garages: { label: "Garagehouders", one: "Garagehouder", place: "garage", keyword: "GARAGE", pain: "komen alle vragen nog via de telefoon binnen?", tags: ["garage", "autobedrijf"] },
  horeca: { label: "Horecaondernemers", one: "Horecaondernemer", place: "zaak", keyword: "HORECA", pain: "staat je informatie nog alleen op Instagram?", tags: ["horeca", "restaurant"] },
  bouw: { label: "Bouwbedrijven", one: "Aannemer", place: "bedrijf", keyword: "BOUW", pain: "vinden klanten jouw werk online?", tags: ["bouw", "aannemer"] },
  ondernemers: { label: "Ondernemers", one: "Ondernemer", place: "bedrijf", keyword: "WEBSITE", pain: "regel jij aanvragen nog via DM?", tags: ["ondernemer", "mkb"] },
};
export const GOALS = { aanvragen: "Aanvragen via WhatsApp", bekendheid: "Bekendheid", portfolio: "Portfolio laten zien" };

const PROMO_TEXT = { logo: "logo-ontwerp", gbp: "Google Bedrijfsprofiel" };

// Rol van een beeld bepalen uit pad en label (alleen voor het kiezen van scènes).
export function roleOf(asset) {
  const s = `${asset.path} ${asset.label}`.toLowerCase();
  if (asset.kind === "mobiel") return "mobiel";
  if (/boek|afspraak|aanvraag|booking/.test(s)) return "aanvraag";
  if (/prijs|prijzen/.test(s)) return "prijzen";
  if (/behandeling|dienst|diensten|menu|aanbod|producten|merken/.test(s)) return "aanbod";
  if (/contact|route|openings/.test(s)) return "contact";
  if (/dashboard|beheer/.test(s)) return "beheer";
  if (/home|\/[a-z]+\.webp$/.test(s)) return "home";
  return "overig";
}

// Echte functie van het project bij een rol (uit de lijst "wat er gebouwd is").
function featureFor(features, role) {
  const re = { aanvraag: /afspraak|aanvraag|boek|whatsapp/i, prijzen: /prijs/i, aanbod: /pagina per|behandeling|dienst|webshop/i, contact: /openings|contact|route/i, beheer: /beheer|dashboard/i }[role];
  return re ? features.find(f => re.test(f)) || null : null;
}

const phoneNl = (wa) => wa && /^31\d{9}$/.test(wa) ? `0${wa.slice(2, 3)} ${wa.slice(3, 5)} ${wa.slice(5, 7)} ${wa.slice(7, 9)} ${wa.slice(9)}` : null;

/** Harde controle: wat de planner nooit mag zeggen (ook niet als een taalmodel het probeert). */
export function contentGuard(text, { allowedPrices = [] } = {}) {
  const problems = [];
  const t = String(text || "");
  for (const m of t.matchAll(/€\s?(\d+[\d.,]*)/g)) if (!allowedPrices.includes(Number(m[1].replace(/[.,]\d{2}$/, "").replace(/\./g, "")))) problems.push(`prijs €${m[1]} komt niet uit de pakketten`);
  if (/\d+\s?%/.test(t)) problems.push("percentage (resultaatclaim)");
  if (/\b(review|reviews|recensie|sterren|beoordeling|klanten zeggen)\b/i.test(t)) problems.push("verwijst naar reviews");
  if (/\b(omzet|meer klanten|meer boekingen|meer aanvragen|verdubbel|groei van|resultaat:?)\b/i.test(t)) problems.push("belooft een resultaat");
  if (/\b(voor en na|voor-en-na|oude website|oude site)\b/i.test(t)) problems.push("voor-en-na of oude website");
  if (/\b(garantie|gegarandeerd|100 ?%)\b/i.test(t)) problems.push("garantie");
  return problems;
}

/** Feiten waarop de planner zich baseert (ook zichtbaar in HQ). */
export function factsFor({ project, assets, audienceKey, goal, prices, site, now = new Date() }) {
  const aud = AUDIENCES[audienceKey] || AUDIENCES.ondernemers;
  const released = assets.filter(a => a.social_ok);
  const promoActive = site.promo && new Date(site.promo.until) > now;
  return {
    project: { name: project.name, sector: project.sector, city: project.city, summary: project.summary, features: project.features || [], live_url: project.live_url },
    audience: { key: audienceKey, ...aud },
    goal,
    assets: released.map(a => ({ id: a.id, path: a.path, kind: a.kind, label: a.label, role: roleOf(a), hint: a.hint || "", notes: a.notes, valid_until: a.valid_until, width: a.width, height: a.height })),
    price_from_eur: prices.from_eur,
    whatsapp: site.whatsapp, whatsapp_display: phoneNl(site.whatsapp), site: site.site,
    promo: promoActive ? { until: site.promo.until, label: site.promo.label, text: `${site.promo.free.map(k => PROMO_TEXT[k] || k).join(" en ")} gratis bij elke website` } : null,
  };
}

function pick(byRole, ...roles) {
  for (const r of roles) if (byRole[r]?.length) return byRole[r].shift();
  return null;
}

function captionsFor(f, angle) {
  const a = f.audience, p = f.project;
  const feats = p.features.slice(0, 4);
  const ctaLine = `Wil je dit voor jouw ${a.place}? App ‘${a.keyword}’ naar ${f.whatsapp_display || "StrakWerk"}.`;
  const tags = [...a.tags, p.city ? p.city.toLowerCase().replace(/\s+/g, "") : null, "websitelatenmaken", "webdesign"].filter(Boolean).map(t => `#${t}`).join(" ");
  const intro = {
    pijnpunt: `${a.one}, ${a.pain}`,
    prijzen: "Klanten willen vooraf weten wat iets kost.",
    rondleiding: `Zo ziet de website van ${p.name} eruit.`,
  }[angle];
  const list = feats.length ? `Voor ${p.name}${p.city ? ` in ${p.city}` : ""} maakte ik een website met:\n${feats.map(x => `• ${x}`).join("\n")}` : `Dit is de website die ik maakte voor ${p.name}${p.city ? ` in ${p.city}` : ""}.`;
  const instagram = `${intro}\n\n${list}\n\n${ctaLine} Of kijk op ${f.site}: websites vanaf €${f.price_from_eur}.\n\n${tags}`;
  const tiktok = `${intro} Zo pakte ik het aan voor ${p.name}${p.city ? ` in ${p.city}` : ""}. ${ctaLine} ${tags.split(" ").slice(0, 5).join(" ")}`;
  return { instagram, tiktok, promo_line: f.promo ? `Actie tot en met ${new Date(new Date(f.promo.until).getTime() - 1).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" })}: ${f.promo.text}.` : null, promo_until: f.promo?.until || null };
}

/** Drie hoeken uit vaste sjablonen. Alle tekst komt uit projectgegevens, doelgroep en pakketprijs. */
export function templateAngles(f) {
  if (f.assets.length < 3) throw Object.assign(new Error("Geef minimaal 3 beelden van dit project vrij voor social media."), { retryable: false, code: "te_weinig_beelden" });
  const a = f.audience, p = f.project;
  const roles = () => { const m = {}; for (const x of f.assets) (m[x.role] ||= []).push(x); return m; };
  const cta = (seconds = 4) => ({ type: "cta", kicker: "StrakWerk · webdesign uit Zoetermeer", text: `Wil je dit voor **jouw ${a.place}?**`, keyword: a.keyword, sub: f.whatsapp_display ? `Via WhatsApp: ${f.whatsapp_display}` : null, footer: `${f.site} · websites vanaf €${f.price_from_eur}`, seconds });
  const sub = (x) => x?.hint || null;
  const kicker = `${p.name}${p.city ? ` · ${p.city}` : ""}`;
  const out = [];

  // 1. Pijnpunt: van losse berichten naar een duidelijke aanvraag.
  {
    const r = roles();
    const home = pick(r, "home", "overig"), mob = (r.mobiel || [])[0] || null;
    const aanbod = pick(r, "aanbod", "overig"), prijs = pick(r, "prijzen"), aanvraag = pick(r, "aanvraag", "contact", "overig");
    const scenes = [
      { type: "hook", kicker: `Voor ${a.label.toLowerCase()}`, text: `${a.one}, **${a.pain}**`, sub: `Kijk hoe de website van ${p.name} dat regelt.`, asset: home?.path, seconds: 3.6 },
      home && { type: "shot", kicker, text: `Een eigen website voor de ${a.place}`, sub: sub(home), asset: home.path, asset2: mob?.path, seconds: 3.4 },
      aanbod && { type: "shot", kicker: aanbod.label || "Aanbod", text: featureFor(p.features, "aanbod") || "Alles overzichtelijk op een rij", sub: sub(aanbod), asset: aanbod.path, seconds: 3.4 },
      prijs && { type: "shot", kicker: prijs.label || "Prijzen", text: featureFor(p.features, "prijzen") || "Prijzen vooraf zichtbaar", sub: sub(prijs), asset: prijs.path, seconds: 3.2 },
      aanvraag && { type: "shot", kicker: aanvraag.label || "Aanvragen", text: featureFor(p.features, "aanvraag") || "Aanvragen zonder heen-en-weer", sub: sub(aanvraag), asset: aanvraag.path, seconds: 3.4 },
      cta(),
    ].filter(Boolean);
    out.push({ key: "pijnpunt", name: "Van DM naar aanvraag", opening: scenes[0].text.replace(/\*\*/g, ""), why: `Spreekt ${a.label.toLowerCase()} aan op iets herkenbaars en laat zien hoe de site van ${p.name} aanvragen ordent.`, scenes });
  }
  // 2. Prijzen vooraf zichtbaar.
  {
    const r = roles();
    const prijs = pick(r, "prijzen", "aanbod"), aanbod = pick(r, "aanbod", "home"), aanvraag = pick(r, "aanvraag", "contact"), mob = (r.mobiel || [])[0], home = pick(r, "home", "overig");
    const scenes = [
      { type: "hook", kicker: `Voor ${a.label.toLowerCase()}`, text: "Krijg je steeds de vraag **wat kost dat?**", sub: `${p.name} zet het gewoon op de site.`, asset: prijs?.path, seconds: 3.6 },
      prijs && { type: "shot", kicker: prijs.label || "Prijzen", text: featureFor(p.features, "prijzen") || "Prijzen vooraf zichtbaar", sub: sub(prijs), asset: prijs.path, seconds: 3.6 },
      aanbod && { type: "shot", kicker: aanbod.label || "Aanbod", text: featureFor(p.features, "aanbod") || "Elk onderdeel duidelijk uitgelegd", sub: sub(aanbod), asset: aanbod.path, seconds: 3.4 },
      aanvraag && { type: "shot", kicker: aanvraag.label || "Aanvragen", text: featureFor(p.features, "aanvraag") || "Daarna direct een aanvraag", sub: sub(aanvraag), asset: aanvraag.path, seconds: 3.4 },
      (mob || home) && (mob ? { type: "phone", kicker, text: "Werkt net zo goed **op de telefoon**", asset: mob.path, seconds: 3.2 } : { type: "shot", kicker, text: `De website van ${p.name}`, asset: home.path, seconds: 3.2 }),
      cta(),
    ].filter(Boolean);
    out.push({ key: "prijzen", name: "Prijzen vooraf zichtbaar", opening: scenes[0].text.replace(/\*\*/g, ""), why: "Laat een concrete functie zien die vragen vooraf beantwoordt, zonder resultaten te beloven.", scenes });
  }
  // 3. Rondleiding door het project.
  {
    const r = roles();
    const home = pick(r, "home", "overig"), mob = (r.mobiel || [])[0], aanbod = pick(r, "aanbod", "prijzen", "overig"), contact = pick(r, "contact", "aanvraag", "overig");
    const scenes = [
      { type: "hook", kicker: "Opgeleverd", text: `Nieuw: de website van **${p.name}**`, sub: p.sector && p.city ? `${p.sector} in ${p.city}.` : null, asset: home?.path, seconds: 3.6 },
      home && { type: "shot", kicker, text: "De homepage", sub: sub(home), asset: home.path, seconds: 3.4 },
      aanbod && { type: "shot", kicker: aanbod.label || "Aanbod", text: featureFor(p.features, aanbod.role) || aanbod.label || "Het aanbod", sub: sub(aanbod), asset: aanbod.path, seconds: 3.4 },
      mob && { type: "phone", kicker, text: "En zo op de telefoon", asset: mob.path, seconds: 3.2 },
      contact && { type: "shot", kicker: contact.label || "Contact", text: featureFor(p.features, contact.role) || contact.label || "Contact", sub: sub(contact), asset: contact.path, seconds: 3.2 },
      cta(),
    ].filter(Boolean);
    out.push({ key: "rondleiding", name: "Rondleiding door het project", opening: scenes[0].text.replace(/\*\*/g, ""), why: "Toont het opgeleverde werk zelf; geschikt als portfolio-post.", scenes });
  }
  for (const ang of out) {
    ang.cta = `Wil je dit voor jouw ${a.place}? App ‘${a.keyword}’.`;
    ang.assets_used = [...new Set(ang.scenes.flatMap(s => [s.asset, s.asset2]).filter(Boolean))];
    ang.captions = captionsFor(f, ang.key);
    fixDurations(ang.scenes);
  }
  return out;
}

// Houd de totale duur binnen 15–25 s (met 0,5 s overgang per scène).
export function fixDurations(scenes) {
  const total = () => scenes.reduce((s, x) => s + x.seconds, 0) - 0.5 * (scenes.length - 1);
  let guard = 0;
  while (total() < 16 && guard++ < 40) scenes.forEach(s => { s.seconds = Math.min(5.5, Math.round((s.seconds + 0.2) * 10) / 10); });
  while (total() > 24 && guard++ < 80) scenes.forEach(s => { s.seconds = Math.max(2.4, Math.round((s.seconds - 0.2) * 10) / 10); });
  scenes.forEach((s, i) => { s.id = s.id || `s${i + 1}`; if (!s.sub) delete s.sub; if (!s.asset2) delete s.asset2; });
  return total();
}

const LLM_SCHEMA = {
  type: "object", additionalProperties: false, required: ["hoeken"],
  properties: { hoeken: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["key", "naam", "waarom", "scenes", "instagram", "tiktok"],
    properties: {
      key: { type: "string", enum: ["pijnpunt", "prijzen", "rondleiding"] }, naam: { type: "string" }, waarom: { type: "string" },
      scenes: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "text"], properties: { id: { type: "string" }, kicker: { type: "string" }, text: { type: "string" }, sub: { type: "string" } } } },
      instagram: { type: "string" }, tiktok: { type: "string" },
    } } } },
};

/**
 * Maakt de drie hoeken. Met Claude worden alleen de teksten herschreven binnen de vaste
 * scènestructuur (beelden, volgorde, duur en oproep tot actie blijven uit het sjabloon).
 */
export async function planAngles(f, { ctx } = {}) {
  const base = templateAngles(f);
  const allowedPrices = [f.price_from_eur];
  const check = (angles) => angles.flatMap(an => [...an.scenes.map(s => `${s.kicker || ""} ${s.text} ${s.sub || ""}`), an.captions.instagram, an.captions.tiktok]).flatMap(t => contentGuard(t, { allowedPrices }));
  const problems = check(base);
  if (problems.length) throw Object.assign(new Error(`Sjabloon afgekeurd door controle: ${[...new Set(problems)].join(", ")}`), { retryable: false });
  if (!llmConfigured() || !ctx) return { angles: base, methode: "sjabloon" };
  try {
    await ctx.step("Teksten schrijven (Claude)");
    const r = await ctx.llm(structured({
      system: "Je schrijft korte Nederlandse teksten voor verticale video's van StrakWerk (webdesign, Rayan, Zoetermeer). Gebruik uitsluitend de aangeleverde projectfeiten. Verzin geen reviews, cijfers, omzet, klantresultaten, oude websites of voor-en-na. Noem geen andere prijs dan de aangeleverde 'vanaf'-prijs. Houd per scène de tekst onder 60 tekens en de ondertitel onder 70 tekens. Gebruik **dubbele sterretjes** om hooguit één woordgroep goud te maken. Behoud de opening van hoek 'pijnpunt' en de tekst van de laatste scène letterlijk.",
      instruction: "Herschrijf de teksten van deze drie hoeken in natuurlijk Nederlands, met dezelfde scène-id's. Lever ook een Instagram-caption (max 900 tekens, met dezelfde oproep tot actie en hashtags) en een TikTok-caption (max 300 tekens).",
      untrusted: { feiten: f, sjabloon: base.map(b => ({ key: b.key, naam: b.name, scenes: b.scenes.map(s => ({ id: s.id, kicker: s.kicker, text: s.text, sub: s.sub })), instagram: b.captions.instagram, tiktok: b.captions.tiktok })) },
      schema: LLM_SCHEMA, maxTokens: 3000, signal: ctx.signal,
    }));
    const merged = base.map(b => {
      const h = r.data.hoeken.find(x => x.key === b.key);
      if (!h) return b;
      const scenes = b.scenes.map((s, i) => {
        const n = h.scenes.find(x => x.id === s.id);
        if (!n || i === 0 && b.key === "pijnpunt" || s.type === "cta") return s;
        return { ...s, text: String(n.text).slice(0, 120), ...(n.sub ? { sub: String(n.sub).slice(0, 120) } : {}), ...(n.kicker ? { kicker: String(n.kicker).slice(0, 60) } : {}) };
      });
      return { ...b, name: h.naam || b.name, why: h.waarom || b.why, scenes, captions: { ...b.captions, instagram: h.instagram || b.captions.instagram, tiktok: h.tiktok || b.captions.tiktok }, opening: scenes[0].text.replace(/\*\*/g, "") };
    });
    if (check(merged).length) return { angles: base, methode: "sjabloon (tekst van Claude afgekeurd door controle)" };
    return { angles: merged, methode: "Claude" };
  } catch (e) {
    if (e.retryable === false || /Kostenlimiet|Stappenlimiet/.test(e.message)) throw e;
    return { angles: base, methode: `sjabloon (Claude niet beschikbaar: ${String(e.message).slice(0, 80)})` };
  }
}
