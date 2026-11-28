// AUDITOR: meet een publieke website op concrete verbeterpunten.
// Gemeten feiten en interpretaties staan strikt gescheiden. Geen beveiligingsscans,
// geen formulieren invullen, alleen gewone GET-verzoeken zoals een bezoeker.
import { fetchPublic, robotsAllows, normalizeUrl, FetchError } from "./fetcher.js";
import { extract } from "./html.js";
import { structured, llmConfigured } from "./llm.js";
import { env } from "../env.js";

export const KIND = "website_analyse";

async function pagespeed(url, signal) {
  if (process.env.HQ_PAGESPEED === "uit") return { beschikbaar: false, reden: "Uitgeschakeld (HQ_PAGESPEED=uit)." };
  const qs = new URLSearchParams({ url, strategy: "mobile", category: "performance" });
  if (env.pagespeedKey) qs.set("key", env.pagespeedKey);
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)].filter(Boolean)) });
    if (!res.ok) return { beschikbaar: false, reden: res.status === 429 ? "PageSpeed-limiet bereikt (stel PAGESPEED_API_KEY in)." : `PageSpeed antwoordde ${res.status}.` };
    const d = await res.json();
    const a = d?.lighthouseResult?.audits || {};
    const score = d?.lighthouseResult?.categories?.performance?.score;
    return {
      beschikbaar: true, bron: "Google PageSpeed Insights (labtest, mobiel)",
      score: score == null ? null : Math.round(score * 100),
      lcp_s: a["largest-contentful-paint"]?.numericValue != null ? +(a["largest-contentful-paint"].numericValue / 1000).toFixed(1) : null,
      cls: a["cumulative-layout-shift"]?.numericValue != null ? +a["cumulative-layout-shift"].numericValue.toFixed(3) : null,
      tbt_ms: a["total-blocking-time"]?.numericValue != null ? Math.round(a["total-blocking-time"].numericValue) : null,
    };
  } catch (e) {
    return { beschikbaar: false, reden: e.name === "TimeoutError" ? "PageSpeed reageerde niet binnen 25 s." : "PageSpeed niet bereikbaar." };
  }
}

const INTERP_SCHEMA = {
  type: "object", additionalProperties: false, required: ["interpretaties", "kansen", "onzekerheden"],
  properties: {
    interpretaties: { type: "array", items: { type: "object", additionalProperties: false, required: ["punt", "op_basis_van"], properties: { punt: { type: "string" }, op_basis_van: { type: "array", items: { type: "string" } } } } },
    kansen: { type: "array", items: { type: "string" } },
    onzekerheden: { type: "array", items: { type: "string" } },
  },
};

