// Persoonlijke voorbeeldsite per bedrijf (/voorbeeld/<code>): een ondernemer die zijn eigen
// nieuwe site ziet, beslist sneller. Regels:
// - alleen echte, openbare gegevens (naam, plaats, telefoon, openingstijden uit OpenStreetMap);
// - teksten zijn duidelijk een voorbeeld; geen verzonnen cijfers, reviews, garanties of claims
//   (zie claims.js); geen logo's of foto's van het bedrijf (geen auteursrecht-risico);
// - niet vindbaar (noindex), verloopt na 45 dagen, offline bij afmelding;
// - tellen alleen echte bezoekers (script na een paar seconden; geen linkvoorbeelden of Rayan zelf).
import { randomBytes } from "node:crypto";
import { q, one, tx } from "../db.js";
import { HttpError, assertUuid } from "../http.js";
import { enqueue } from "../queue.js";
import { SITE } from "../content/studio.js";
import { structured, llmConfigured, refreshAi } from "../agents/llm.js";
import { safeText, esc } from "./claims.js";
import { notify } from "./notify.js";

export const STYLES = {
  strak: { label: "Strak (donker)", bg: "#0e0e11", panel: "#17171b", text: "#f2f2f4", muted: "#a5a5ae", accent: "#c9a25f", accentText: "#111", line: "#2a2a30" },
  licht: { label: "Licht", bg: "#ffffff", panel: "#f4f5f8", text: "#16181d", muted: "#5b616e", accent: "#1f3a8a", accentText: "#fff", line: "#e3e6ec" },
  warm: { label: "Warm", bg: "#fbf7f2", panel: "#f1e8dd", text: "#2a211b", muted: "#6f6056", accent: "#b4532a", accentText: "#fff", line: "#e6d9ca" },
  fris: { label: "Fris", bg: "#ffffff", panel: "#eef3fb", text: "#111827", muted: "#4b5563", accent: "#2563eb", accentText: "#fff", line: "#dbe4f3" },
};
const SEGMENT_STYLE = { salons: "warm", autobedrijven: "strak", dienstverleners: "fris" };

// Vaste, veilige basis per branche (zonder AI, en als vangnet voor afgekeurde AI-teksten).
const BASE = {
  salons: { feature: "afspraak", cta: "Plan je afspraak",
    kop: (b, p) => `${b} in ${p}`, subkop: "Kies je behandeling en plan je afspraak online, wanneer het jou uitkomt.",
    diensten: [["Behandelingen", "Een overzicht van alle behandelingen, zodat klanten direct zien wat je doet."], ["Prijslijst", "Duidelijke prijzen per behandeling: de vraag die klanten het vaakst stellen."], ["Online afspraak", "Klanten kiezen zelf een moment, ook buiten openingstijden."]],
    waarom: ["Persoonlijke aandacht voor elke klant", "Afspraak maken zonder te bellen", "Alles overzichtelijk op je telefoon"],
    over: (b, p) => `Hier vertel je in een paar zinnen wie je bent en wat ${b} in ${p} bijzonder maakt. Deze tekst vullen we samen in.` },
  autobedrijven: { feature: "kenteken", cta: "Vraag een afspraak aan",
    kop: (b, p) => `${b} in ${p}`, subkop: "Vul je kenteken in, kies wat er moet gebeuren en vraag direct een afspraak aan.",
    diensten: [["Onderhoud en reparatie", "Laat zien welk werk je doet, zodat klanten meteen weten dat ze goed zitten."], ["Kenteken invullen", "Klanten vullen hun kenteken in en zien direct hun auto: minder bellen, sneller een afspraak."], ["Afspraak aanvragen", "Een aanvraag komt binnen met alle gegevens die je nodig hebt."]],
    waarom: ["Snel geholpen, zonder gedoe", "Eerlijk advies over je auto", "Afspraak aanvragen in een minuut"],
    over: (b, p) => `Hier vertel je in een paar zinnen wie er achter ${b} in ${p} zit en waar je goed in bent. Deze tekst vullen we samen in.` },
  dienstverleners: { feature: "offerte", cta: "Vraag een offerte aan",
    kop: (b, p) => `${b} in ${p}`, subkop: "Beschrijf je klus en ontvang snel een voorstel, gewoon via WhatsApp.",
    diensten: [["Werkzaamheden", "Een helder overzicht van wat je doet, met voorbeelden van je werk."], ["Offerte via WhatsApp", "Klanten sturen hun vraag met één knop door, met de gegevens die jij nodig hebt."], ["Werkgebied", "Laat zien waar je werkt, zodat klanten in de buurt je vinden."]],
    waarom: ["Duidelijke afspraken vooraf", "Snel een reactie", "Vakwerk in de buurt"],
    over: (b, p) => `Hier vertel je in een paar zinnen wie ${b} in ${p} is en waar je voor staat. Deze tekst vullen we samen in.` },
};
const baseFor = (segment) => BASE[segment] || BASE.dienstverleners;

