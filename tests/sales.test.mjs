// Tests voor de salesmotor: offertepagina met akkoord en aanbetaling, meldingen (nooit dubbel,
// stille uren, testgegevens nooit per e-mail), voorbeeldsite, bel- en bezoeklijst, toestemming
// na een gesprek, gratis websitecheck en bestaande klanten. Nagebootst: Supabase Auth, Gmail
// (Google), Claude, OpenStreetMap en websites. Geen echte accounts of berichten.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { SignJWT } from "jose";

const BASE_DB = process.env.TEST_DATABASE_URL || "postgres://postgres@127.0.0.1:54329/postgres";
const DB_NAME = `hq_sales_${process.pid}`;
const JWT_SECRET = "test-jwt-secret-dat-lang-genoeg-is-0123456789";
let server, base, fakeAuth, google, claude, site, sitePort, mods = {};
const owner = { id: randomUUID(), email: "eigenaar@test.nl", role: "eigenaar", aal: "aal2" };
const staff = { id: randomUUID(), email: "medewerker@test.nl", role: "medewerker", aal: "aal1" };
const sign = (u) => new SignJWT({ email: u.email, role: "authenticated", aal: u.aal, session_id: randomUUID() })
  .setProtectedHeader({ alg: "HS256" }).setSubject(u.id).setIssuer(`${process.env.SUPABASE_URL}/auth/v1`).setAudience("authenticated").setIssuedAt().setExpirationTime("1h")
  .sign(new TextEncoder().encode(JWT_SECRET));
async function req(p, { method = "GET", user = owner, body, headers = {}, anon = false } = {}) {
  const h = { ...headers };
  if (!anon) h.cookie = `__Host-sw_hq_at=${await sign(user)}`;
  if (method !== "GET" && !anon) { h["x-hq-request"] = "1"; h.origin = base; }
  if (body !== undefined) h["content-type"] = "application/json";
  const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch {}
  return { status: r.status, json, text: t, headers: r.headers };
}
const one = async (sql, v = []) => (await mods.db.q(sql, v)).rows[0];
const pub = (p, opts = {}) => req(p, { anon: true, ...opts, headers: { origin: base, ...(opts.headers || {}) } });

// Nagebootste Google (Gmail API) en Claude.
const mails = [];
const claudeCalls = [];
let claudeReply = null; // functie (body) => object (JSON-antwoord van het model) of null = fout

before(async () => {
  const admin = new pg.Client({ connectionString: BASE_DB }); await admin.connect();
  await admin.query(`drop database if exists ${DB_NAME}`); await admin.query(`create database ${DB_NAME}`); await admin.end();
  const dbUrl = BASE_DB.replace(/\/[^/]*$/, `/${DB_NAME}`);
  fakeAuth = http.createServer((rq, rs) => { rs.writeHead(404); rs.end(); });
  await new Promise(r => fakeAuth.listen(0, "127.0.0.1", r));
  google = http.createServer(async (rq, rs) => {
    let body = ""; for await (const c of rq) body += c;
    const send = (code, j) => { rs.writeHead(code, { "content-type": "application/json" }); rs.end(JSON.stringify(j)); };
    if (rq.url === "/token") return send(200, { access_token: "at-1", expires_in: 3600 });
    if (rq.url === "/gmail/v1/users/me/messages/send") { mails.push(Buffer.from(JSON.parse(body).raw, "base64url").toString("utf8")); return send(200, { id: `g${mails.length}` }); }
    send(404, {});
  });
  await new Promise(r => google.listen(0, "127.0.0.1", r));
  claude = http.createServer(async (rq, rs) => {
    let body = ""; for await (const c of rq) body += c;
    const b = JSON.parse(body || "{}");
    claudeCalls.push(b);
    const out = claudeReply ? claudeReply(b) : null;
    if (!out) { rs.writeHead(500, { "content-type": "application/json" }); return rs.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "nep-fout" } })); }
    rs.writeHead(200, { "content-type": "application/json" });
    rs.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: JSON.stringify(out) }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 500 } }));
  });
  await new Promise(r => claude.listen(0, "127.0.0.1", r));
  // Nep-website van een kapsalon (voor de websitecheck en de bellijst).
  site = http.createServer((rq, rs) => {
    if (rq.url === "/robots.txt") { rs.writeHead(200); return rs.end("User-agent: *\nAllow: /\n"); }
    if (rq.url === "/") { rs.writeHead(200, { "content-type": "text/html" }); return rs.end(`<!doctype html><html><head><title>Kapsalon Lotus</title></head><body><h1>Kapsalon Lotus</h1><a href="/afspraak">Afspraak maken</a><footer>© 2019 Kapsalon Lotus B.V. · Website door Bureau Voorbeeld B.V.</footer></body></html>`); }
    rs.writeHead(404); rs.end("niet gevonden");
  });
  await new Promise(r => site.listen(0, "127.0.0.1", r));
  sitePort = site.address().port;
  Object.assign(process.env, {
    DATABASE_URL: dbUrl, SUPABASE_URL: `http://127.0.0.1:${fakeAuth.address().port}`, SUPABASE_PUBLISHABLE_KEY: "test-publishable",
    SUPABASE_JWT_SECRET: JWT_SECRET, CRON_SECRET: "test-cron-0123456789", HQ_TEST_MODE: "1", HQ_STORAGE: "local", HQ_ENCRYPTION_KEY: "test-enc-0123456789abcdef",
    HQ_MEDIA_DIR: mkdtempSync(path.join(tmpdir(), "hq-media-")),
    GMAIL_CLIENT_ID: "cid", GMAIL_CLIENT_SECRET: "cs", GMAIL_REFRESH_TOKEN: "rt", GMAIL_API_BASE: `http://127.0.0.1:${google.address().port}`, GMAIL_TOKEN_URL: `http://127.0.0.1:${google.address().port}/token`,
    ANTHROPIC_API_KEY: "test-sleutel", ANTHROPIC_BASE_URL: `http://127.0.0.1:${claude.address().port}`,
  });
  for (const k of ["SUPABASE_SECRET_KEY", "IG_APP_ID", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "BUFFER_API_KEY", "MAIL_REPLY_TO"]) delete process.env[k];
  const { migrate } = await import("../scripts/migrate.mjs");
  await migrate(dbUrl, { log: () => {} });
  mods.db = await import("../api/_lib/db.js");
  mods.worker = await import("../api/_lib/worker.js");
  mods.notify = await import("../api/_lib/klant/notify.js");
  mods.plan = await import("../api/_lib/klant/planning.js");
  (await import("../api/_lib/agents/fetcher.js")).__setTestNetwork({ strict: true, hosts: { "kapsalon-lotus.nl": "127.0.0.1" } });
  for (const u of [owner, staff]) await mods.db.q("insert into hq.members (user_id, email, role, status) values ($1,$2,$3,'actief')", [u.id, u.email, u.role]);
  // Geen stille uren in de tests (anders hangt de uitkomst af van het tijdstip waarop ze draaien).
  await mods.db.q("insert into hq.settings (key, value) values ('availability', $1) on conflict (key) do update set value=excluded.value", [{ quiet_from: "00:00", quiet_to: "00:00" }]);
  const { createServer } = await import("../scripts/dev-server.mjs");
  server = createServer();
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await mods.db?.closePool();
  for (const s of [server, fakeAuth, google, claude, site]) s?.close();
  const admin = new pg.Client({ connectionString: BASE_DB }); await admin.connect();
  await admin.query(`drop database if exists ${DB_NAME} with (force)`); await admin.end();
});

