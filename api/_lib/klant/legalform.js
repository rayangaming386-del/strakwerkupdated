// RECHTSVORM: bepaalt of bellen voor verkoop mag.
// Sinds 1 juli 2021 (Telecommunicatiewet, art. 11.7) mag je natuurlijke personen, óók een
// eenmanszaak, vof of maatschap, alleen bellen voor verkoop met hun toestemming of als ze klant
// zijn (geweest). Een rechtspersoon (bv, nv, stichting, vereniging, coöperatie) mag je zakelijk
// bellen, mits je in elk gesprek de mogelijkheid geeft om bezwaar te maken. Openbare gegevens
// (website, KvK, Google) zijn géén toestemming.
// Automatisch herkennen gebeurt alleen bij een sterk signaal: de eigen bedrijfsnaam direct
// gevolgd door de rechtsvorm ("Kapsalon Lotus B.V."), of de rechtsvorm in de naam zelf. Anders
// blijft het "onbekend" (dus niet bellen) tot jij het in het KvK-register hebt gecontroleerd.

export const LEGAL_FORMS = {
  bv: { label: "Besloten vennootschap (bv)", rechtspersoon: true },
  nv: { label: "Naamloze vennootschap (nv)", rechtspersoon: true },
  stichting: { label: "Stichting", rechtspersoon: true },
  vereniging: { label: "Vereniging", rechtspersoon: true },
  cooperatie: { label: "Coöperatie", rechtspersoon: true },
  eenmanszaak: { label: "Eenmanszaak", rechtspersoon: false },
  vof: { label: "Vennootschap onder firma (vof)", rechtspersoon: false },
  maatschap: { label: "Maatschap", rechtspersoon: false },
  cv: { label: "Commanditaire vennootschap (cv)", rechtspersoon: false },
  onbekend: { label: "Onbekend", rechtspersoon: false },
};
export const LEGAL_SOURCES = { naam: "Bedrijfsnaam", website: "Eigen website", kvk: "KvK-register (zelf gecontroleerd)", klant: "Opgegeven door de klant" };
export const RECHTSPERSONEN = Object.keys(LEGAL_FORMS).filter(k => LEGAL_FORMS[k].rechtspersoon);
export const isRechtspersoon = (form) => Boolean(LEGAL_FORMS[form]?.rechtspersoon);
export const PHONE_RULE = "Bellen voor verkoop mag alleen naar een bv, nv, stichting, vereniging of coöperatie (en dan altijd met de mogelijkheid om bezwaar te maken), of met toestemming, of naar een (oud-)klant. Een eenmanszaak, vof of maatschap bel je niet ongevraagd (Telecommunicatiewet, sinds 1 juli 2021): ga langs of wacht op hun aanvraag.";

// Rechtsvorm direct achter de naam. Begrensde herhalingen: geen kans op trage regexen.
const SUFFIX = [
  ["bv", /^b\.?\s?v\.?(?![a-z0-9])/i],
  ["nv", /^n\.?\s?v\.?(?![a-z0-9])/i],
  ["vof", /^v\.?\s?o\.?\s?f\.?(?![a-z0-9])/i],
];
const PREFIX = [["stichting", /^stichting\s/i], ["vereniging", /^vereniging\s/i], ["cooperatie", /^co[öo]peratie(ve)?\s/i]];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fold = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Naam zonder rechtsvorm, als losse woorden (voor het zoeken op de eigen site). */
export function nameWords(name) {
  let n = fold(name).replace(/[’'`]/g, "").trim();
  for (const [, re] of PREFIX) n = n.replace(re, "");
  n = n.replace(/[\s,.-]*(b\.?\s?v\.?|n\.?\s?v\.?|v\.?\s?o\.?\s?f\.?)\s*$/i, "");
  return n.split(/[^a-z0-9]+/).filter(Boolean).slice(0, 6);
}

/** Uit de bedrijfsnaam zelf ("Autobedrijf Noord B.V.", "Stichting Buurtwerk"). */
export function legalFromName(name) {
  const n = fold(name).trim();
  for (const [form, re] of PREFIX) if (re.test(n)) return { form, source: "naam", evidence: String(name).slice(0, 120) };
  const m = n.match(/[\s,]((b\.?\s?v\.?|n\.?\s?v\.?|v\.?\s?o\.?\s?f\.?))\s*$/i);
  if (m) for (const [form, re] of SUFFIX) if (re.test(m[1])) return { form, source: "naam", evidence: String(name).slice(0, 120) };
  return null;
}

const pageText = (html) => fold(String(html || "").slice(0, 400_000)
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&copy;|&#169;/gi, "©"))
  .replace(/\s+/g, " ").slice(0, 200_000);

/**
 * Van de eigen website: alleen als de eigen naam direct vóór de rechtsvorm staat
 * ("© 2026 Kapsalon Lotus B.V."). "Website door Bureau X B.V." telt dus niet.
 */
export function legalFromSite(name, html) {
  const words = nameWords(name);
  if (!words.length || words.join("").length < 4) return null;
  const text = pageText(html);
  const base = words.map(esc).join("[\\s\\-&.,'’]{0,3}");
  const own = new RegExp(`(?:^|[^a-z0-9])${base}[\\s,.]{0,3}((?:b\\.?\\s?v|n\\.?\\s?v|v\\.?\\s?o\\.?\\s?f)\\.?)(?![a-z0-9])`, "i");
  const m = text.match(own);
  if (m) for (const [form, re] of SUFFIX) if (re.test(m[1])) return { form, source: "website", evidence: m[0].replace(/^[^a-z0-9]/, "").trim().slice(0, 120) };
  for (const [form, label] of [["stichting", "stichting"], ["vereniging", "vereniging"]]) {
    const r = new RegExp(`(?:^|[^a-z0-9])${label}\\s${base}(?![a-z0-9])`, "i");
    const s = text.match(r);
    if (s) return { form, source: "website", evidence: s[0].replace(/^[^a-z0-9]/, "").trim().slice(0, 120) };
  }
  return null;
}
