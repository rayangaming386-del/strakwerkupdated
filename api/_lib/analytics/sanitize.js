// Opschonen en beperken van binnenkomende meetgegevens. Alles wat niet expliciet is
// toegestaan, wordt weggegooid. Doel: geen persoonsgegevens in de analytics-tabellen.

export const EVENT_NAMES = [
  "page_view", "calculator_start", "package_select", "portfolio_open",
  "quote_whatsapp_click", "contact_whatsapp_click", "email_click", "phone_click", "demo_open",
];
// lead_received en deal_won worden bewust NIET via de browser aangenomen: die komen alleen
// uit het CRM (handmatig of een geautoriseerde integratie).

const PACKAGES = ["nieuw", "premium", "pro", "redesign"];
const PROJECTS = ["glow", "vagpro", "detak", "cartronic"];
const PLEK = /^[a-z0-9-]{1,30}$/;

const PROP_RULES = {
  package_select: { pakket: v => PACKAGES.includes(v) ? v : null },
  quote_whatsapp_click: { pakket: v => PACKAGES.includes(v) ? v : null },
  portfolio_open: { project: v => PROJECTS.includes(v) ? v : null },
  contact_whatsapp_click: { plek: v => PLEK.test(v) ? v : null },
  email_click: { plek: v => PLEK.test(v) ? v : null },
  phone_click: { plek: v => PLEK.test(v) ? v : null },
  demo_open: { plek: v => PLEK.test(v) ? v : null },
};

export function cleanProps(name, d) {
  const rules = PROP_RULES[name] || {};
  const out = {};
  for (const [k, fn] of Object.entries(rules)) {
    const v = d && typeof d[k] === "string" ? d[k].toLowerCase() : null;
    const c = v ? fn(v) : null;
    if (c) out[k] = c;
  }
  return out;
}

// Alleen paden die op deze site kunnen bestaan; de rest wordt "/(overig)".
export function cleanPath(p) {
  if (typeof p !== "string") return "/(overig)";
  let s = p.split(/[?#]/)[0].toLowerCase();
  if (s.length > 1) s = s.replace(/\/+$/, "").replace(/\.html$/, "");
  if (s === "/index") s = "/";
  return /^\/[a-z0-9\-\/]{0,120}$/.test(s) ? s : "/(overig)";
}

export function cleanHost(h) {
  if (typeof h !== "string" || !h) return null;
  const s = h.toLowerCase().replace(/^www\./, "").slice(0, 100);
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : null;
}

// UTM-waarden: kort, simpele tekens, en nooit iets dat op een e-mailadres of telefoonnummer lijkt.
export function cleanUtm(v) {
  if (typeof v !== "string") return null;
  const s = v.toLowerCase().trim().slice(0, 60);
  if (!s || /@|%40/.test(s) || /\d{6,}/.test(s.replace(/[\s\-.]/g, ""))) return null;
  return /^[a-z0-9_\-.+ ]+$/.test(s) ? s.replace(/\s+/g, "_") : null;
}

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|uptime|curl|wget|python|axios|node-fetch|go-http|java\/|facebookexternalhit|embedly|vercel-screenshot/i;
export const isBot = (ua) => !ua || BOT.test(ua);

export function deviceOf(ua, w) {
  ua = ua || "";
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return "mobiel";
  // iPadOS meldt zich als Macintosh en is server-side niet betrouwbaar te herkennen: telt als desktop.
  if (w > 0 && w < 700) return "mobiel";
  if (/Windows|Macintosh|X11|Linux|CrOS/.test(ua)) return "desktop";
  return "onbekend";
}