const drain = async () => {
  for (let i = 0; i < 20; i++) {
    await mods.db.q("update hq.tasks set run_after=now() where status='in_wachtrij' and agent_key not in ('video','publisher')");
    await mods.worker.runWorker({ source: "test", budgetMs: 60_000 });
    if (!(await one("select count(*)::int n from hq.tasks where agent_key not in ('video','publisher') and status in ('in_wachtrij','bezig')")).n) return;
  }
};

let leadQ, quoteId, quoteUrl;

test("instellingen: IBAN wordt gecontroleerd, aanbetaling 50% standaard", async () => {
  assert.equal((await req("/api/hq/kantoor/instellingen/payment", { method: "PUT", body: { iban: "NL91ABNA0417164301" } })).status, 400, "fout controlecijfer");
  assert.equal((await req("/api/hq/kantoor/instellingen/payment", { method: "PUT", user: staff, body: { iban: "NL91ABNA0417164300" } })).status, 403, "alleen de eigenaar");
  const r = await req("/api/hq/kantoor/instellingen/payment", { method: "PUT", body: { iban: "nl91 abna 0417 1643 00", account_name: "StrakWerk" } });
  assert.equal(r.status, 200); assert.equal(r.json.payment.iban, "NL91 ABNA 0417 1643 00");
  const s = await one("select value from hq.settings where key='payment'");
  assert.equal(s.value.deposit_pct, 50);
  const cap = await one("select value->'capacity' as c from hq.settings where key='sales'");
  assert.deepEqual(cap.c, { max_projects: 6, days_per_project: 3 }, "realistische standaardcapaciteit (opleveren < 4 uur)");
});