const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "en").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "bedrijf";

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["kop", "subkop", "cta", "diensten", "waarom", "over"],
  properties: {
    kop: { type: "string", description: "Korte kop voor de homepage, max 70 tekens." },
    subkop: { type: "string", description: "Eén zin onder de kop, max 160 tekens." },
    cta: { type: "string", description: "Tekst op de hoofdknop, max 28 tekens." },
    diensten: { type: "array", items: { type: "object", additionalProperties: false, required: ["naam", "tekst"], properties: { naam: { type: "string" }, tekst: { type: "string" } } } },
    waarom: { type: "array", items: { type: "string" } },
    over: { type: "string", description: "Korte, algemene over-ons-tekst zonder feiten die je niet weet, max 380 tekens." },
  },
};

/** Inhoud maken: AI (als het mag) binnen vaste regels, anders de vaste basis. */
export async function buildContent(lead, { opp = null } = {}) {
  const b = baseFor(lead.segment);
  const place = lead.city || "de regio";
  const osm = lead.source_detail?.osm || {};
  const fixed = {
    bedrijf: lead.company, plaats: place, segment: lead.segment || "dienstverleners", feature: b.feature,
    telefoon: lead.contact_phone || null, openingstijden: osm.openingstijden || null,
  };
  const rules = { kop: b.kop(lead.company, place), subkop: b.subkop, cta: b.cta, diensten: b.diensten.map(([naam, tekst]) => ({ naam, tekst })), waarom: b.waarom, over: b.over(lead.company, place) };
  let by = "regels", ai = null;
  if (await refreshAi() && llmConfigured()) {
    try {
      const r = await structured({
        tier: "overtuigen", post: "voorbeeldsite", maxTokens: 1500,
        system: "Je schrijft de teksten voor een VOORBEELD-homepage die webdesigner StrakWerk aan een lokale ondernemer laat zien. Schrijf in het Nederlands, je-vorm richting de klanten van dat bedrijf, kort, warm en concreet. Verzin NOOIT feiten: geen cijfers, jaartallen, aantallen, prijzen, reviews, sterren, garanties, keurmerken, 'beste' of 'nummer 1', geen links of e-mailadressen. Gebruik alleen de bedrijfsnaam, plaats en branche. Diensten mogen algemene categorieën zijn die bij de branche passen.",
        instruction: `Maak de teksten. Lever 3 tot 5 diensten en precies 3 korte redenen (waarom). ${opp ? "Laat de site het probleem van de huidige site oplossen (zie data), zonder het probleem te noemen." : ""}`,
        untrusted: { bedrijf: lead.company, plaats: place, branche: lead.segment, huidig_probleem: opp?.observation || null },
        schema: SCHEMA,
      });
      ai = r.data;
    } catch (e) { ai = null; if (!e.budget) console.error(`[voorbeeld] AI niet gebruikt: ${e.message}`); }
  }
  const out = { ...rules };
  if (ai) {
    let replaced = 0;
    const pick = (v, fb, max) => { const s = safeText(v, fb, max); if (s.replaced) replaced++; return s.text; };
    out.kop = pick(ai.kop, rules.kop, 70);
    out.subkop = pick(ai.subkop, rules.subkop, 160);
    out.cta = pick(ai.cta, rules.cta, 28);
    const d = (Array.isArray(ai.diensten) ? ai.diensten : []).slice(0, 5).map((x, i) => ({ naam: pick(x?.naam, rules.diensten[i % 3].naam, 40), tekst: pick(x?.tekst, rules.diensten[i % 3].tekst, 150) }));
    out.diensten = d.length >= 3 ? d : rules.diensten;
    const w = (Array.isArray(ai.waarom) ? ai.waarom : []).slice(0, 3).map((x, i) => pick(x, rules.waarom[i], 80));
    out.waarom = w.length === 3 ? w : rules.waarom;
    out.over = pick(ai.over, rules.over, 380);
    by = replaced ? "Claude + vaste tekst (controle)" : "Claude";
  }
  return { content: { ...fixed, ...out }, by };
}

