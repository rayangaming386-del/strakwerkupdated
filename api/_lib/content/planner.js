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
  const max = (s) => s.type === "screen" ? 8 : 5.5;
  while (total() < 16 && guard++ < 40) scenes.forEach(s => { s.seconds = Math.min(max(s), Math.round((s.seconds + 0.2) * 10) / 10); });
  while (total() > 24 && guard++ < 80) scenes.forEach(s => { s.seconds = Math.max(2.4, Math.round((s.seconds - 0.2) * 10) / 10); });
  scenes.forEach((s, i) => { s.id = s.id || `s${i + 1}`; if (!s.sub) delete s.sub; if (!s.asset2) delete s.asset2; });
  return total();
}

const LLM_SCHEMA = {
  type: "object", additionalProperties: false, required: ["hoeken"],
  properties: { hoeken: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["key", "naam", "waarom", "scenes", "instagram", "tiktok"],
    properties: {
      key: { type: "string" }, naam: { type: "string" }, waarom: { type: "string" },
      scenes: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "text"], properties: { id: { type: "string" }, kicker: { type: "string" }, text: { type: "string" }, sub: { type: "string" } } } },
      instagram: { type: "string" }, tiktok: { type: "string" },
    } } } },
};

/**
 * Maakt de drie hoeken. Met Claude worden alleen de teksten herschreven binnen de vaste
 * scènestructuur (beelden, volgorde, duur en oproep tot actie blijven uit het sjabloon).
 */
export async function planAngles(f, { ctx } = {}) {
  const base = f.kind === "merk" ? brandAngles(f) : templateAngles(f);
  // Alleen prijzen uit de pakketten van de website (Starter, Premium, Pro, Redesign).
  const allowedPrices = f.allowed_prices || [f.price_from_eur];
  const check = (angles) => angles.flatMap(an => [...an.scenes.map(s => `${s.kicker || ""} ${s.text} ${s.sub || ""}`), an.captions.instagram, an.captions.tiktok]).flatMap(t => contentGuard(t, { allowedPrices }));
  const problems = check(base);
  if (problems.length) throw Object.assign(new Error(`Sjabloon afgekeurd door controle: ${[...new Set(problems)].join(", ")}`), { retryable: false });
  if (!llmConfigured() || !ctx) return { angles: base, methode: "voorbeelddata (AI staat uit)" };
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
    if (e.budget || e.retryable === false || /Kostenlimiet|Stappenlimiet/.test(e.message)) throw e;
    return { angles: base, methode: `sjabloon (Claude niet beschikbaar: ${String(e.message).slice(0, 80)})` };
  }
}

// ── Campagnes voor StrakWerk zelf (zonder klantproject) ───────────────────────
// Afzender is altijd StrakWerk: eigen aanbod (pakketprijzen uit de website), eigen beelden
// (schermopname en schermafbeeldingen van strakwerkk.nl) en eigen contactgegevens.
export const BRAND_TOPICS = {
  prijs: { title: "Wat kost een website laten maken?", keyword: "PRIJS" },
  configurator: { title: "Je websiteprijs in één minuut", keyword: "OFFERTE" },
  pakketten: { title: "Welk websitepakket past bij jou?", keyword: "PAKKET" },
};

