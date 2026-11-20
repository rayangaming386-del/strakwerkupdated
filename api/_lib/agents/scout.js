// SCOUT: controleert een ingevoerde lead via de eigen, openbare website.
// Levert bronlinks, controleerbare bedrijfsinformatie en (met Claude) een onderbouwde
// reden waarom het bedrijf relevant is. Zoekt zelf geen bedrijven (geen zoekbron gekoppeld).
import { fetchPublic, robotsAllows, normalizeUrl } from "./fetcher.js";
import { extract } from "./html.js";
import { structured, llmConfigured } from "./llm.js";

export const KIND = "lead_onderzoek";

const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["activiteit", "relevant", "redenen", "onzekerheden"],
  properties: {
    activiteit: { type: "string", description: "Wat het bedrijf doet, alleen volgens de bron." },
    relevant: { type: "string", enum: ["ja", "mogelijk", "nee", "onbekend"] },
    redenen: { type: "array", items: { type: "object", additionalProperties: false, required: ["reden", "bewijs"], properties: { reden: { type: "string" }, bewijs: { type: "string", description: "Letterlijk feit uit de metingen of bron waarop dit steunt." } } } },
    onzekerheden: { type: "array", items: { type: "string" } },
  },
};

export async function run({ task, lead, ctx }) {
  if (!lead) throw Object.assign(new Error("Lead bestaat niet meer."), { retryable: false });
  if (!lead.website) throw Object.assign(new Error("Deze lead heeft geen website. Vul een website in; zelf zoeken naar bedrijven is niet gekoppeld."), { retryable: false });
  const url = normalizeUrl(lead.website);
  await ctx.step("robots.txt controleren", { url: url.origin });
  const robots = await robotsAllows(url);
  if (!robots.allowed) throw Object.assign(new Error(`Niet onderzocht: ${robots.note}`), { retryable: false });

  await ctx.step("Homepage ophalen", { url: url.toString() });
  const page = await fetchPublic(url.toString());
  const measuredAt = new Date().toISOString();
  if (page.status >= 400) throw Object.assign(new Error(`Website gaf HTTP ${page.status}.`), { retryable: page.status >= 500 });
  const x = extract(page.body, page.url);

  const facts = [
    { feit: "Website bereikbaar", waarde: `HTTP ${page.status}`, bron: page.url },
    x.title && { feit: "Paginatitel", waarde: x.title, bron: page.url },
    x.description && { feit: "Omschrijving (meta description)", waarde: x.description, bron: page.url },
    x.h1[0] && { feit: "Hoofdkop", waarde: x.h1[0], bron: page.url },
    x.tel.length && { feit: "Telefoon op de site", waarde: x.tel.join(", "), bron: page.url },
    x.mail.length && { feit: "E-mail op de site", waarde: x.mail.join(", "), bron: page.url },
    { feit: "WhatsApp-link op de site", waarde: x.whatsapp ? "ja" : "nee", bron: page.url },
    x.kvk && { feit: "KvK-nummer vermeld op de site", waarde: x.kvk, bron: page.url, controle: `https://www.kvk.nl/zoeken/?source=all&q=${x.kvk}` },
    x.social.length && { feit: "Sociale profielen gelinkt", waarde: x.social.join(", "), bron: page.url },
    x.generator && { feit: "Gemaakt met (generator)", waarde: x.generator, bron: page.url },
  ].filter(Boolean);

  const result = {
    bron: { url: page.url, opgehaald_op: measuredAt, doorverwijzingen: page.redirects, robots: robots.note },
    feiten: facts,
    contact_gevonden: { telefoon: x.tel, email: x.mail, whatsapp: x.whatsapp },
    relevantie: null,
    methode: llmConfigured() ? "metingen + Claude" : "alleen metingen",
  };

  if (llmConfigured()) {
    await ctx.step("Relevantie beoordelen (Claude)");
    const r = await ctx.llm(structured({
      system: "Je bent Scout, onderzoeker voor StrakWerk (webdesign voor ondernemers in Nederland). Beoordeel alleen op basis van de aangeleverde feiten en tekst. Verzin niets. Als iets niet uit de bron blijkt, zeg dat. Antwoord in het Nederlands.",
      instruction: `Bedrijf: ${lead.company}. Beschrijf kort wat het bedrijf doet en of het een passende lead is voor een webdesignbureau (bijvoorbeeld een verouderde of onvolledige website). Elke reden moet een bewijs hebben uit de metingen.`,
      untrusted: { feiten: facts, paginatekst: x.textSample },
      schema: SCHEMA, maxTokens: 2000, signal: ctx.signal,
    }));
    result.relevantie = r.data;
  }

  await ctx.checkControl();
  return { status: "afgerond", result, next: [{ agent: "auditor", kind: "website_analyse", title: `Website-analyse ${lead.company}`, input: { url: page.url } }] };
}
