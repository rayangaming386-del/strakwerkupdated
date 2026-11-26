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
    if (rq.url === "/") { rs.writeHead(200, { "content-type": "text/html" }); return rs.end(`<!doctype html><html><head><title>Kapsalon Lotus</title></head><body><h1>Kapsalon Lotus</h1><a href="/afspraak">Afspraak maken</a><footer>© 2019</footer></body></html>`); }
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