/** Feiten voor een StrakWerk-campagne: merkgegevens, prijzen van de site en eigen beelden. */
export function brandFactsFor({ brand, site, prices, assets, audienceKey, goal, topicKey, now = new Date() }) {
  const aud = AUDIENCES[audienceKey] || AUDIENCES.ondernemers;
  const promoActive = site.promo && new Date(site.promo.until) > now;
  return {
    kind: "merk", topic: { key: topicKey, ...BRAND_TOPICS[topicKey] },
    brand, audience: { key: audienceKey, ...aud }, goal,
    packages: ["nieuw", "premium", "pro"].map(k => ({ key: k, name: site.bases[k].name, price_eur: site.bases[k].price_eur, pitch: site.bases[k].pitch })),
    redesign: site.bases.redesign ? { name: site.bases.redesign.name, price_eur: site.bases.redesign.price_eur, pitch: site.bases.redesign.pitch } : null,
    price_from_eur: prices.from_eur,
    assets: assets.map(a => ({ id: a.id, path: a.path, kind: a.kind, label: a.label, duration_s: a.duration_s ? Number(a.duration_s) : null, moments: a.moments || null, width: a.width, height: a.height })),
    whatsapp: brand.whatsapp, whatsapp_display: phoneNl(brand.whatsapp), site: brand.site,
    promo: promoActive ? { until: site.promo.until, label: site.promo.label, text: `${site.promo.free.map(k => PROMO_TEXT[k] || k).join(" en ")} gratis bij elke website` } : null,
  };
}

function brandCaptions(f, opening, extra = "") {
  const list = f.packages.map(p => `• ${p.name}: €${p.price_eur}. ${p.pitch}`).join("\n");
  const tags = ["websitelatenmaken", "webdesign", "ondernemer", "zzp", "mkb", "strakwerk"].map(t => `#${t}`).join(" ");
  const instagram = `${opening}\n\nBij StrakWerk zie je de prijs vooraf. Vaste pakketten, eenmalig:\n${list}\n\n${extra ? `${extra}\n\n` : ""}Bereken jouw website op ${f.site}. Vragen? App ‘${f.topic.keyword}’ naar ${f.whatsapp_display}.\n\n${tags}`;
  const tiktok = `${opening} Bij StrakWerk zie je het vooraf: websites vanaf €${f.price_from_eur}. Bereken jouw website op ${f.site}. #websitelatenmaken #webdesign #ondernemer #strakwerk`;
  return { instagram, tiktok, promo_line: f.promo ? `Actie tot en met ${new Date(new Date(f.promo.until).getTime() - 1).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" })}: ${f.promo.text}.` : null, promo_until: f.promo?.until || null };
}