/** Voorbeeldsite aanmaken of vernieuwen (zelfde link). Draait als taak (AI kan even duren). */
export async function makePreview(leadId, { style = null, taskId = null, actor = null } = {}) {
  const lead = await one("select * from hq.leads where id=$1", [leadId]);
  if (!lead) throw Object.assign(new Error("Klant bestaat niet meer."), { retryable: false });
  const supp = await one("select 1 from hq.suppressions where kind='lead' and value=$1", [leadId]);
  if (supp || lead.status === "afgemeld") throw Object.assign(new Error("Klant heeft zich afgemeld: geen voorbeeldsite."), { retryable: false });
  const opp = await one("select observation, service_key from hq.opportunities where lead_id=$1 and strength='concreet' and verified<>'klopt_niet' order by created_at desc limit 1", [leadId]);
  const { content, by } = await buildContent(lead, { opp });
  const st = STYLES[style] ? style : SEGMENT_STYLE[lead.segment] || "licht";
  return tx(async (db) => {
    const cur = (await db.query("select * from hq.previews where lead_id=$1 and status<>'ingetrokken' for update", [leadId])).rows[0];
    if (cur) {
      return (await db.query("update hq.previews set content=$2, content_by=$3, style=$4, expires_at=greatest(expires_at, now() + interval '45 days'), task_id=coalesce($5, task_id) where id=$1 returning *", [cur.id, content, by, st, taskId])).rows[0];
    }
    const slug = `${slugify(lead.company)}-${randomBytes(5).toString("hex").slice(0, 7)}`;
    return (await db.query(`insert into hq.previews (lead_id, slug, style, content, content_by, is_test, task_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [leadId, slug, st, content, by, lead.is_test, taskId, actor?.userId || null])).rows[0];
  });
}

/** Vanuit HQ: voorbeeldsite laten maken (als taak; HQ ververst de klantkaart). */
export async function requestPreview(leadId, body, auth) {
  assertUuid(leadId, "klant");
  const lead = await one("select id, company from hq.leads where id=$1", [leadId]);
  if (!lead) throw new HttpError(404, "niet_gevonden", "Klant niet gevonden.");
  const style = STYLES[body?.style] ? body.style : null;
  return tx((db) => enqueue(db, { agent: "sales", kind: "voorbeeldsite", title: `Voorbeeldsite ${lead.company}`, input: { style }, leadId, createdBy: auth?.userId || null,
    idempotencyKey: `voorbeeld:${leadId}:${style || "auto"}:${Math.floor(Date.now() / 60_000)}`, timeoutS: 24 }));
}

/** Uitvoerder (agent sales, kind voorbeeldsite). */
export async function runPreviewTask({ task, lead, ctx }) {
  if (!lead) throw Object.assign(new Error("Klant bestaat niet meer."), { retryable: false });
  await ctx.step(`Voorbeeldsite maken voor ${lead.company}`);
  const p = await makePreview(lead.id, { style: task.input?.style, taskId: task.id });
  return { status: "afgerond", result: { slug: p.slug, by: p.content_by }, message: `Voorbeeldsite klaar (${p.content_by}): /voorbeeld/${p.slug}` };
}

export const previewUrl = (slug) => `/voorbeeld/${slug}`;

/** Een echte bezoeker heeft de pagina een paar seconden open gehad. */
export async function previewSeen(slug, { owner = false } = {}) {
  if (owner || !/^[a-z0-9-]{3,60}$/.test(String(slug))) return { ok: true };
  const r = (await q(`update hq.previews set views = views + 1, first_viewed_at = coalesce(first_viewed_at, now()), last_viewed_at = now()
     where slug=$1 and status<>'ingetrokken' and expires_at > now() returning id, lead_id, views, is_test`, [slug])).rows[0];
  if (r?.views === 1) {
    const l = await one("select company from hq.leads where id=$1", [r.lead_id]);
    await notify({ key: `voorbeeld_bekeken:${r.id}`, kind: "voorbeeld_bekeken", title: `${l?.company || "Een klant"} bekijkt nu de voorbeeldsite`,
      body: "Dit is het beste moment om even te bellen.", leadId: r.lead_id, url: `/hq/klanten?id=${r.lead_id}`, isTest: r.is_test });
  }
  return { ok: true };
}

/** De voorbeeldpagina als HTML (zonder externe bronnen, alleen eigen script en lettertype). */
export async function previewHtml(slug) {
  const p = /^[a-z0-9-]{3,60}$/.test(String(slug)) ? await one("select * from hq.previews where slug=$1", [slug]) : null;
  if (!p || p.status === "ingetrokken") return { status: 404, html: simplePage("Voorbeeld niet gevonden", "Deze voorbeeldsite bestaat niet (meer).") };
  if (new Date(p.expires_at) < new Date()) return { status: 410, html: simplePage("Voorbeeld verlopen", "Deze voorbeeldsite is verlopen. Wil je hem weer zien? Stuur Rayan van StrakWerk een berichtje.") };
  return { status: 200, html: render(p) };
}

// Openingstijden uit OpenStreetMap ("Tu-Sa 09:00-17:00") leesbaar in het Nederlands.
const DAYS = { Mo: "ma", Tu: "di", We: "wo", Th: "do", Fr: "vr", Sa: "za", Su: "zo", PH: "feestdagen", off: "gesloten" };
export const nlHours = (s) => String(s || "").replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH|off)\b/g, d => DAYS[d]).replace(/;\s*/g, " · ").slice(0, 160);

function simplePage(title, text) {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif;background:#0e0e11;color:#eee;display:grid;place-items:center;min-height:100vh;padding:16px}main{max-width:440px}h1{font-size:22px}</style></head><body><main><h1>${esc(title)}</h1><p>${esc(text)}</p></main></body></html>`;
}

function render(p) {
  const c = p.content || {};
  const s = STYLES[p.style] || STYLES.licht;
  const wa = SITE.brand.whatsapp;
  const waLink = `https://wa.me/${wa}?text=${encodeURIComponent(`Hoi Rayan, ik heb de voorbeeldsite voor ${c.bedrijf} gezien.`)}`;
  const tel = c.telefoon ? String(c.telefoon) : null;
  const telShow = tel ? tel.replace(/^\+31/, "0") : null;
  const feature = c.feature === "kenteken"
    ? `<div class="demo" aria-label="Voorbeeld van de kentekencheck"><p class="tag">Voorbeeld van een functie</p><label>Jouw kenteken</label><div class="plate">AB-123-C</div><p class="small">Na het invullen zie je meteen merk, model en bouwjaar, en kies je wat er moet gebeuren.</p></div>`
    : c.feature === "afspraak"
      ? `<div class="demo" aria-label="Voorbeeld van online afspraak maken"><p class="tag">Voorbeeld van een functie</p><label>Kies een moment</label><div class="slots"><span>di 10:00</span><span>di 14:30</span><span>wo 09:30</span><span>do 16:00</span></div><p class="small">Klanten kiezen zelf een tijd; jij krijgt direct bericht.</p></div>`
      : `<div class="demo" aria-label="Voorbeeld van een offerteaanvraag"><p class="tag">Voorbeeld van een functie</p><label>Wat moet er gebeuren?</label><div class="field">Beschrijf je klus…</div><p class="small">Met één knop komt de aanvraag via WhatsApp binnen, met alles wat je nodig hebt.</p></div>`;
  const css = `:root{--bg:${s.bg};--panel:${s.panel};--text:${s.text};--muted:${s.muted};--accent:${s.accent};--on:${s.accentText};--line:${s.line}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 Geist,system-ui,-apple-system,sans-serif}
a{color:inherit}.wrap{max-width:1040px;margin:0 auto;padding:0 18px}
.note{background:#111;color:#f1f1f1;font-size:13px;padding:8px 0;text-align:center}.note a{color:#e8c98f}
header{border-bottom:1px solid var(--line)}header .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:14px;padding-bottom:14px}
.brand{font-weight:800;font-size:19px;letter-spacing:.01em;overflow-wrap:anywhere}nav{display:none;gap:18px;font-size:15px}nav a{text-decoration:none;color:var(--muted)}
.btn{display:inline-block;background:var(--accent);color:var(--on);text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px;text-align:center}
.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}
.hero{padding:44px 0 30px}.hero h1{font-size:clamp(30px,7vw,52px);line-height:1.08;margin:0 0 14px;overflow-wrap:anywhere}.hero p{font-size:18px;color:var(--muted);margin:0 0 22px;max-width:620px}
.ctas{display:flex;flex-wrap:wrap;gap:10px}
.grid{display:grid;gap:14px;grid-template-columns:1fr}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;min-width:0}
.card h3{margin:0 0 6px;font-size:18px}.card p{margin:0;color:var(--muted)}
section{padding:30px 0}h2{font-size:26px;margin:0 0 16px}
.why{list-style:none;padding:0;margin:0;display:grid;gap:10px}.why li{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-weight:600}
.demo{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-top:22px;max-width:460px}.demo label{display:block;font-weight:700;margin:4px 0 8px}
.tag{display:inline-block;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin:0 0 6px;font-weight:700}
.plate{display:inline-block;background:#f2c200;color:#111;font-weight:800;letter-spacing:.08em;padding:8px 14px;border-radius:6px;border:2px solid #111}
.slots{display:flex;flex-wrap:wrap;gap:8px}.slots span{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--bg)}
.field{border:1px solid var(--line);border-radius:8px;padding:10px 12px;color:var(--muted);background:var(--bg)}.small{font-size:14px;color:var(--muted);margin:10px 0 0}
.contact{display:grid;gap:10px}.foot{border-top:1px solid var(--line);padding:26px 0 40px;color:var(--muted);font-size:14px}
@media(min-width:760px){nav{display:flex}.grid{grid-template-columns:repeat(3,minmax(0,1fr))}.why{grid-template-columns:repeat(3,minmax(0,1fr))}.contact{grid-template-columns:1fr 1fr}}`;
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(c.bedrijf)} · voorbeeld door StrakWerk</title>
<link rel="stylesheet" href="/assets/fonts/fonts.css"><style>${css}</style></head><body>
<div class="note">Voorbeeld door <a href="https://www.strakwerkk.nl" target="_blank" rel="noopener">StrakWerk</a> voor ${esc(c.bedrijf)} · geen officiële website · <a href="${esc(waLink)}" target="_blank" rel="noopener">Deze site wil ik</a></div>
<header><div class="wrap"><span class="brand">${esc(c.bedrijf)}</span><nav><a href="#diensten">Diensten</a><a href="#over">Over</a><a href="#contact">Contact</a></nav><a class="btn" href="#contact">${esc(c.cta)}</a></div></header>
<main>
<section class="hero"><div class="wrap"><h1>${esc(c.kop)}</h1><p>${esc(c.subkop)}</p>
<div class="ctas"><a class="btn" href="#contact">${esc(c.cta)}</a>${tel ? `<a class="btn ghost" href="tel:${esc(tel)}">Bel ${esc(telShow)}</a>` : ""}</div>${feature}</div></section>
<section id="diensten"><div class="wrap"><h2>Diensten</h2><div class="grid">${(c.diensten || []).map(d => `<div class="card"><h3>${esc(d.naam)}</h3><p>${esc(d.tekst)}</p></div>`).join("")}</div></div></section>
<section><div class="wrap"><h2>Waarom ${esc(c.bedrijf)}</h2><ul class="why">${(c.waarom || []).map(w => `<li>${esc(w)}</li>`).join("")}</ul></div></section>
<section id="over"><div class="wrap"><h2>Over ons</h2><p>${esc(c.over)}</p></div></section>
<section id="contact"><div class="wrap"><h2>Contact</h2><div class="contact"><div class="card"><h3>${esc(c.bedrijf)}</h3><p>${esc(c.plaats)}${telShow ? `<br>${esc(telShow)}` : ""}</p></div>${c.openingstijden ? `<div class="card"><h3>Openingstijden</h3><p>${esc(nlHours(c.openingstijden))}</p></div>` : ""}</div>
<p class="small">Dit is een voorbeeld: teksten, diensten en foto's vullen we samen met jou in.</p></div></section>
</main>
<footer class="foot"><div class="wrap">Voorbeeld gemaakt door StrakWerk, webdesign uit Zoetermeer. Wil je deze website voor ${esc(c.bedrijf)}? <a href="${esc(waLink)}" target="_blank" rel="noopener">App Rayan</a>.</div></footer>
<script src="/assets/voorbeeld.js" defer></script>
</body></html>`;
}
