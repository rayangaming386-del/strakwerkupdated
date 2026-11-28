// Controle op verzonnen claims in teksten die een klant leest (voorbeeldsite, persoonlijke
// berichten). AI mag formuleren, maar nooit feiten verzinnen: geen cijfers (jaren, aantallen,
// prijzen: die vult de code zelf in uit CONFIG), geen reviews of sterren, geen "beste" of
// "nummer 1", geen garanties, geen keurmerken, en geen links of adressen (die zet de code erin).
const PATTERNS = [
  [/\d/, "cijfer"],
  [/%|procent/i, "percentage"],
  [/\b(reviews?|recensies?|sterren|beoordelingen?|klanttevredenheid|tevreden klanten)\b/i, "reviews"],
  [/\b(beste|nummer\s*(één|een|1)|nr\.?\s*1|marktleider|goedkoopste|voordeligste|snelste)\b/i, "superlatief"],
  [/\b(garantie|gegarandeerd|garanderen|beloven)\b/i, "garantie"],
  [/\b(gecertificeerd|erkend|keurmerk|award|winnaar|bekroond|iso)\b/i, "keurmerk"],
  [/\b(jaar|jaren)\s+(ervaring|actief)|\bsinds\b/i, "ervaring"],
  [/https?:\/\/|www\.|@/i, "link of adres"],
];

/** Lijst met problemen in een tekst (leeg = in orde). */
export function claimProblems(text) {
  const t = String(text ?? "");
  return PATTERNS.filter(([re]) => re.test(t)).map(([, why]) => why);
}

/** Tekst als hij in orde is en niet te lang; anders de veilige vaste tekst. */
export function safeText(text, fallback, max = 400) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > max || claimProblems(t).length) return { text: fallback, replaced: Boolean(t) };
  return { text: t, replaced: false };
}

/** HTML-escape voor alles wat in een pagina komt. */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
