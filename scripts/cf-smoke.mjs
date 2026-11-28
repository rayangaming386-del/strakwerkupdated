#!/usr/bin/env node
// Controle van een Cloudflare-omgeving (lokaal via `wrangler dev`, of de echte preview/productie).
//   node scripts/cf-smoke.mjs --base https://<preview>.workers.dev
// Zonder geheimen: statische site, afscherming van /hq en alle API's (moet overal "nee" zijn).
// Met --jwt-secret (alleen lokaal/test) of --cookie "<__Host-sw_hq_at>" (echte sessie): ook
// de ingelogde kant. Met --cron-secret: cron-onderdelen handmatig aanroepen.
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const base = (arg("base") || "http://127.0.0.1:8787").replace(/\/+$/, "");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` · ${detail}` : ""}`); };
const get = (p, init = {}) => fetch(base + p, { redirect: "manual", ...init });

async function main() {
  // ── Statische site ──
  for (const [p, want] of [["/", 200], ["/werk/vagpro", 200], ["/diensten", 200], ["/prijzen", 200], ["/kennisbank", 200], ["/websitecheck", 200], ["/login", 200], ["/intake", 200], ["/offerte", 200]]) {
    const r = await get(p); check(`pagina ${p}`, r.status === want, `HTTP ${r.status}`);
  }
  { const r = await get("/service-pro"); check("oude URL stuurt permanent door", [301, 308].includes(r.status) && r.headers.get("location")?.endsWith("/prijzen"), `${r.status} → ${r.headers.get("location")}`); }
  { const r = await get("/bestaat-niet-xyz"); check("onbekende pagina geeft 404", r.status === 404, `HTTP ${r.status}`); }
  { const r = await get("/login"); check("/login heeft CSP en noindex", Boolean(r.headers.get("content-security-policy")) && /noindex/.test(r.headers.get("x-robots-tag") || "")); }
  { const r = await get("/intake"); check("/intake lekt geen token via referrer", r.headers.get("referrer-policy") === "no-referrer"); }
  { const r = await get("/offerte"); check("/offerte lekt geen token via referrer", r.headers.get("referrer-policy") === "no-referrer"); }
  // De pagina's laden het Vercel-analysescript; op Cloudflare staat er een leeg vervangscript (geen 404 in de console).
  { const r = await get("/_vercel/insights/script.js"); check("geen 404 voor het oude analysescript", r.status === 200 && /javascript/.test(r.headers.get("content-type") || ""), `HTTP ${r.status} ${r.headers.get("content-type")}`); }

  // ── Niets privés publiek ──
  for (const p of ["/package.json", "/vercel.json", "/wrangler.toml", "/CLAUDE.md", "/middleware.js", "/api/_lib/db.js", "/api/_lib/env.js", "/worker/index.js", "/db/migrations/001_hq.sql",
    "/docs/hq/installatie.md", "/tools/site_common.py", "/scripts/migrate.mjs", "/.env", "/.dev.vars", "/hq/index.html", "/hq/assets/app.js", "/%68q/assets/app.js", "/HQ/assets/app.js", "/hq%2Fassets%2Fapp.js"]) {
    const r = await get(p);
    const body = r.status === 200 ? await r.text() : "";
    const leak = r.status === 200 && /import |DATABASE_URL|export default|create table|"dependencies"/.test(body);
    check(`niet publiek: ${p}`, !leak && (r.status !== 200 || /<!doctype html/i.test(body)), `HTTP ${r.status}`);
  }

  // ── /hq zonder (geldige) sessie ──
  for (const p of ["/hq", "/hq/vandaag", "/hq/assets/app.js", "/hq/assets/views/kantoor.js"]) {
    const r = await get(p); check(`afgeschermd zonder sessie: ${p}`, r.status === 307 && /\/api\/auth\/refresh/.test(r.headers.get("location") || ""), `HTTP ${r.status}`);
  }
  { const r = await get("/hq/assets/app.js", { headers: { cookie: "__Host-sw_hq_at=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.ongeldig" } }); check("vervalste sessie geweigerd voor /hq", r.status === 307); }

  // ── API's zonder sessie of geheim ──
  for (const [p, m] of [["/api/hq/vandaag", "GET"], ["/api/hq/klanten", "GET"], ["/api/hq/kantoor", "GET"], ["/api/hq/overview", "GET"], ["/api/auth/me", "GET"]]) {
    const r = await get(p, { method: m }); check(`API weigert zonder sessie: ${p}`, r.status === 401, `HTTP ${r.status}`);
  }
  { const r = await get("/api/hq/opdracht", { method: "POST", headers: { "content-type": "application/json", origin: "https://kwaad.example" }, body: "{}" }); check("API weigert POST van andere site", [401, 403].includes(r.status), `HTTP ${r.status}`); }
  { const r = await get("/api/worker"); check("cron-ingang weigert zonder geheim", r.status === 401, `HTTP ${r.status}`); }
  { const r = await get("/api/worker?part=taken", { headers: { authorization: "Bearer fout-geheim-0123456789" } }); check("cron-ingang weigert fout geheim", r.status === 401, `HTTP ${r.status}`); }
  { const r = await get("/api/public/inbound", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); check("mail-ingang weigert zonder geheim", r.status === 401, `HTTP ${r.status}`); }
  { const r = await get("/api/public/aanvraag", { method: "POST", headers: { "content-type": "application/json", origin: "https://kwaad.example" }, body: "{}" }); check("formulier weigert andere site", r.status === 403, `HTTP ${r.status}`); }
  { const r = await get(`/api/public/intake?t=${"0".repeat(48)}`); check("intake met onbekende link geweigerd", r.status === 404, `HTTP ${r.status}`); }
  { const r = await get("/api/public/afmelden?t=nep.nep"); check("afmeldlink wordt gecontroleerd", r.status === 400, `HTTP ${r.status}`); }
  { const r = await get("/api/public/websitecheck", { method: "POST", headers: { "content-type": "application/json", origin: "https://kwaad.example" }, body: "{}" }); check("websitecheck weigert andere site", r.status === 403, `HTTP ${r.status}`); }
  { const r = await get(`/api/public/websitecheck?t=${"A".repeat(32)}`); check("websitecheck met onbekende link geweigerd", r.status === 404, `HTTP ${r.status}`); }
  { const r = await get(`/api/public/offerte?t=00000000-0000-4000-8000-000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAA`); check("offerte met onbekende link geweigerd", r.status === 404, `HTTP ${r.status}`); }
  { const r = await get("/voorbeeld/bestaat-niet-1234567"); check("onbekende voorbeeldsite geeft 404 (noindex)", r.status === 404 && /noindex/.test(r.headers.get("x-robots-tag") || ""), `HTTP ${r.status}`); }
  { const r = await get("/api/onbekend"); check("onbekende API geeft 404", r.status === 404, `HTTP ${r.status}`); }

  // ── Ingelogd (alleen met een geldige sessie) ──
  let cookie = arg("cookie") ? `__Host-sw_hq_at=${arg("cookie")}` : null;
  if (!cookie && arg("jwt-secret")) {
    const { SignJWT } = await import("jose");
    const tok = await new SignJWT({ email: arg("email") || "demo@strakwerk.local", role: "authenticated", aal: "aal2", session_id: crypto.randomUUID() })
      .setProtectedHeader({ alg: "HS256" }).setSubject(arg("user") || "00000000-0000-4000-8000-00000000d001").setIssuer(`${arg("supabase-url")}/auth/v1`).setAudience("authenticated").setIssuedAt().setExpirationTime("1h")
      .sign(new TextEncoder().encode(arg("jwt-secret")));
    cookie = `__Host-sw_hq_at=${tok}`;
  }
  if (cookie) {
    const H = { cookie };
    { const r = await get("/hq", { headers: H }); const t = await r.text(); check("/hq met sessie", r.status === 200 && /StrakWerk HQ/i.test(t), `HTTP ${r.status}`); }
    { const r = await get("/hq/assets/views/vandaag.js", { headers: H }); check("HQ-script met sessie", r.status === 200 && /export async function mount/.test(await r.text())); }
    for (const p of ["vandaag", "klanten", "kantoor", "overview", "studio/overview"]) { const r = await get(`/api/hq/${p}`, { headers: H }); check(`API met sessie: ${p}`, r.status === 200, `HTTP ${r.status}`); }
    { const r = await get("/api/hq/opdracht", { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ text: "x" }) }); check("POST zonder HQ-header geweigerd (CSRF)", r.status === 403, `HTTP ${r.status}`); }
  }

  // ── Cron (alleen met het geheim) ──
  if (arg("cron-secret")) {
    for (const part of ["bewaren", "content", "klant", "taken"]) {
      const r = await get(`/api/worker?part=${part}`, { method: "POST", headers: { authorization: `Bearer ${arg("cron-secret")}` } });
      const j = await r.json().catch(() => ({}));
      check(`cron-onderdeel ${part}`, r.status === 200 && j.ok, `HTTP ${r.status}${j.message ? ` ${j.message}` : ""}`);
    }
  }
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} geslaagd`);
  process.exit(bad.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