export async function run({ task, lead, ctx }) {
  const target = task.input?.url || lead?.website;
  if (!target) throw Object.assign(new Error("Geen website om te analyseren."), { retryable: false });
  const url = normalizeUrl(target);
  await ctx.step("robots.txt controleren", { url: url.origin });
  const robots = await robotsAllows(url);
  if (!robots.allowed) throw Object.assign(new Error(`Niet geanalyseerd: ${robots.note}`), { retryable: false });

  await ctx.step("Pagina meten", { url: url.toString() });
  const page = await fetchPublic(url.toString());
  const at = new Date().toISOString();
  const x = extract(page.body, page.url);
  const finalHttps = page.url.startsWith("https://");

  let httpRedirect = null;
  if (finalHttps) {
    await ctx.step("Controle http → https");
    try {
      const plain = await fetchPublic(`http://${new URL(page.url).host}/`, { maxRedirects: 0, maxBytes: 50_000, timeoutMs: 6000 });
      const loc = plain.headers?.location || "";
      httpRedirect = plain.status >= 300 && plain.status < 400 && /^https:/i.test(loc) ? "ja" : `nee (HTTP ${plain.status})`;
    } catch (e) { httpRedirect = e instanceof FetchError && e.code === "redirects" ? "ja" : "niet te meten"; }
  }

  await ctx.checkControl();
  await ctx.step("PageSpeed-labtest (optioneel)");
  const psi = await pagespeed(page.url, ctx.signal);

  const m = (feit, waarde, extra = {}) => ({ feit, waarde, bron: page.url, gemeten_op: at, ...extra });
  const metingen = [
    m("HTTP-status", page.status),
    m("Beveiligde verbinding (https)", finalHttps ? "ja" : "nee"),
    httpRedirect && m("http stuurt door naar https", httpRedirect),
    m("Tijd tot eerste byte (vanaf HQ-server)", `${page.ttfbMs} ms`, { let_op: "Eén meting vanaf de server; geen gemiddelde van echte bezoekers." }),
    m("HTML-grootte", `${Math.round(page.bytes / 1024)} kB${page.truncated ? " (afgekapt)" : ""}`),
    m("Viewport-tag voor mobiel", x.viewport ? "aanwezig" : "ontbreekt"),
    m("Paginatitel", x.title ? `${x.title} (${x.title.length} tekens)` : "ontbreekt"),
    m("Meta description", x.description ? `${x.description.length} tekens` : "ontbreekt"),
    m("Aantal H1-koppen", x.h1Count),
    m("Afbeeldingen zonder alt-tekst", `${x.imgNoAlt} van ${x.imgCount}`),
    m("Externe scripts", x.scriptCount),
    m("Gestructureerde gegevens (schema.org)", x.ldTypes.length ? x.ldTypes.join(", ") : "geen gevonden"),
    m("Taal ingesteld (lang)", x.lang || "niet ingesteld"),
    m("Canonical-link", x.canonical ? "aanwezig" : "ontbreekt"),
    x.robotsMeta && m("Robots-meta", x.robotsMeta),
    m("Laatste copyrightjaar in tekst", x.copyrightYear ?? "niet gevonden"),
    m("Klikbaar telefoonnummer", x.tel.length ? "ja" : "nee"),
    m("WhatsApp-link", x.whatsapp ? "ja" : "nee"),
    x.generator && m("Generator", x.generator),
    psi.beschikbaar && m("PageSpeed-score mobiel (lab)", psi.score, { bron_meting: psi.bron }),
    psi.beschikbaar && psi.lcp_s != null && m("Largest Contentful Paint mobiel (lab)", `${psi.lcp_s} s`, { bron_meting: psi.bron }),
  ].filter(Boolean);

  // Regelgebaseerde interpretaties: voorzichtig geformuleerd en altijd herleidbaar.
  const year = new Date().getFullYear();
  const regels = [
    !finalHttps && { punt: "De site draait niet op https; browsers tonen dan 'Niet veilig'.", op_basis_van: ["Beveiligde verbinding (https)"] },
    httpRedirect && httpRedirect.startsWith("nee") && { punt: "Bezoekers via http:// worden niet naar de beveiligde versie gestuurd.", op_basis_van: ["http stuurt door naar https"] },
    !x.viewport && { punt: "Zonder viewport-tag wordt de site op telefoons waarschijnlijk verkleind weergegeven.", op_basis_van: ["Viewport-tag voor mobiel"] },
    !x.description && { punt: "Zonder meta description kiest Google zelf een tekst voor het zoekresultaat.", op_basis_van: ["Meta description"] },
    x.h1Count === 0 && { punt: "Er is geen hoofdkop (H1); dat maakt de pagina minder duidelijk voor zoekmachines en schermlezers.", op_basis_van: ["Aantal H1-koppen"] },
    x.imgCount > 0 && x.imgNoAlt / x.imgCount > 0.3 && { punt: "Veel afbeeldingen missen een alt-tekst; slechter voor toegankelijkheid.", op_basis_van: ["Afbeeldingen zonder alt-tekst"] },
    !x.ldTypes.length && { punt: "Geen gestructureerde bedrijfsgegevens gevonden; kans voor LocalBusiness-markup.", op_basis_van: ["Gestructureerde gegevens (schema.org)"] },
    x.copyrightYear && x.copyrightYear < year - 2 && { punt: `Het copyrightjaar (${x.copyrightYear}) wijst mogelijk op weinig recent onderhoud. Dit is een aanwijzing, geen bewijs.`, op_basis_van: ["Laatste copyrightjaar in tekst"] },
    !x.tel.length && !x.whatsapp && { punt: "Geen klikbaar telefoonnummer of WhatsApp-link gevonden op de homepage.", op_basis_van: ["Klikbaar telefoonnummer", "WhatsApp-link"] },
    psi.beschikbaar && psi.score != null && psi.score < 50 && { punt: "De mobiele labtest scoort laag; de site laadt waarschijnlijk traag op telefoons.", op_basis_van: ["PageSpeed-score mobiel (lab)"] },
  ].filter(Boolean);

  const result = {
    bron: { url: page.url, gemeten_op: at, robots: robots.note },
    feiten: metingen,
    interpretaties: regels.map(r => ({ ...r, methode: "regel" })),
    kansen: [], onzekerheden: ["Eén momentopname van alleen de homepage.", ...(psi.beschikbaar ? [] : [`PageSpeed: ${psi.reden}`])],
    methode: llmConfigured() ? "metingen + regels + Claude" : "metingen + regels",
  };

  if (llmConfigured()) {
    await ctx.step("Interpretatie (Claude)");
    const r = await ctx.llm(structured({
      system: "Je bent Auditor voor StrakWerk. Je interpreteert alleen de aangeleverde metingen. Elke interpretatie verwijst naar de namen van de metingen waarop ze steunt. Geen aannames over omzet, bezoekers of klanten. Geen beveiligingsclaims. Benoem onzekerheid. Nederlands.",
      instruction: "Geef de belangrijkste verbeterpunten voor deze website en concrete kansen voor een webdesigner. Herhaal geen metingen letterlijk.",
      untrusted: { metingen, regelinterpretaties: regels, paginatekst: x.textSample.slice(0, 1500) },
      schema: INTERP_SCHEMA, maxTokens: 2500, signal: ctx.signal,
    }));
    const known = new Set(metingen.map(f => f.feit));
    for (const i of r.data.interpretaties || []) {
      const basis = (i.op_basis_van || []).filter(b => known.has(b));
      if (basis.length) result.interpretaties.push({ punt: i.punt, op_basis_van: basis, methode: "Claude" }); // zonder herleidbare meting: weglaten
    }
    result.kansen = r.data.kansen || [];
    result.onzekerheden.push(...(r.data.onzekerheden || []));
  }

  // Onderzoek gaat eerst langs een mens voordat Sales er iets mee mag.
  return {
    status: "wacht_op_goedkeuring", result,
    approval: {
      kind: "onderzoek", title: `Onderzoek ${lead?.company || page.url} goedkeuren`,
      proposal: {
        bedrijf: lead?.company, website: page.url, feiten: metingen, interpretaties: result.interpretaties, kansen: result.kansen,
        scout: ctx.chain?.scout ? { feiten: ctx.chain.scout.feiten, relevantie: ctx.chain.scout.relevantie } : null,
      },
      rationale: { onzekerheden: result.onzekerheden, methode: result.methode },
    },
  };
}