/** Drie hoeken voor een StrakWerk-onderwerp. Geen klantproject nodig. */
export function brandAngles(f) {
  const rec = f.assets.find(a => a.kind === "video" && /configurator/.test(a.path));
  const pak = f.assets.find(a => /pakketten/.test(a.path));
  const off = f.assets.find(a => /offerte/.test(a.path));
  if (!rec || !pak || !off) throw Object.assign(new Error("Eigen beelden ontbreken (schermopname configurator, pakketten, offerte). Draai npm run brand-assets."), { retryable: false, code: "geen_eigen_beelden" });
  const m = rec.moments || {};
  const recLen = Number(rec.duration_s) || 10;
  const clipFrom = (key, len) => ({ start: Math.max(0, Math.min((m[key] ?? 1) - 0.3, recLen - len)) });
  const aud = f.audience;
  const prices = (text = "Vaste prijzen, **eenmalig**", seconds = 4.2) => ({ type: "prices", kicker: "Pakketten van StrakWerk", text, items: f.packages, seconds });
  const cta = (seconds = 4) => ({ type: "cta", kicker: "StrakWerk · webdesign uit Zoetermeer", text: "Bereken jouw website op **strakwerkk.nl**", url: f.site, sub: f.whatsapp_display ? `Vragen? WhatsApp ${f.whatsapp_display}` : null, seconds });
  const screen = (text, key = "pakketten", seconds = 7) => ({ type: "screen", kicker: "De configurator op strakwerkk.nl", text, asset: rec.path, clip: clipFrom(key, seconds), seconds });
  const total = (seconds = 3.2) => ({ type: "phone", kicker: "Jouw offerte", text: "Je ziet **direct je totaal**", asset: off.path, seconds });
  const hook = (text, sub, asset = pak.path) => ({ type: "hook", kicker: `Voor ${aud.label.toLowerCase()}`, text, sub, asset, seconds: 3.4 });
  const T = {
    prijs: [
      { key: "vraag", name: "De vraag die iedereen stelt", why: "Beantwoordt de meest gestelde vraag direct met de echte prijzen en laat de configurator zien.",
        scenes: [hook("Wat kost een **website laten maken?**", "Bij StrakWerk zie je het vooraf."), prices(), screen("Stel je website **zelf samen**"), total(), cta()] },
      { key: "zonder_verrassingen", name: "Geen verrassingen achteraf", why: "Benadrukt vaste pakketprijzen en het zelf uitrekenen, zonder beloftes over resultaten.",
        scenes: [hook("Een website laten maken **zonder verrassingen?**", "Vaste pakketten, eenmalige prijs."), prices("Je weet vooraf **wat je betaalt**"), screen("Kies je pakket en opties", "premium"), total(), cta()] },
      { key: "vanaf", name: `Vanaf €${f.price_from_eur}`, why: "Opent met de instapprijs uit de website en laat zien wat er in de pakketten zit.",
        scenes: [hook(`Een eigen website **vanaf €${f.price_from_eur}**`, "Wat krijg je daarvoor?"), prices("Drie pakketten, **vaste prijzen**"), screen("Reken het zelf uit", "pakketten"), total(), cta()] },
    ],
    configurator: [
      { key: "minuut", name: "In één minuut", why: "Laat de configurator zelf het werk doen; de kijker ziet precies wat hij krijgt.",
        scenes: [hook("Je websiteprijs **in één minuut**", "Zonder afspraak, zonder offertegesprek."), screen("Kies een **pakket**", "pakketten", 6), screen("Zet aan wat je **nodig hebt**", "opties", 5), total(), cta()] },
      { key: "zelf", name: "Zelf samenstellen", why: "Ondernemers die zelf willen kiezen.",
        scenes: [hook("Stel je website **zelf samen**", "Zie meteen wat het kost."), prices(), screen("Pakket en opties in één scherm", "premium"), total(), cta()] },
      { key: "offerte", name: "Direct een offerte", why: "Eindigt bij de offerte die je via WhatsApp stuurt.",
        scenes: [hook("Wil je **direct een offerte?**", "Reken het uit op strakwerkk.nl."), screen("Kies wat je wilt", "premium", 6), total(3.6), prices("Alle pakketten op een rij", 3.6), cta()] },
    ],
    pakketten: [
      { key: "welk", name: "Welk pakket past bij jou?", why: "Helpt kiezen tussen Starter, Premium en Pro met de echte omschrijvingen.",
        scenes: [hook("Welk websitepakket **past bij jou?**", "Starter, Premium of Pro."), prices("Drie pakketten, **vaste prijzen**", 5.2), screen("Vergelijk ze in de configurator", "pakketten"), total(), cta()] },
      { key: "premium", name: "Premium uitgelicht", why: "Licht het pakket uit dat op de site als aanrader staat.",
        scenes: [hook(`Premium: **€${f.packages[1].price_eur}**`, f.packages[1].pitch), screen("Kies Premium en je extra's", "premium"), total(), prices("Of kies Starter of Pro"), cta()] },
      { key: "starter", name: "Starter uitgelicht", why: "Voor ondernemers die klein willen beginnen.",
        scenes: [hook(`Starter: **€${f.packages[0].price_eur}**`, f.packages[0].pitch), prices(), screen("Breid uit wanneer je wilt", "opties"), total(), cta()] },
    ],
  }[f.topic.key];
  if (!T) throw Object.assign(new Error("Onbekend onderwerp."), { retryable: false });
  return T.map(a => {
    a.scenes.forEach(s => { if (!s.sub) delete s.sub; });
    fixDurations(a.scenes);
    const opening = a.scenes[0].text.replace(/\*\*/g, "");
    return { ...a, opening, cta: "Bereken jouw website op strakwerkk.nl", assets_used: [...new Set(a.scenes.map(s => s.asset).filter(Boolean))], captions: brandCaptions(f, opening, a.scenes.some(s => s.type === "screen") ? "In de configurator stel je zelf je website samen en zie je direct je totaal." : "") };
  });
}
