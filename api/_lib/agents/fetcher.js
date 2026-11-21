// Veilig ophalen van publieke webpagina's voor Scout en Auditor.
// - Alleen http(s), poort 80/443, alleen publieke IP-adressen (controle bij het verbinden,
//   dus ook bestand tegen DNS-rebinding), maximaal 3 doorverwijzingen, groottelimiet, time-out.
// - Respecteert robots.txt. Alleen GET, geen formulieren, geen inloggen, geen scans.
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";

export const USER_AGENT = "StrakWerkHQ/1.0 (+https://www.strakwerkk.nl; websiteanalyse op verzoek)";

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 198 && (b === 18 || b === 19));
  }
  const s = ip.toLowerCase();
  if (s.startsWith("::ffff:")) return isPrivateIp(s.slice(7));
  return s === "::1" || s === "::" || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe80") || s.startsWith("ff");
}

// Alleen voor geautomatiseerde tests: een nep-website op 127.0.0.1 onder een domeinnaam.
// Werkt uitsluitend met HQ_TEST_MODE=1 en nooit op Vercel.
let testNet = null;
export function __setTestNetwork(v) {
  if (process.env.HQ_TEST_MODE !== "1" || process.env.VERCEL) throw new Error("Testnetwerk is alleen in tests beschikbaar.");
  testNet = v;
}

function safeLookup(hostname, opts, cb) {
  if (testNet?.hosts?.[hostname]) { const a = testNet.hosts[hostname]; return opts && opts.all ? cb(null, [{ address: a, family: 4 }]) : cb(null, a, 4); }
  if (testNet?.strict) return cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }));
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.filter(a => !isPrivateIp(a.address));
    if (!ok.length) return cb(Object.assign(new Error("Adres is niet publiek."), { code: "NIET_PUBLIEK" }));
    if (opts && opts.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

export class FetchError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export function normalizeUrl(input) {
  let s = String(input || "").trim();
  if (!s) throw new FetchError("Geen website opgegeven.", "geen_url");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { throw new FetchError("Ongeldig webadres.", "ongeldige_url"); }
  if (!["http:", "https:"].includes(u.protocol)) throw new FetchError("Alleen http(s) is toegestaan.", "protocol");
  if (u.username || u.password) throw new FetchError("Webadres met inloggegevens is niet toegestaan.", "credentials");
  if (u.port && !["80", "443"].includes(u.port) && !testNet) throw new FetchError("Alleen standaardpoorten zijn toegestaan.", "poort");
  if (net.isIP(u.hostname) || !/\.[a-z]{2,}$/i.test(u.hostname)) throw new FetchError("Gebruik een domeinnaam.", "host");
  u.hash = "";
  return u;
}

function once(u, { timeoutMs, maxBytes, method = "GET", userAgent = null }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === "https:" ? https : http;
    const started = Date.now();
    const req = lib.request(u, {
      method, lookup: safeLookup, timeout: timeoutMs,
      headers: { "user-agent": userAgent || USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5", "accept-language": "nl,en;q=0.5" },
    }, (res) => {
      const ttfb = Date.now() - started;
      const chunks = []; let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), truncated: true, bytes: size, ttfbMs: ttfb, totalMs: Date.now() - started }); return; }
        chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), truncated: false, bytes: size, ttfbMs: ttfb, totalMs: Date.now() - started }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new FetchError("Time-out bij ophalen.", "timeout")));
    req.on("error", (e) => reject(e instanceof FetchError ? e : new FetchError(e.code === "NIET_PUBLIEK" ? "Adres is niet publiek bereikbaar (geblokkeerd)." : e.code === "ENOTFOUND" ? "Domein bestaat niet of is niet bereikbaar." : `Verbinding mislukt (${e.code || e.message}).`, e.code || "net")));
    req.end();
  });
}

export async function fetchPublic(input, { timeoutMs = 10_000, maxBytes = 1_500_000, maxRedirects = 3, userAgent = null } = {}) {
  let u = normalizeUrl(input);
  const chain = [];
  for (let i = 0; i <= maxRedirects; i++) {
    const r = await once(u, { timeoutMs, maxBytes, userAgent });
    chain.push({ url: u.toString(), status: r.status });
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      u = normalizeUrl(new URL(r.headers.location, u).toString());
      continue;
    }
    return { ...r, url: u.toString(), redirects: chain.slice(0, -1) };
  }
  throw new FetchError("Te veel doorverwijzingen.", "redirects");
}

// Minimale robots.txt-controle voor ons user-agent en "*".
export async function robotsAllows(u) {
  try {
    const r = await fetchPublic(`${u.protocol}//${u.host}/robots.txt`, { timeoutMs: 5000, maxBytes: 200_000, maxRedirects: 2 });
    if (r.status >= 400) return { allowed: true, note: "Geen robots.txt gevonden." };
    const groups = []; let cur = null;
    for (const raw of r.body.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, "").trim();
      const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
      if (!m) continue;
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === "user-agent") { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
      else if ((k === "disallow" || k === "allow") && cur) cur.rules.push({ allow: k === "allow", path: v });
    }
    const pick = groups.find(g => g.agents.some(a => a.includes("strakwerkhq"))) || groups.find(g => g.agents.includes("*"));
    if (!pick) return { allowed: true, note: "robots.txt bevat geen regels voor ons." };
    const path = u.pathname || "/";
    let best = null;
    for (const rule of pick.rules) {
      if (!rule.path) continue;
      const p = rule.path.replace(/\*/g, "");
      if (path.startsWith(p) && (!best || p.length > best.p.length || (p.length === best.p.length && rule.allow))) best = { p, allow: rule.allow };
    }
    return best && !best.allow ? { allowed: false, note: `robots.txt verbiedt ${path}.` } : { allowed: true, note: "robots.txt staat het toe." };
  } catch {
    return { allowed: true, note: "robots.txt niet op te halen; alleen de homepage wordt bekeken." };
  }
}

export { isPrivateIp };
