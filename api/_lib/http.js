// Kleine helpers voor functies met de standaard Web Request/Response-signatuur
// (Vercel Node.js-runtime: export function GET(request) { ... }).

const BASE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "same-origin",
};

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status; this.code = code; Object.assign(this, extra);
  }
}

export function json(data, status = 200, headers = {}) {
  const h = new Headers({ ...BASE_HEADERS, "content-type": "application/json; charset=utf-8" });
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) v.forEach(x => h.append(k, x)); else h.set(k, v);
  }
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function errorResponse(e) {
  const status = e.status || 500;
  if (status >= 500 && e.code !== "niet_gekoppeld") {
    // Alleen type en bericht loggen; geen request-inhoud, tokens of persoonsgegevens.
    console.error(`[hq] ${e.code || e.name}: ${String(e.message).slice(0, 300)}`);
  }
  const body = { error: e.code || "serverfout", message: status >= 500 && !e.code ? "Er ging iets mis op de server." : e.message };
  if (e.missing) body.missing = e.missing;
  if (e.details) body.details = e.details;
  return json(body, status);
}

export async function readJson(request, maxBytes = 64 * 1024) {
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new HttpError(413, "te_groot", "Verzoek is te groot.");
  if (!buf.byteLength) return {};
  try { return JSON.parse(new TextDecoder().decode(buf)); }
  catch { throw new HttpError(400, "ongeldige_json", "Ongeldige JSON."); }
}

// CSRF-bescherming voor alles wat iets wijzigt: SameSite-cookies plus een eigen header
// (kan een andere site niet meesturen zonder CORS-toestemming) plus een Origin-controle.
export function assertSameOrigin(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.get("x-hq-request") !== "1") throw new HttpError(403, "csrf", "Verzoek geweigerd (ontbrekende HQ-header).");
  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    let oh = null; try { oh = new URL(origin).host; } catch {}
    if (!host || oh !== host) throw new HttpError(403, "csrf", "Verzoek geweigerd (andere herkomst).");
  }
}

export function parseCookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, { maxAge, httpOnly = true, path = "/", sameSite = "Lax" } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; Secure; SameSite=${sameSite}`;
  if (httpOnly) c += "; HttpOnly";
  if (maxAge != null) c += `; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
  return c;
}

export function clientIp(request) {
  const xf = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";
  return xf.split(",")[0].trim() || "0.0.0.0";
}

// Eenvoudige router voor één functie met meerdere paden (houdt het aantal functies laag).
export function route(path, pattern) {
  const pp = pattern.split("/").filter(Boolean), sp = path.split("/").filter(Boolean);
  if (pp.length !== sp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
    else if (pp[i] !== sp[i]) return null;
  }
  return params;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUuid(v, what = "id") {
  if (!UUID_RE.test(String(v || ""))) throw new HttpError(400, "ongeldig_id", `Ongeldig ${what}.`);
  return v;
}

export function str(v, max = 500) {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  return s ? s.slice(0, max) : null;
}