test("offertepagina: bekijken telt (niet als Rayan kijkt), akkoord met naam en vinkje, aanbetaling en intake-link", async () => {
  const a = await pub("/api/public/aanvraag", { method: "POST", body: { name: "Mila Jansen", company: "Salon Mila", email: "mila@salon-mila.nl", phone: "0612345678", message: "Ik wil een website met online afspraken.", form_id: "form-sales-0001" } });
  assert.equal(a.status, 200);
  leadQ = (await one("select id, sales_channel from hq.leads where contact_email='mila@salon-mila.nl'"));
  assert.equal(leadQ.sales_channel, "formulier");
  const n1 = await one("select * from hq.notifications where kind='aanvraag' and lead_id=$1", [leadQ.id]);
  assert.ok(n1, "melding bij een nieuwe aanvraag");
  const qr = await req(`/api/hq/klanten/${leadQ.id}/offerte`, { method: "POST", body: {} });
  quoteId = qr.json.id;
  await mods.db.q("update hq.quotes set terms='Voorwaarden StrakWerk (test)' where id=$1", [quoteId]);
  // Concept heeft nog geen openbare link.
  assert.equal((await req(`/api/hq/offertes/${quoteId}/link`)).status, 409);
  const sq = await req(`/api/hq/offertes/${quoteId}/versturen`, { method: "POST", body: { interest: true } });
  assert.equal(sq.status, 200); assert.match(sq.json.url, /^\/offerte\?t=[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/);
  quoteUrl = sq.json.url;
  const qu = await one("select * from hq.quotes where id=$1", [quoteId]);
  assert.equal(qu.deposit_pct, 50); assert.equal(qu.deposit_cents, Math.round(qu.price_cents / 2));
  assert.ok(new Date(qu.valid_until) > new Date(Date.now() + 13 * 864e5), "14 dagen geldig");
  const t = new URL(quoteUrl, base).searchParams.get("t");
  // Vervalste of onbekende link.
  assert.equal((await pub(`/api/public/offerte?t=${encodeURIComponent(t.slice(0, -2) + "xx")}`)).status, 404);
  assert.equal((await pub(`/api/public/offerte?t=${randomUUID()}.AAAAAAAAAAAAAAAAAAAAAAAAAA`)).status, 404);
  // Rayan bekijkt zelf (met HQ-sessie): telt niet.
  const own = await req(`/api/public/offerte?t=${encodeURIComponent(t)}`);
  assert.equal(own.status, 200); assert.equal((await one("select view_count from hq.quotes where id=$1", [quoteId])).view_count, 0);
  // De klant bekijkt hem.
  const v = await pub(`/api/public/offerte?t=${encodeURIComponent(t)}`);
  assert.equal(v.status, 200);
  assert.equal(v.json.company, "Salon Mila"); assert.equal(v.json.deposit_pct, 50);
  assert.equal(v.json.total_eur, qu.price_cents / 100); assert.equal(v.json.deposit_eur, qu.deposit_cents / 100);
  assert.equal(v.json.payment, null, "betaalgegevens pas na akkoord");
  assert.equal(v.json.accepted, null);
  await pub(`/api/public/offerte?t=${encodeURIComponent(t)}`);
  assert.equal((await one("select view_count from hq.quotes where id=$1", [quoteId])).view_count, 2);
  assert.equal((await one("select count(*)::int n from hq.notifications where key=$1", [`offerte_bekeken:${quoteId}`])).n, 1, "één melding bij de eerste keer bekijken");
  // De pagina zelf heeft strenge headers.
  const page = await fetch(`${base}/offerte?t=x`);
  assert.equal(page.status, 200); assert.equal(page.headers.get("referrer-policy"), "no-referrer"); assert.match(page.headers.get("x-robots-tag"), /noindex/);
  // Akkoord: andere site geweigerd, zonder vinkje of naam geweigerd.
  assert.equal((await pub(`/api/public/offerte?t=${encodeURIComponent(t)}`, { method: "POST", headers: { origin: "https://kwaad.example" }, body: { name: "x", agree: true } })).status, 403);
  assert.equal((await pub(`/api/public/offerte?t=${encodeURIComponent(t)}`, { method: "POST", body: { name: "Mila Jansen", agree: false } })).status, 400);
  assert.equal((await pub(`/api/public/offerte?t=${encodeURIComponent(t)}`, { method: "POST", body: { name: "", agree: true } })).status, 400);
  const acc = await pub(`/api/public/offerte?t=${encodeURIComponent(t)}`, { method: "POST", body: { name: "Mila Jansen", agree: true } });
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  assert.equal(acc.json.accepted.name, "Mila Jansen");
  assert.equal(acc.json.payment.iban, "NL91 ABNA 0417 1643 00"); assert.equal(acc.json.payment.amount_eur, qu.deposit_cents / 100);
  assert.match(acc.json.payment.reference, /^SW-[0-9A-F]{8}$/);
  assert.match(acc.json.intake_url, /^\/intake\?t=[a-f0-9]{48}$/, "intake-link direct na akkoord");
  const q2 = await one("select status, accepted_via, accepted_name from hq.quotes where id=$1", [quoteId]);
  assert.deepEqual(q2, { status: "geaccepteerd", accepted_via: "klant_online", accepted_name: "Mila Jansen" });
  // Nogmaals akkoord (dubbelklik, terugknop): zelfde uitkomst, geen tweede project of melding.
  const acc2 = await pub(`/api/public/offerte?t=${encodeURIComponent(t)}`, { method: "POST", body: { name: "Mila Jansen", agree: true } });
  assert.equal(acc2.status, 200); assert.equal(acc2.json.intake_url, acc.json.intake_url);
  assert.equal((await one("select count(*)::int n from hq.projects where lead_id=$1", [leadQ.id])).n, 1);
  assert.equal((await one("select count(*)::int n from hq.notifications where key=$1", [`offerte_akkoord:${quoteId}`])).n, 1);
  // De intake-link werkt echt, en HQ kan hem later opnieuw tonen (zelfde link).
  assert.equal((await pub(acc.json.intake_url.replace("/intake?", "/api/public/intake?"))).status, 200);
  assert.equal((await req(`/api/hq/offertes/${quoteId}/akkoord`, { method: "POST", body: {} })).json.intake_url, acc.json.intake_url);
});

test("meldingen: per e-mail naar de eigenaar, nooit dubbel; testgegevens en stille uren gaan niet per mail", async () => {
  // (Een deel kan al op de achtergrond verstuurd zijn, vlak na het ontstaan van de melding.)
  await mods.notify.flushNotifications();
  const subject = (m) => { const s = (m.match(/^Subject: (.*)$/m) || [])[1] || ""; const e = s.match(/^=\?UTF-8\?B\?(.+)\?=$/); return e ? Buffer.from(e[1], "base64").toString("utf8") : s; };
  const subjects = mails.map(subject);
  for (const want of ["HQ: Nieuwe aanvraag: Salon Mila", "HQ: Salon Mila bekijkt je offerte", "HQ: Akkoord: Salon Mila"])
    assert.equal(subjects.filter(s => s.startsWith(want)).length, 1, `precies één mail: ${want} (${JSON.stringify(subjects)})`);
  assert.ok(mails.every(m => /^To: eigenaar@test\.nl$/m.test(m)), "naar de eigenaar");
  const before = mails.length;
  assert.equal(await mods.notify.flushNotifications(), 0, "niets dubbel");
  assert.equal(mails.length, before);
  // Testgegevens: alleen in HQ.
  await mods.notify.notify({ key: "test:1", kind: "test", title: "Test", isTest: true });
  await mods.notify.flushNotifications();
  assert.equal((await one("select send_error from hq.notifications where key='test:1'")).send_error, "testgegevens: alleen in HQ");
  // Stille uren: melding wacht tot het einde ervan.
  await mods.db.q("update hq.settings set value=$1 where key='availability'", [{ quiet_from: "00:00", quiet_to: "23:59" }]);
  await mods.notify.notify({ key: "stil:1", kind: "test", title: "Stil" });
  const st = await one("select deliver_after from hq.notifications where key='stil:1'");
  await mods.db.q("update hq.settings set value=$1 where key='availability'", [{ quiet_from: "00:00", quiet_to: "00:00" }]);
  const wasQuiet = new Date(st.deliver_after) > new Date(Date.now() + 60_000);
  const nowM = new Date().toLocaleString("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (nowM < "23:59") assert.ok(wasQuiet, "binnen de stille uren: later versturen");
  // In HQ: lijst met ongelezen meldingen.
  const ml = (await req("/api/hq/meldingen")).json;
  assert.ok(ml.ongelezen >= 3); assert.equal(ml.email, "eigenaar@test.nl");
  await req("/api/hq/meldingen/gelezen", { method: "POST", body: {} });
  assert.equal((await req("/api/hq/meldingen")).json.ongelezen, 0);
});

test("aanbetaling en verlopen offertes in het ochtendoverleg; verlengen met één klik; na afwijzen een nieuwe offerte", async () => {
  // Akkoord van gisteren, aanbetaling nog niet vastgelegd → actie.
  await mods.db.q("update hq.quotes set accepted_at = now() - interval '2 days' where id=$1", [quoteId]);
  let m = await mods.plan.runMeeting({ force: true });
  const acts = async () => (await mods.db.q("select source_key from hq.actions where briefing_id=$1 and status in ('open','opgepakt')", [m.briefing.id])).rows.map(r => r.source_key);
  assert.ok((await acts()).includes(`aanbetaling:${quoteId}`));
  // Aanbetaling vastleggen (soort automatisch: aanbetaling) → project kan starten, actie weg.
  const pay = await req(`/api/hq/klanten/${leadQ.id}/betaling`, { method: "POST", body: { amount_eur: 100, quote_id: quoteId } });
  assert.equal(pay.json.kind, "aanbetaling");
  assert.ok((await one("select deposit_paid_at from hq.projects where lead_id=$1", [leadQ.id])).deposit_paid_at);
  m = await mods.plan.runMeeting({ force: true });
  assert.ok(!(await acts()).includes(`aanbetaling:${quoteId}`));
  // Tweede klant: offerte verloopt → actie → verlengen → weer geldig.
  const b = await req("/api/hq/klanten", { method: "POST", body: { company: "Garage Noord", name: "Ali", phone: "0611111111", message: "Website met kentekencheck graag" } });
  const q2 = (await req(`/api/hq/klanten/${b.json.lead_id}/offerte`, { method: "POST", body: {} })).json.id;
  await mods.db.q("update hq.quotes set terms='x' where id=$1", [q2]);
  const s2 = await req(`/api/hq/offertes/${q2}/versturen`, { method: "POST", body: {} });
  await mods.db.q("update hq.quotes set valid_until = now() - interval '1 hour' where id=$1", [q2]);
  const t2 = new URL(s2.json.url, base).searchParams.get("t");
  const v = await pub(`/api/public/offerte?t=${encodeURIComponent(t2)}`);
  assert.equal(v.json.expired, true);
  assert.equal((await pub(`/api/public/offerte?t=${encodeURIComponent(t2)}`, { method: "POST", body: { name: "Ali", agree: true } })).status, 410);
  m = await mods.plan.runMeeting({ force: true });
  assert.ok((await acts()).includes(`offerte_verlopen:${q2}`));
  const ext = await req(`/api/hq/offertes/${q2}/verlengen`, { method: "POST", body: {} });
  assert.equal(ext.status, 200); assert.ok(new Date(ext.json.valid_until) > new Date(Date.now() + 13 * 864e5));
  assert.equal((await pub(`/api/public/offerte?t=${encodeURIComponent(t2)}`)).json.expired, false);
  // Afgewezen → een nieuwe offerte met dezelfde inhoud kan weer (geen "dubbel").
  await req(`/api/hq/quotes/${q2}/status`, { method: "POST", body: { status: "afgewezen" } });
  await mods.db.q("update hq.quotes set status='afgewezen' where id=$1", [q2]);
  assert.equal((await pub(`/api/public/offerte?t=${encodeURIComponent(t2)}`)).status, 410, "afgewezen offerte is niet meer geldig");
  const again = await req(`/api/hq/klanten/${b.json.lead_id}/offerte`, { method: "POST", body: {} });
  assert.equal(again.status, 201); assert.equal(again.json.duplicate, false); assert.notEqual(again.json.id, q2);
  const dup = await req(`/api/hq/klanten/${b.json.lead_id}/offerte`, { method: "POST", body: {} });
  assert.equal(dup.json.duplicate, true, "lopend concept: wel dubbel");
});

// ── Fase 1d: voorbeeldsite, bel- en bezoeklijst, toestemming na gesprek ─────────
const aiOn = async () => {
  const now = Date.now();
  await req("/api/hq/ai/budget", { method: "PUT", body: { period_start: new Date(now - 864e5).toISOString(), period_end: new Date(now + 20 * 864e5).toISOString(), granted_usd: 100, hq_limit_usd: 85, confirmed: true, enabled: true } });
};
// Nep-Claude: geeft bewust ook verzonnen claims terug; de controle moet die tegenhouden.
const fakeAi = (b) => {
  const sys = JSON.stringify(b.system || "");
  if (/VOORBEELD-homepage/.test(sys)) return { kop: "Kapsalon Lotus: al 20 jaar de beste in Den Haag", subkop: "Plan je afspraak online, wanneer het jou uitkomt.", cta: "Plan je afspraak",
    diensten: [{ naam: "Knippen", tekst: "Voor dames, heren en kinderen." }, { naam: "Kleuren", tekst: "Van subtiel tot opvallend." }, { naam: "Föhnen en stylen", tekst: "Voor elke gelegenheid." }],
    waarom: ["Persoonlijke aandacht", "Lees onze reviews", "Makkelijk online plannen"], over: "Een gezellige salon in de buurt waar je je thuis voelt." };
  if (/belletje/.test(sys)) return { opening: "Hoi, met Rayan van StrakWerk. Ik zag dat jullie afspraakknop niet werkt.", vragen: ["Hoe boeken klanten nu?", "Hoeveel klanten mis je per week?", "Wat wil je verbeteren?"],
    bezwaren: [{ bezwaar: "Geen tijd", antwoord: "Ik stuur je een voorbeeld." }, { bezwaar: "Te duur", antwoord: "Het kost maar 99 euro." }, { bezwaar: "Heb al Instagram", antwoord: "Een site helpt mensen die je zoeken." }, { bezwaar: "Ik heb al een site", antwoord: "Ik laat zien wat beter kan." }],
    afsluiter: "Mag ik je een voorbeeld appen?" };
  if (/persoonlijk bericht/.test(sys)) return { tekst: "Leuk je net te spreken! Zoals beloofd een voorbeeld van je nieuwe site." };
  return null;
};
let callLead, visitLead, previewSlug;

test("bellijst en bezoeklijst: bellen alleen waar het mag (rechtsvorm), langsgaan alleen bij echte potentie; belcoach met echte prijzen", async () => {
  claudeReply = fakeAi; await aiOn();
  const ins = (vals) => mods.db.q(`insert into hq.leads (company, company_key, source, status, segment, city, contact_phone, address, priority, fit_score, website, website_status, active_status, priority_reason, legal_form, legal_form_source)
    values ($1,$2,'scout_osm','nieuw',$3,$4,$5,$6,$7,$8,$9,$10,$11,'test',$12,$13) returning id`, vals).then(r => r.rows[0].id);
  // Rechtsvorm van de eigen site: "© 2019 Kapsalon Lotus B.V." telt, "Website door Bureau Voorbeeld B.V." niet.
  const { websiteStatus } = await import("../api/_lib/klant/discover.js");
  const ws = await websiteStatus({ name: "Kapsalon Lotus", city: "Den Haag", website: `http://kapsalon-lotus.nl:${sitePort}/` });
  assert.deepEqual([ws.status, ws.legal?.form, ws.legal?.source, ws.legal?.evidence], ["gevonden", "bv", "website", "kapsalon lotus b.v."]);
  callLead = await ins(["Kapsalon Lotus", "kapsalon-lotus", "salons", "Den Haag", "+31701112233", "Lotusstraat 1, 2500 AA Den Haag", "hoog", 85, `http://kapsalon-lotus.nl:${sitePort}/`, "gevonden", "actief", ws.legal.form, ws.legal.source]);
  await mods.db.q("insert into hq.opportunities (lead_id, page_url, goal, observation, evidence, strength, service_key, service_text) values ($1,$2,'afspraak','De link \"Afspraak maken\" op de homepage gaat op mobiel naar een foutpagina (HTTP 404).','{}','concreet','booking','Afspraken plannen')", [callLead, `http://kapsalon-lotus.nl:${sitePort}/afspraak`]);
  // Veel potentie maar geen telefoonnummer: direct langsgaan.
  visitLead = await ins(["Barbier Zuid", "barbier-zuid", "salons", "Den Haag", null, "Zuidstraat 9, 2500 BB Den Haag", "hoog", 80, null, "geen_gevonden", "actief", null, null]);
  // Eenmanszaak met nummer en potentie: niet ongevraagd bellen (Telecommunicatiewet), wel langsgaan.
  await ins(["Kapper Om De Hoek", "kapper-om-de-hoek", "salons", "Den Haag", "+31706667788", "Hoekstraat 2, 2500 CC Den Haag", "hoog", 78, null, "geen_gevonden", "actief", "eenmanszaak", "kvk"]);
  // Rechtsvorm onbekend: niet bellen; zonder adres ook niet langsgaan.
  await ins(["Garage Twijfel", "garage-twijfel", "autobedrijven", "Zoetermeer", "+31793334455", null, "middel", 50, null, "onzeker", "onzeker", null, null]);
  // Bv (herkend aan de naam), prioriteit middel: bellen mag.
  await ins(["Autobedrijf Noord B.V.", "autobedrijf-noord-bv", "autobedrijven", "Zoetermeer", "+31795556677", null, "middel", 55, null, "geen_gevonden", "actief", "bv", "naam"]);
  await ins(["Oude Kapper", "oude-kapper", "salons", "Den Haag", "+31704445566", "Oud 1, Den Haag", "laag", 10, null, "geen_gevonden", "gesloten", null, null]); // niets
  // Bv gisteren zonder gehoor: vandaag niet opnieuw bellen en ook niet langsgaan (eerst bellen).
  const gisteren = "(now() at time zone 'Europe/Amsterdam')::date - 1";
  const stil = await ins(["Salon Stil B.V.", "salon-stil-bv", "salons", "Den Haag", "+31707778899", "Stil 3, 2500 DD Den Haag", "hoog", 75, null, "geen_gevonden", "actief", "bv", "naam"]);
  await mods.db.q(`insert into hq.calls (lead_id, day, kind, briefing, outcome, done_at) values ($1, ${gisteren}, 'bellen', '{}', 'geen_gehoor', now())`, [stil]);
  // Bv met interesse aan de telefoon: nu wel langsgaan.
  const warm = await ins(["Salon Warm B.V.", "salon-warm-bv", "salons", "Den Haag", "+31708889900", "Warm 4, 2500 EE Den Haag", "hoog", 70, null, "geen_gevonden", "actief", "bv", "naam"]);
  await mods.db.q(`insert into hq.calls (lead_id, day, kind, briefing, outcome, done_at) values ($1, ${gisteren}, 'bellen', '{}', 'interesse', now())`, [warm]);
  await mods.db.q("update hq.settings set value = value || '{\"calls_per_day\": 3, \"visits_per_day\": 5}'::jsonb where key='sales_ai'");
  const r = await req("/api/hq/bellijst/maken", { method: "POST", body: { force: true } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const v = (await req("/api/hq/vandaag")).json;
  const callNames = v.calls.map(c => c.company), visitNames = v.visits.map(c => c.company);
  assert.deepEqual(callNames.sort(), ["Autobedrijf Noord B.V.", "Kapsalon Lotus"].sort(), `bellen alleen bij een rechtspersoon (ruimte voor 3): ${callNames}`);
  assert.deepEqual(visitNames, ["Barbier Zuid", "Kapper Om De Hoek", "Salon Warm B.V."], `langsgaan alleen bij echte potentie: ${visitNames}`);
  assert.ok(!callNames.includes("Oude Kapper") && !visitNames.includes("Oude Kapper"));
  const c = v.calls.find(x => x.company === "Kapsalon Lotus");
  assert.match(c.briefing.voorstel, /€\d+/, "voorstel met prijs uit de prijslijst");
  assert.match(c.briefing.aanleiding, /foutpagina \(HTTP 404\)/, "aanleiding met bewijs");
  assert.match(c.briefing.verzet, /niet meer gebeld/, "recht van bezwaar in elk gesprek");
  assert.ok(c.briefing.let_op.some(x => /zichtbare nummer/.test(x)));
  const hoek = v.visits.find(x => x.company === "Kapper Om De Hoek");
  assert.match(hoek.briefing.opening, /Komt het even uit/, "bezoekcoach, geen belscript");
  assert.ok(hoek.briefing.let_op.some(x => /geen verkopers/.test(x)));
  // Klantkaart: waarom (niet) bellen.
  const kc = (await req(`/api/hq/klanten/${(await one("select id from hq.leads where company='Kapper Om De Hoek'")).id}`)).json;
  assert.equal(kc.contact.bellen.allowed, false); assert.match(kc.contact.bellen.reason, /eenmanszaak/);
  assert.equal((await req(`/api/hq/klanten/${callLead}`)).json.contact.bellen.basis, "rechtspersoon");
  // Nogmaals maken: vult alleen aan (geen dubbele regels).
  await req("/api/hq/bellijst/maken", { method: "POST", body: { force: true } });
  assert.equal((await one("select count(*)::int n from hq.calls where lead_id=$1", [callLead])).n, 1);
  // Belcoach met AI: verzonnen claims ("99 euro", "hoeveel klanten") worden vervangen; de prijs blijft uit CONFIG.
  await drain();
  const b = (await one("select briefing, briefing_by from hq.calls where lead_id=$1", [callLead]));
  assert.equal(b.briefing_by, "Claude");
  assert.ok(b.briefing.vragen.every(x => !/\d/.test(x)), "geen cijfers in vragen");
  const duur = b.briefing.bezwaren.find(x => /duur/i.test(x.bezwaar));
  assert.match(duur.antwoord, new RegExp(`€${JSON.parse((await import("node:fs")).readFileSync(new URL("../api/_lib/content/site-data.json", import.meta.url), "utf8")).bases.nieuw.price_eur}`), "echte prijs bij 'te duur'");
  assert.ok(!JSON.stringify(b.briefing).includes("99 euro"), "verzonnen prijs tegengehouden");
});

test("voorbeeldsite: echte gegevens, claims tegengehouden, niet vindbaar, telt alleen echte bezoekers, melding bij eerste keer", async () => {
  const r = await req(`/api/hq/klanten/${callLead}/voorbeeld`, { method: "POST", body: {} });
  assert.equal(r.status, 201);
  await drain();
  const card = (await req(`/api/hq/klanten/${callLead}`)).json;
  assert.ok(card.preview, JSON.stringify(card.preview_task));
  previewSlug = card.preview.slug;
  assert.match(previewSlug, /^kapsalon-lotus-[a-f0-9]{7}$/);
  const page = await fetch(`${base}/voorbeeld/${previewSlug}`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(page.headers.get("x-robots-tag"), /noindex/); assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(html, /Voorbeeld door <a[^>]*>StrakWerk<\/a> voor Kapsalon Lotus/);
  assert.ok(!/al 20 jaar|de beste|reviews/i.test(html.replace(/<style>[\s\S]*?<\/style>/, "")), "verzonnen claims niet op de pagina");
  assert.match(html, /Plan je afspraak online/, "goede AI-tekst blijft");
  assert.match(html, /tel:\+31701112233/, "echt telefoonnummer uit openbare gegevens");
  assert.ok(!/<script>(?!<\/script>)/.test(html), "geen inline scripts");
  // Stijl kiezen geeft dezelfde link (vernieuwd).
  await req(`/api/hq/klanten/${callLead}/voorbeeld`, { method: "POST", body: { style: "strak" } });
  await drain();
  assert.equal((await one("select count(*)::int n, max(style) s from hq.previews where lead_id=$1", [callLead])).s, "strak");
  assert.equal((await one("select count(*)::int n from hq.previews where lead_id=$1", [callLead])).n, 1);
  // Rayan zelf telt niet; een echte bezoeker wel (één melding).
  await req(`/api/public/voorbeeld/${previewSlug}/gezien`, { method: "POST", body: {}, headers: { origin: base } });
  assert.equal((await one("select views from hq.previews where slug=$1", [previewSlug])).views, 0);
  for (let i = 0; i < 2; i++) assert.equal((await pub(`/api/public/voorbeeld/${previewSlug}/gezien`, { method: "POST", body: {} })).status, 200);
  assert.equal((await one("select views from hq.previews where slug=$1", [previewSlug])).views, 2);
  assert.equal((await one("select count(*)::int n from hq.notifications where kind='voorbeeld_bekeken' and lead_id=$1", [callLead])).n, 1);
  assert.equal((await pub(`/api/public/voorbeeld/${previewSlug}/gezien`, { method: "POST", body: {}, headers: { origin: "https://kwaad.example" } })).status, 403);
  // Onbekend → 404, verlopen → 410.
  assert.equal((await fetch(`${base}/voorbeeld/bestaat-niet-123`)).status, 404);
  await mods.db.q("update hq.previews set expires_at = now() - interval '1 minute' where slug=$1", [previewSlug]);
  assert.equal((await fetch(`${base}/voorbeeld/${previewSlug}`)).status, 410);
  await mods.db.q("update hq.previews set expires_at = now() + interval '45 days' where slug=$1", [previewSlug]);
});

test("na het gesprek: uitkomst met één tik, toestemming vastgelegd, persoonlijk bericht met voorbeeldsite; zonder toestemming niets", async () => {
  const call = await one("select id from hq.calls where lead_id=$1", [callLead]);
  // Zonder toestemming: geen bericht via mail of WhatsApp.
  const no = await req(`/api/hq/klanten/${callLead}/bericht-na-gesprek`, { method: "POST", body: { channel: "whatsapp" } });
  assert.equal(no.status, 409); assert.match(no.json.message, /toestemming/);
  // Terugbellen zonder datum mag niet.
  assert.equal((await req(`/api/hq/bellijst/${call.id}/uitkomst`, { method: "POST", body: { outcome: "terugbellen" } })).status, 400);
  // "Interesse" + "ja, app het maar".
  const o = await req(`/api/hq/bellijst/${call.id}/uitkomst`, { method: "POST", body: { outcome: "interesse", consent: ["whatsapp"], notes: "Wil graag online afspraken" } });
  assert.equal(o.status, 200, JSON.stringify(o.json)); assert.deepEqual(o.json.consents, ["whatsapp"]);
  const cs = await one("select basis, source, scope from hq.consents where lead_id=$1 and channel='whatsapp'", [callLead]);
  assert.equal(cs.basis, "toestemming"); assert.match(cs.source, /^Telefoongesprek op /);
  const lead = await one("select status, sales_channel from hq.leads where id=$1", [callLead]);
  assert.deepEqual(lead, { status: "gesprek", sales_channel: "bellen" });
  // E-mail kon nog niet (geen toestemming voor mail).
  assert.equal((await req(`/api/hq/klanten/${callLead}/bericht-na-gesprek`, { method: "POST", body: { channel: "email" } })).status, 409);
  const msg = await req(`/api/hq/klanten/${callLead}/bericht-na-gesprek`, { method: "POST", body: { channel: "whatsapp" } });
  assert.equal(msg.status, 201, JSON.stringify(msg.json));
  const body = msg.json.outreach.body;
  assert.match(body, /Leuk je net te spreken/); assert.match(body, new RegExp(`/voorbeeld/${previewSlug}`)); assert.match(body, /Samen €\d+ eenmalig/);
  assert.match(body, /Stuur dan 'stop'/, "WhatsApp zegt zelf hoe je bezwaar maakt");
  assert.match(msg.json.wa_link, /^https:\/\/wa\.me\/31701112233\?text=/);
  // Nogmaals: zelfde bericht (geen dubbele).
  const msg2 = await req(`/api/hq/klanten/${callLead}/bericht-na-gesprek`, { method: "POST", body: { channel: "whatsapp" } });
  assert.equal(msg2.json.outreach.id, msg.json.outreach.id);
  // Rayan stuurt hem via WhatsApp en tikt "verstuurd": opvolging over 7 dagen staat voor hem klaar (nu nog niet zichtbaar).
  await req(`/api/hq/outreach/${msg.json.outreach.id}/verstuurd`, { method: "POST", body: {} });
  const fu = await one("select status, scheduled_at, body from hq.outreach where lead_id=$1 and kind='opvolging'", [callLead]);
  assert.equal(fu.status, "klaar_handmatig"); assert.ok(new Date(fu.scheduled_at) > new Date(Date.now() + 6 * 864e5));
  assert.match(fu.body, /voorbeeld/); assert.match(fu.body, /Stuur dan 'stop'/);
  assert.ok(!(await req("/api/hq/vandaag")).json.manual.some(x => x.lead_id === callLead && x.kind === "opvolging"), "opvolging pas zichtbaar als hij aan de beurt is");
  assert.equal((await one("select status from hq.previews where slug=$1", [previewSlug])).status, "gedeeld");
  // Klant reageert → opvolging vervalt.
  await req(`/api/hq/klanten/${callLead}/reactie`, { method: "POST", body: { text: "Ziet er goed uit, wat kost het precies?", channel: "whatsapp" } });
  assert.equal((await one("select status from hq.outreach where lead_id=$1 and kind='opvolging'", [callLead])).status, "geannuleerd");
});

test("niet meer benaderen geldt voorgoed; terugbellen komt terug (ook bij een eenmanszaak, dan met toestemming); afmelding wint; geen lijst in het weekend", async () => {
  const callOf = (company) => one("select c.id, c.lead_id from hq.calls c join hq.leads l on l.id=c.lead_id where l.company=$1 order by c.day desc limit 1", [company]);
  const v = await callOf("Barbier Zuid");
  assert.equal((await req(`/api/hq/bellijst/${v.id}/uitkomst`, { method: "POST", body: { outcome: "niet_bellen" } })).status, 200);
  assert.ok(await one("select 1 from hq.suppressions where kind='lead' and value=$1", [visitLead]), "geen enkel contact meer");
  const cb = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  const noord = await callOf("Autobedrijf Noord B.V.");
  assert.equal((await req(`/api/hq/bellijst/${noord.id}/uitkomst`, { method: "POST", body: { outcome: "terugbellen", callback_on: cb } })).status, 200);
  // Eenmanszaak bij een bezoek: "bel me volgende week" = toestemming voor dat telefoontje.
  const hoek = await callOf("Kapper Om De Hoek");
  const ho = await req(`/api/hq/bellijst/${hoek.id}/uitkomst`, { method: "POST", body: { outcome: "terugbellen", callback_on: cb } });
  assert.equal(ho.status, 200, JSON.stringify(ho.json)); assert.deepEqual(ho.json.consents, ["telefoon"]);
  assert.match((await one("select scope from hq.consents where lead_id=$1 and channel='telefoon'", [hoek.lead_id])).scope, /Terugbellen/);
  // Bezoek met terugbelafspraak, daarna afgemeld: komt niet terug.
  const warm = await callOf("Salon Warm B.V.");
  assert.equal((await req(`/api/hq/bellijst/${warm.id}/uitkomst`, { method: "POST", body: { outcome: "terugbellen", callback_on: cb } })).status, 200);
  assert.equal((await req(`/api/hq/klanten/${warm.lead_id}/afmelden`, { method: "POST", body: { reason: "afmelding" } })).status, 200);
  const calls = await import("../api/_lib/klant/calls.js");
  // Over drie dagen: Noord en Om De Hoek staan er weer op om te bellen; Barbier Zuid en Salon Warm nooit meer.
  const later = new Date(`${cb}T10:00:00+01:00`);
  await calls.buildDayList({ now: later, force: true });
  const day = calls.amsDay(later);
  const rows = (await mods.db.q("select l.company, c.kind from hq.calls c join hq.leads l on l.id=c.lead_id where c.day=$1::date", [day])).rows;
  const kindOf = Object.fromEntries(rows.map(r => [r.company, r.kind]));
  assert.equal(kindOf["Autobedrijf Noord B.V."], "bellen", `terugbellen: ${JSON.stringify(kindOf)}`);
  assert.equal(kindOf["Kapper Om De Hoek"], "bellen", "eenmanszaak: bellen mag nu (afgesproken)");
  assert.ok(!("Barbier Zuid" in kindOf) && !("Salon Warm B.V." in kindOf), JSON.stringify(kindOf));
  // Weekend (zaterdag): geen lijst, tenzij je hem zelf maakt.
  const sat = new Date("2026-11-28T10:00:00+01:00");
  const r = await calls.buildDayList({ now: sat });
  assert.equal(r.overgeslagen, "geen werkdag");
});

// ── Fase 1e: gratis websitecheck (leadmagneet) ─────────────────────────────────
test("websitecheck: meet echte punten, advies met prijzen uit de prijslijst, misbruiklimieten, gegevens alleen met vinkje, opruimen", async () => {
  const site = JSON.parse((await import("node:fs")).readFileSync(new URL("../api/_lib/content/site-data.json", import.meta.url), "utf8"));
  claudeReply = (b) => /websitecheck/.test(JSON.stringify(b.system || "")) ? { samenvatting: "Je site laadt en heeft een duidelijke kop. Het belangrijkste verbeterpunt: hij is nog niet ingesteld voor telefoons." } : fakeAi(b);
  const as = (ip) => ({ headers: { "x-forwarded-for": ip } });
  const target = `http://kapsalon-lotus.nl:${sitePort}/`;
  // Herkomst, honeypot en ongeldige adressen.
  assert.equal((await req("/api/public/websitecheck", { anon: true, method: "POST", body: { url: target } })).status, 403, "zonder herkomst geweigerd");
  const hp = await pub("/api/public/websitecheck", { method: "POST", body: { url: target, hp: "x" } });
  assert.equal(hp.status, 200); assert.equal(hp.json.token, null);
  assert.equal((await one("select count(*)::int n from hq.site_checks")).n, 0, "honeypot maakt niets aan");
  for (const bad of ["localhost", "http://127.0.0.1/", "ftp://kapsalon-lotus.nl", ""]) assert.equal((await pub("/api/public/websitecheck", { method: "POST", body: { url: bad } })).status, 400, bad);
  // Echte check (op de achtergrond), uitslag via het geheime token.
  const st = await pub("/api/public/websitecheck", { method: "POST", ...as("203.0.113.7"), body: { url: target } });
  assert.equal(st.status, 200, JSON.stringify(st.json)); assert.match(st.json.token, /^[A-Za-z0-9_-]{24,64}$/); assert.equal(st.json.status, "bezig");
  let v;
  for (let i = 0; i < 80; i++) { v = (await pub(`/api/public/websitecheck?t=${st.json.token}`)).json; if (v.status !== "bezig") break; await new Promise(r => setTimeout(r, 250)); }
  assert.equal(v.status, "klaar", JSON.stringify(v));
  const ck = Object.fromEntries(v.result.checks.map(c => [c.key, c]));
  assert.equal(ck.bereikbaar.ok, true); assert.equal(ck.https.ok, false); assert.equal(ck.mobiel.ok, false); assert.equal(ck.contact.ok, false);
  assert.equal(ck.links.ok, false); assert.match(ck.links.detail, /HTTP 404/, "kapotte afspraakknop gevonden zoals een klant hem zou volgen");
  assert.equal(ck.google.ok, false); assert.equal(ck.kop.ok, true); assert.equal(ck.afbeeldingen.ok, null);
  assert.equal(v.advice.ok_count, 2); assert.equal(v.advice.total, 7);
  assert.equal(v.advice.package.key, "redesign"); assert.equal(v.advice.package.price_eur, site.bases.redesign.price_eur, "prijs uit CONFIG");
  const booking = v.advice.options.find(o => o.id === "booking");
  assert.ok(booking, JSON.stringify(v.advice.options)); assert.equal(booking.price_eur, site.options.find(o => o.id === "booking").price_eur);
  assert.equal(v.advice.summary_by, "Claude"); assert.ok(!/\d/.test(v.advice.summary));
  const res = await one("select post, department from hq.ai_reservations order by created_at desc limit 1");
  assert.deepEqual(res, { post: "websitecheck", department: "auditor" }, "eigen budgetpost: kan nooit het hele tegoed opmaken");
  assert.ok(!("observations" in v.result) && !("lead_id" in v) && !("ip_hash" in v), "pagina krijgt alleen wat hij mag zien");
  // Zelfde domein kort daarna: uitslag hergebruikt (geen nieuwe meting, geen AI-kosten).
  const aiBefore = (await one("select count(*)::int n from hq.ai_reservations")).n;
  const again = await pub("/api/public/websitecheck", { method: "POST", ...as("203.0.113.7"), body: { url: "kapsalon-lotus.nl:" + sitePort } });
  assert.equal(again.json.status, "klaar"); assert.equal(again.json.reused, true);
  assert.equal((await one("select count(*)::int n from hq.ai_reservations")).n, aiBefore);
  // Maximaal 5 per bezoeker per dag; een andere bezoeker kan nog wel.
  for (let i = 0; i < 3; i++) assert.equal((await pub("/api/public/websitecheck", { method: "POST", ...as("203.0.113.7"), body: { url: target } })).status, 200);
  const six = await pub("/api/public/websitecheck", { method: "POST", ...as("203.0.113.7"), body: { url: target } });
  assert.equal(six.status, 429); assert.match(six.json.message, /WhatsApp/);
  assert.equal((await pub("/api/public/websitecheck", { method: "POST", ...as("198.51.100.4"), body: { url: target } })).status, 200);
  // Dagmaximum (instelling).
  await mods.db.q("update hq.settings set value = value || '{\"checks_per_day\": 6}'::jsonb where key='sales_ai'");
  const full = await pub("/api/public/websitecheck", { method: "POST", ...as("198.51.100.9"), body: { url: target } });
  assert.equal(full.status, 429); assert.match(full.json.message, /vol/);
  await mods.db.q("update hq.settings set value = value || '{\"checks_per_day\": 40}'::jsonb where key='sales_ai'");
  assert.equal((await one("select count(*)::int n from hq.site_checks where ip_hash is null")).n, 0);
  assert.ok(!(await one("select 1 from hq.site_checks where ip_hash like '%203.0.113.7%'")), "geen IP-adres opgeslagen");
  // Gegevens achterlaten: alleen met vinkje en met telefoon of e-mail.
  const t = st.json.token;
  assert.equal((await pub("/api/public/websitecheck/contact", { method: "POST", body: { t, name: "Lotus", phone: "0698765432", consent: false } })).status, 400);
  assert.equal((await pub("/api/public/websitecheck/contact", { method: "POST", body: { t, name: "Lotus", consent: true } })).status, 400);
  assert.equal((await pub("/api/public/websitecheck/contact", { method: "POST", body: { t: "x".repeat(30), phone: "0698765432", consent: true } })).status, 404);
  const ok = await pub("/api/public/websitecheck/contact", { method: "POST", body: { t, name: "Mila de Vries", company: "Kapsalon Lotus Delft", phone: "06 9876 5432", consent: true, message: "Graag meer afspraken" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const sc = await one("select lead_id from hq.site_checks where token_hash=encode(sha256($1::bytea),'hex')", [t]);
  assert.ok(sc.lead_id, "check hangt aan de klantkaart");
  const lead = await one("select * from hq.leads where id=$1", [sc.lead_id]);
  assert.equal(lead.sales_channel, "websitecheck"); assert.equal(lead.contact_phone, "+31698765432");
  const cons = (await mods.db.q("select channel, basis from hq.consents where lead_id=$1 and revoked_at is null order by channel, basis", [lead.id])).rows.map(r => `${r.channel}:${r.basis}`);
  assert.ok(cons.includes("telefoon:toestemming") && cons.includes("whatsapp:toestemming"), cons.join(","));
  assert.ok(await one("select 1 from hq.opportunities where lead_id=$1 and strength='concreet' and observation like '%HTTP 404%'", [lead.id]), "bevindingen op de klantkaart");
  assert.ok(await one("select 1 from hq.notifications where kind='aanvraag' and lead_id=$1", [lead.id]), "melding: nieuwe aanvraag");
  // Bellen mag nu (vinkje), ook al is de rechtsvorm onbekend.
  assert.equal((await req(`/api/hq/klanten/${lead.id}`)).json.contact.bellen.allowed, true);
  assert.equal((await pub(`/api/public/websitecheck?t=${t}`)).json.contact_sent, true);
  const dup = await pub("/api/public/websitecheck/contact", { method: "POST", body: { t, name: "Mila de Vries", phone: "0698765432", consent: true, message: "Graag meer afspraken" } });
  assert.equal(dup.status, 200); assert.equal(dup.json.duplicate, true);
  // Onbekend token: niets prijsgeven.
  assert.equal((await pub(`/api/public/websitecheck?t=${"A".repeat(32)}`)).status, 404);
  // Opruimen: zonder gegevens na 90 dagen weg, met gegevens niet; bezoekershash na 2 dagen gewist.
  await mods.db.q("update hq.site_checks set created_at = now() - interval '91 days'");
  const { runRetention } = await import("../api/_lib/retention.js");
  const r = await runRetention();
  assert.equal(r.checks, 5, JSON.stringify(r)); // 6 checks, waarvan 1 met gegevens
  assert.equal((await one("select count(*)::int n from hq.site_checks")).n, 1, "alleen de check met achtergelaten gegevens blijft");
  assert.equal((await one("select ip_hash from hq.site_checks")).ip_hash, null);
});

// ── Fase 1e: bestaande klanten (review, verwijzing, onderhoud) ─────────────────
test("bestaande klanten: invoeren met bevestiging, berichten alleen met grond en afmeldregel, verwijslink herkend, melding bij een verwijzing", async () => {
  const site = JSON.parse((await import("node:fs")).readFileSync(new URL("../api/_lib/content/site-data.json", import.meta.url), "utf8"));
  const rows = [{ company: "Garage Oud B.V.", contact_name: "Henk de Vries", phone: "06 2222 3333", email: "henk@garage-oud.nl", website: "garage-oud.nl" },
    { company: "Bakker Klaas", contact_name: "Klaas", phone: "06 4444 5555" }];
  assert.equal((await req("/api/hq/klanten/bestaand", { method: "POST", body: { rows } })).status, 400, "zonder bevestiging over de herkomst");
  assert.equal((await req("/api/hq/klanten/bestaand", { method: "POST", body: { rows, confirmed: true } })).status, 400, "afmeldkans bij het verzamelen moet ingevuld zijn");
  assert.equal((await req("/api/hq/klanten/bestaand", { method: "POST", user: staff, body: { rows, confirmed: true, optout_offered: true } })).status, 403, "alleen de eigenaar");
  const im1 = await req("/api/hq/klanten/bestaand", { method: "POST", body: { rows: [rows[0]], confirmed: true, optout_offered: true } });
  assert.equal(im1.status, 200, JSON.stringify(im1.json)); assert.equal(im1.json.nieuw, 1);
  const im2 = await req("/api/hq/klanten/bestaand", { method: "POST", body: { rows: [rows[1], { company: "", phone: "1" }], confirmed: true, optout_offered: false } });
  assert.equal(im2.json.nieuw, 1); assert.equal(im2.json.overgeslagen.length, 1);
  const oud = await one("select * from hq.leads where company='Garage Oud B.V.'"), klaas = await one("select * from hq.leads where company='Bakker Klaas'");
  assert.equal(oud.status, "gewonnen"); assert.equal(oud.sales_channel, "bestaande_klant");
  const basis = async (id) => (await mods.db.q("select channel from hq.consents where lead_id=$1 and basis='bestaande_klant' and revoked_at is null order by channel", [id])).rows.map(r => r.channel);
  assert.deepEqual(await basis(oud.id), ["email", "telefoon", "whatsapp"]);
  assert.deepEqual(await basis(klaas.id), ["telefoon"], "zonder afmeldkans bij het verzamelen: alleen bellen");
  // Salon Mila accepteerde online zonder het vinkje "liever geen berichten": grond voor berichten over eigen diensten.
  assert.deepEqual(await basis(leadQ.id), ["email", "telefoon", "whatsapp"]);
  // Review: alleen met je Google-reviewlink.
  assert.equal((await req("/api/hq/klanten/campagne", { method: "POST", body: { kind: "review" } })).status, 409);
  assert.equal((await req("/api/hq/kantoor/instellingen/links", { method: "PUT", body: { google_review_url: "https://g.page/r/strakwerk-test/review" } })).status, 200);
  const rv = await req("/api/hq/klanten/campagne", { method: "POST", body: { kind: "review" } });
  assert.equal(rv.status, 200, JSON.stringify(rv.json));
  const msgOud = await one("select * from hq.outreach where lead_id=$1 and kind='review_verzoek' and idempotency_key like 'campagne:%'", [oud.id]);
  assert.equal(msgOud.channel, "whatsapp"); assert.equal(msgOud.status, "klaar_handmatig");
  assert.match(msgOud.body, /^Hoi Henk,/); assert.match(msgOud.body, /https:\/\/g\.page\/r\/strakwerk-test\/review/); assert.match(msgOud.body, /Stuur dan 'stop'/);
  assert.ok(!/korting|beloning|cadeau/i.test(msgOud.body), "geen beloning voor een review");
  assert.ok(rv.json.overgeslagen.some(x => x.bedrijf === "Bakker Klaas" && /telefonisch|bel/.test(x.reden)), JSON.stringify(rv.json.overgeslagen));
  assert.equal((await req("/api/hq/klanten/campagne", { method: "POST", body: { kind: "review" } })).json.klaar, 0, "per maand één keer per klant");
  // Verwijzing: eigen link; beloning alleen als je die zelf instelt.
  await mods.db.q("update hq.outreach set sent_at=now() - interval '10 days', status='handmatig_verzonden' where id=$1", [msgOud.id]);
  await req("/api/hq/klanten/campagne", { method: "POST", body: { kind: "verwijzing", lead_ids: [oud.id] } });
  const vw = await one("select body from hq.outreach where lead_id=$1 and kind='verwijzing'", [oud.id]);
  assert.match(vw.body, new RegExp(`/\\?ref=${oud.id.slice(0, 8)}`)); assert.ok(!/krijg jij/.test(vw.body), "geen beloning zonder jouw regel");
  // Onderhoud: namen en prijzen uit de prijslijst.
  await mods.db.q("update hq.outreach set sent_at=now() - interval '10 days', status='handmatig_verzonden' where lead_id=$1 and kind='verwijzing'", [oud.id]);
  await req("/api/hq/klanten/campagne", { method: "POST", body: { kind: "onderhoud", lead_ids: [oud.id] } });
  const oh = await one("select body from hq.outreach where lead_id=$1 and kind='onderhoud'", [oud.id]);
  for (const id of ["onderhoud", "onderhoudplus"]) { const o = site.options.find(x => x.id === id); assert.ok(oh.body.includes(`${o.name} voor €${o.price_eur} per maand`), `${id}: ${oh.body}`); }
  // Afgemeld: geen berichten meer.
  await req(`/api/hq/klanten/${leadQ.id}/afmelden`, { method: "POST", body: { reason: "afmelding" } });
  const after = await req("/api/hq/klanten/campagne", { method: "POST", body: { kind: "onderhoud", lead_ids: [leadQ.id] } });
  assert.equal(after.json.klaar, 0); assert.ok(!(await one("select 1 from hq.outreach where lead_id=$1 and kind='onderhoud'", [leadQ.id])), "geen bericht na afmelding");
  // Verwijzing werkt: aanvraag via de link van Garage Oud → klant → melding (met jouw beloningsregel).
  await req("/api/hq/kantoor/instellingen/links", { method: "PUT", body: { referral_reward: "een maand gratis onderhoud" } });
  const a = await pub("/api/public/aanvraag", { method: "POST", body: { name: "Sanne", company: "Bloemen Sanne", email: "sanne@bloemen-sanne.nl", message: "Ik wil een website.", ref: oud.id.slice(0, 8), form_id: "form-ref-0001" } });
  assert.equal(a.status, 200);
  const sanne = await one("select id, referral_lead_id, sales_channel from hq.leads where contact_email='sanne@bloemen-sanne.nl'");
  assert.equal(sanne.referral_lead_id, oud.id); assert.equal(sanne.sales_channel, "verwijzing");
  const qr = await req(`/api/hq/klanten/${sanne.id}/offerte`, { method: "POST", body: {} });
  assert.equal(qr.status, 201, JSON.stringify(qr.json));
  await mods.db.q("update hq.quotes set terms='Voorwaarden StrakWerk (test)' where id=$1", [qr.json.id]);
  const sq = await req(`/api/hq/offertes/${qr.json.id}/versturen`, { method: "POST", body: { interest: true } });
  assert.equal(sq.status, 200, JSON.stringify(sq.json));
  const t = new URL(sq.json.url, base).searchParams.get("t");
  const acc = await pub(`/api/public/offerte?t=${encodeURIComponent(t)}`, { method: "POST", body: { name: "Sanne", agree: true, no_marketing: true } });
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  const nt = await one("select title, body, lead_id from hq.notifications where kind='verwijzing'");
  assert.equal(nt.lead_id, oud.id); assert.match(nt.title, /Via Garage Oud B\.V\.: Bloemen Sanne/); assert.match(nt.body, /een maand gratis onderhoud/);
  assert.deepEqual(await basis(sanne.id), [], "vinkje 'liever geen berichten' → geen grond voor berichten over andere diensten");
});
