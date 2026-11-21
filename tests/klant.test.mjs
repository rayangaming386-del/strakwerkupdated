// Tests voor "klanten winnen": het hele traject met gemarkeerde testgegevens.
// Scenario A: Scout vindt geen eigen website, geen contactgrond → niet mailen, wel marketinginput.
// Scenario B: concreet mobiel probleem + toegestane route → testmail, reactie stopt opvolging.
// Scenario C: via een StrakWerk-video → aanvraag → offerte → akkoord → intake → gesimuleerde betaling.
// Plus: dubbele aanvraag, reactie tijdens geplande opvolging, afmelden, ontbrekende koppeling,
// kostenplafond, hervatten na een fout, eigen fout pauzeert de route, ochtendoverleg.
// Nagebootst: Supabase Auth, OpenStreetMap (Overpass) en websites. Geen echte accounts of mails.
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
const DB_NAME = `hq_klant_${process.pid}`;
const JWT_SECRET = "test-jwt-secret-dat-lang-genoeg-is-0123456789";
const INBOUND = "test-inbound-geheim-0123456789";
let server, base, fakeAuth, overpass, site, sitePort, mods = {};
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
  return { status: r.status, json, text: t };
}
const one = async (sql, v = []) => (await mods.db.q(sql, v)).rows[0];
const drain = async () => {
  for (let i = 0; i < 30; i++) {
    await mods.db.q("update hq.tasks set run_after=now() where status='in_wachtrij' and agent_key not in ('video','publisher')");
    await mods.worker.runWorker({ source: "test", budgetMs: 60_000 });
    if (!(await one("select count(*)::int n from hq.tasks where agent_key not in ('video','publisher') and status in ('in_wachtrij','bezig')")).n) return;
    await new Promise(r => setTimeout(r, 100));
  }
};

// OpenStreetMap-antwoorden per segment (vaste testdata).
const OSM = { elements: [] };

before(async () => {
  const admin = new pg.Client({ connectionString: BASE_DB }); await admin.connect();
  await admin.query(`drop database if exists ${DB_NAME}`); await admin.query(`create database ${DB_NAME}`); await admin.end();
  const dbUrl = BASE_DB.replace(/\/[^/]*$/, `/${DB_NAME}`);
  fakeAuth = http.createServer((rq, rs) => { rs.writeHead(404); rs.end(); });
  await new Promise(r => fakeAuth.listen(0, "127.0.0.1", r));
  overpass = http.createServer(async (rq, rs) => { for await (const _ of rq); rs.writeHead(200, { "content-type": "application/json" }); rs.end(JSON.stringify(OSM)); });
  await new Promise(r => overpass.listen(0, "127.0.0.1", r));
  // Nep-website van een barbershop: mobiel prima, maar de afspraaklink geeft een 404.
  site = http.createServer((rq, rs) => {
    if (rq.url === "/robots.txt") { rs.writeHead(200, { "content-type": "text/plain" }); return rs.end("User-agent: *\nAllow: /\n"); }
    if (rq.url === "/") { rs.writeHead(200, { "content-type": "text/html" }); return rs.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Barbershop Bravo</title></head><body><h1>Barbershop Bravo</h1><a href="tel:+31701234567">Bel</a><a href="/boeken">Afspraak maken</a><a href="/prijzen">Prijzen</a><a href="/contact">Contact</a><footer>© 2025</footer></body></html>`); }
    if (rq.url === "/prijzen" || rq.url === "/contact") { rs.writeHead(200, { "content-type": "text/html" }); return rs.end("<html><body>ok</body></html>"); }
    rs.writeHead(404); rs.end("niet gevonden");
  });
  await new Promise(r => site.listen(0, "127.0.0.1", r));
  sitePort = site.address().port;
  Object.assign(process.env, {
    DATABASE_URL: dbUrl, SUPABASE_URL: `http://127.0.0.1:${fakeAuth.address().port}`, SUPABASE_PUBLISHABLE_KEY: "test-publishable",
    SUPABASE_JWT_SECRET: JWT_SECRET, CRON_SECRET: "test-cron-0123456789", HQ_TEST_MODE: "1", HQ_STORAGE: "local", HQ_ENCRYPTION_KEY: "test-enc-0123456789",
    HQ_MEDIA_DIR: mkdtempSync(path.join(tmpdir(), "hq-media-")), OVERPASS_URL: `http://127.0.0.1:${overpass.address().port}/api/interpreter`, HQ_INBOUND_SECRET: INBOUND,
  });
  for (const k of ["SUPABASE_SECRET_KEY", "IG_APP_ID", "ANTHROPIC_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "BUFFER_API_KEY"]) delete process.env[k];
  const { migrate } = await import("../scripts/migrate.mjs");
  await migrate(dbUrl, { log: () => {} });
  mods.db = await import("../api/_lib/db.js");
  mods.worker = await import("../api/_lib/worker.js");
  mods.plan = await import("../api/_lib/klant/planning.js");
  mods.acq = await import("../api/_lib/klant/acquisition.js");
  mods.cron = await import("../api/_lib/klant/cron.js");
  mods.budget = await import("../api/_lib/budget.js");
  (await import("../api/_lib/agents/fetcher.js")).__setTestNetwork({ strict: true, hosts: { "barbershop-bravo.nl": "127.0.0.1" } });
  for (const u of [owner, staff]) await mods.db.q("insert into hq.members (user_id, email, role, status) values ($1,$2,$3,'actief')", [u.id, u.email, u.role]);
  const { createServer } = await import("../scripts/dev-server.mjs");
  server = createServer();
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await mods.db?.closePool();
  for (const s of [server, fakeAuth, overpass, site]) s?.close();
  const admin = new pg.Client({ connectionString: BASE_DB }); await admin.connect();
  await admin.query(`drop database if exists ${DB_NAME} with (force)`); await admin.end();
});

let leadA, leadB, leadC;

test("scenario A: geen eigen website en geen contactgrond → niet mailen, wel marketingtaak", async () => {
  OSM.elements = [
    { type: "node", id: 101, tags: { name: "Kapsalon Anna", shop: "hairdresser", "addr:city": "Den Haag", phone: "070 111 2233", opening_hours: "Tu-Sa 09:00-17:00" } },
    { type: "node", id: 102, tags: { name: "Haarstudio Bea", shop: "hairdresser", "addr:city": "Den Haag", "contact:instagram": "https://instagram.com/haarstudiobea" } },
    { type: "node", id: 103, tags: { name: "Kapper Oud", shop: "hairdresser", "addr:city": "Den Haag", "disused:shop": "hairdresser" } },
  ];
  const r = await req("/api/hq/scout/ontdekken", { method: "POST", body: { segment: "salons", city: "Den Haag", limit: 5 } });
  assert.equal(r.status, 201);
  const again = await req("/api/hq/scout/ontdekken", { method: "POST", body: { segment: "salons", city: "Den Haag", limit: 5 } });
  assert.equal(again.json.duplicate, true, "zelfde ronde op dezelfde dag wordt niet dubbel ingepland");
  await drain();
  // Testgegevens markeren (scenario's draaien in de testomgeving).
  await mods.db.q("update hq.leads set is_test=true where source='scout_osm'");
  const anna = await one("select * from hq.leads where company='Kapsalon Anna'");
  leadA = anna.id;
  assert.equal(anna.website_status, "geen_gevonden");
  assert.ok(anna.website_checks.some(c => c.uitkomst === "geen eigen website gevonden na deze controles"), "conclusie staat letterlijk in de controles");
  assert.ok(anna.website_checks.some(c => /kapsalonanna\.nl/.test(c.controle)), "domein op bedrijfsnaam is gecontroleerd");
  assert.equal(anna.source_detail.bron.includes("OpenStreetMap"), true, "bron vastgelegd");
  assert.ok(anna.source_detail.onderzocht_op, "onderzoeksdatum vastgelegd");
  const bea = await one("select * from hq.leads where company='Haarstudio Bea'");
  assert.equal(bea.website_status, "alleen_sociaal");
  const oud = await one("select * from hq.leads where company='Kapper Oud'");
  assert.equal(oud.active_status, "gesloten");
  assert.equal(oud.priority, "laag");
  // Nogmaals ontdekken (andere dag): bestaande bedrijven worden herkend.
  const d2 = await (await import("../api/_lib/klant/discover.js")).discover({ segment: "salons", city: "Den Haag", limit: 5 });
  assert.equal(d2.new.length, 0); assert.equal(d2.existing.length, 3);
  // Acquisitie: past wel, maar geen contactgrond (alleen een telefoonnummer uit open data).
  const ap = await req(`/api/hq/klanten/${leadA}/benaderen`, { method: "POST", body: {} });
  assert.equal(ap.json.fit.fit, true);
  assert.equal(ap.json.decision, "geen_contactgrond");
  assert.equal((await one("select count(*)::int n from hq.outreach where lead_id=$1", [leadA])).n, 0, "geen bericht gemaakt");
  // Een openbaar e-mailadres alleen is geen contactgrond.
  const bad = await req(`/api/hq/klanten/${leadA}/toestemming`, { method: "POST", body: { channel: "email", basis: "gerechtvaardigd_belang_zakelijk", source: "website", scope: "eenmalig", evidence: "openbaar e-mailadres" } });
  assert.equal(bad.status, 400);
  // Ochtendoverleg (testomgeving): marketingtaak voor salons zonder eigen website.
  const m = await mods.plan.runMeeting({ env: "test", force: true });
  const acts = (await mods.db.q("select * from hq.actions where briefing_id=$1 order by rank", [m.briefing.id])).rows;
  assert.ok(acts.some(a => a.department === "marketing" && /zonder eigen website/.test(a.title)), "marketing krijgt de anonieme input");
  assert.ok(acts.length <= 5);
});

test("scenario B: concreet mobiel probleem, toegestane route, testmail, reactie stopt de opvolging", async () => {
  OSM.elements = [{ type: "node", id: 201, tags: { name: "Barbershop Bravo", shop: "hairdresser", "addr:city": "Zoetermeer", website: `http://barbershop-bravo.nl:${sitePort}/`, email: "info@barbershop-bravo.nl" } }];
  const d = await (await import("../api/_lib/klant/discover.js")).discover({ segment: "salons", city: "Zoetermeer", limit: 5, isTest: true });
  assert.equal(d.new.length, 1);
  await drain();
  const lead = await one("select * from hq.leads where company='Barbershop Bravo'");
  leadB = lead.id;
  assert.equal(lead.website_status, "gevonden");
  const opp = await one("select * from hq.opportunities where lead_id=$1 and strength='concreet'", [leadB]);
  assert.ok(opp, "concrete observatie gevonden");
  assert.match(opp.observation, /HTTP 404/);
  assert.match(opp.page_url, /\/boeken$/);
  assert.equal(opp.service_key, "booking");
  // Zonder contactgrond: niets automatisch.
  let ap = await req(`/api/hq/klanten/${leadB}/benaderen`, { method: "POST", body: {} });
  assert.equal(ap.json.decision, "geen_contactgrond");
  // Contactgrond vastleggen (bron, datum, reikwijdte, onderbouwing).
  const c = await req(`/api/hq/klanten/${leadB}/toestemming`, { method: "POST", body: { channel: "email", basis: "gerechtvaardigd_belang_zakelijk", source: "Zakelijk adres op eigen website, contactpagina", scope: "Eén bericht over de kapotte afspraaklink, één opvolging",
    evidence: "Concreet probleem op hun eigen site (afspraaklink 404), zakelijk adres voor klantvragen, eenmalig en met afmeldlink; afweging vastgelegd." } });
  assert.equal(c.status, 201);
  // Route activeren vraagt eerst de controle van de voorwaarden.
  assert.equal((await req("/api/hq/kantoor/routes", { method: "PUT", body: { email: { auto: true } } })).status, 409);
  assert.equal((await req("/api/hq/kantoor/routes", { method: "PUT", user: staff, body: { email: { auto: true, terms_checked: true } } })).status, 403);
  assert.equal((await req("/api/hq/kantoor/routes", { method: "PUT", body: { email: { auto: true, terms_checked: true } } })).status, 200);
  ap = await req(`/api/hq/klanten/${leadB}/benaderen`, { method: "POST", body: {} });
  assert.equal(ap.json.decision, "automatisch_ingepland");
  const o = ap.json.outreach;
  assert.match(o.body, /HTTP 404|afspraak/i, "één echte observatie");
  assert.equal((o.body.match(/\?/g) || []).length, 1, "één vraag");
  assert.equal(o.prompt_version, "acquisitie_eerste_mail@v1", "versie vastgelegd");
  // Dubbel voorbereiden maakt geen tweede bericht.
  await req(`/api/hq/klanten/${leadB}/benaderen`, { method: "POST", body: {} });
  assert.equal((await one("select count(*)::int n from hq.outreach where lead_id=$1 and kind='eerste_contact'", [leadB])).n, 1);
  assert.equal(await mods.acq.enqueueDueOutreach(), 1);
  assert.equal(await mods.acq.enqueueDueOutreach(), 0, "geen tweede verzendtaak");
  await drain();
  const sent = await one("select * from hq.outreach where id=$1", [o.id]);
  assert.equal(sent.status, "test_verzonden", "live staat uit en het is testdata: niets echt verstuurd");
  const fu = await one("select * from hq.outreach where lead_id=$1 and kind='opvolging'", [leadB]);
  assert.equal(fu.status, "gepland");
  // Inkomende reactie via de mailkoppeling (gedeeld geheim), gekoppeld via In-Reply-To.
  assert.equal((await req("/api/public/inbound", { method: "POST", anon: true, body: { text: "x" } })).status, 401);
  const inb = await req("/api/public/inbound", { method: "POST", anon: true, headers: { "x-hq-inbound-secret": INBOUND }, body: { from: "info@barbershop-bravo.nl", subject: `Re: ${sent.subject}`, text: "Hoi Rayan, wat zou dat kosten? Klinkt interessant.", in_reply_to: sent.provider_id, message_id: "<reactie-1@barbershop-bravo.nl>" } });
  assert.equal(inb.status, 200);
  assert.ok(["interesse", "vraag"].includes(inb.json.classification));
  const again = await req("/api/public/inbound", { method: "POST", anon: true, headers: { "x-hq-inbound-secret": INBOUND }, body: { from: "info@barbershop-bravo.nl", text: "Hoi Rayan, wat zou dat kosten?", in_reply_to: sent.provider_id, message_id: "<reactie-1@barbershop-bravo.nl>" } });
  assert.equal(again.json.duplicate, true, "zelfde mail twee keer: één reactie");
  assert.equal((await one("select status from hq.outreach where id=$1", [fu.id])).status, "geannuleerd", "geplande opvolging gestopt");
  const l2 = await one("select * from hq.leads where id=$1", [leadB]);
  assert.equal(l2.priority, "hoog"); assert.ok(l2.awaiting_reply_since, "klant wacht op ons");
  const draft = await one("select * from hq.outreach where lead_id=$1 and kind='antwoord' and status='concept'", [leadB]);
  assert.ok(draft, "Sales zet een antwoordconcept klaar"); assert.match(draft.body, /Afspraken plannen \(\+€\d+\)/, "prijs uit de prijslijst");
  // Vlak voor verzenden opnieuw controleren: een opvolging die toch nog gepland stond, gaat niet uit.
  await mods.db.q("insert into hq.outreach (lead_id, channel, kind, sequence, status, body, to_address, scheduled_at, idempotency_key, is_test) values ($1,'email','opvolging',2,'gepland','x','info@barbershop-bravo.nl',now(),'test-late',true)", [leadB]);
  await mods.acq.enqueueDueOutreach(); await drain();
  assert.equal((await one("select status, cancel_reason from hq.outreach where idempotency_key='test-late'")).status, "geannuleerd");
  // Een prijsvraag gaat voor op nieuw koud onderzoek in het overleg.
  const m = await mods.plan.runMeeting({ env: "test", force: true });
  const top = await one("select * from hq.actions where briefing_id=$1 order by rank limit 1", [m.briefing.id]);
  assert.equal(top.department, "sales"); assert.match(top.title, /Barbershop Bravo/);
});

test("scenario C: video → aanvraag → offerte → akkoord → intake → gesimuleerde betaling → resultaten", async () => {
  await mods.db.q(`insert into hq.content_pieces (format_key, audience, goal, campaign_code, keyword, title, kind) values ('merk_reel','autobedrijven','aanvragen','garage-kenteken-w47','GARAGE','Garage: kies je automodel en vraag een offerte aan','merk')`);
  const piece = await one("select id from hq.content_pieces where campaign_code='garage-kenteken-w47'");
  // Formulier op de site (publiek), met campagnecode uit de video-link. Honeypot wordt stil genegeerd.
  const hp = await req("/api/public/aanvraag", { method: "POST", anon: true, headers: { origin: base }, body: { name: "Bot", message: "spam", hp: "x" } });
  assert.equal(hp.status, 200);
  assert.equal((await req("/api/public/aanvraag", { method: "POST", anon: true, headers: { origin: "https://evil.example" }, body: { name: "x" } })).status, 403);
  const form = { name: "Sam de Vries", company: "Garage De Vries", email: "sam@garagedevries.nl", phone: "06 12345678", type: "Een nieuwe website", message: "Wij willen een website met kentekencheck zodat klanten hun auto kunnen kiezen en een offerte aanvragen.", page: "/", utm: { source: "instagram", campaign: "garage-kenteken-w47" }, sw_test: true, form_id: "form-test-0001" };
  const a1 = await req("/api/public/aanvraag", { method: "POST", anon: true, headers: { origin: base }, body: form });
  assert.equal(a1.status, 200); assert.equal(a1.json.duplicate, false);
  const a2 = await req("/api/public/aanvraag", { method: "POST", anon: true, headers: { origin: base }, body: form });
  assert.equal(a2.json.duplicate, true, "dubbele aanvraag → één klantkaart");
  const lead = await one("select * from hq.leads where contact_email='sam@garagedevries.nl'");
  leadC = lead.id;
  assert.equal(lead.is_test, true);
  assert.equal(lead.campaign_piece_id, piece.id, "herleid naar de video");
  assert.equal(lead.status, "gekwalificeerd");
  assert.equal((await one("select count(*)::int n from hq.leads where contact_email='sam@garagedevries.nl'")).n, 1);
  const card = (await req(`/api/hq/klanten/${leadC}`)).json;
  const draft = card.outreach.find(o => o.kind === "antwoord");
  assert.ok(draft && draft.status === "concept", "antwoordconcept klaar");
  assert.ok(card.wa_link.startsWith("https://wa.me/316"), "WhatsApp-link voor handmatig antwoord");
  // Offerte uit de actuele prijzen; versturen alleen door de eigenaar.
  const qr = await req(`/api/hq/klanten/${leadC}/offerte`, { method: "POST", body: {} });
  assert.equal(qr.status, 201);
  const quote = qr.json.quote;
  assert.ok(quote.items.some(i => i.key === "kenteken"), "kentekencheck herkend uit het bericht");
  assert.ok(quote.info_needed.length > 0 && quote.next_step, "info nodig en volgende stap");
  assert.equal((await req(`/api/hq/klanten/${leadC}/offerte`, { method: "POST", body: {} })).json.duplicate, true, "geen dubbele offerte");
  await mods.db.q("update hq.packages set terms='Testvoorwaarden' where key=$1", [quote.package_key]);
  await mods.db.q("update hq.quotes set terms='Testvoorwaarden' where id=$1", [quote.id]);
  assert.equal((await req(`/api/hq/offertes/${quote.id}/versturen`, { method: "POST", user: staff, body: { interest: true } })).status, 403);
  const sq = await req(`/api/hq/offertes/${quote.id}/versturen`, { method: "POST", body: { interest: true } });
  assert.equal(sq.status, 200); assert.equal(sq.json.followups, 2, "maximaal twee opvolgingen bij getoonde interesse");
  // Reactie tijdens geplande opvolging: opvolging stopt.
  await req(`/api/hq/klanten/${leadC}/reactie`, { method: "POST", body: { text: "Ziet er goed uit, ik ga akkoord!", channel: "whatsapp" } });
  assert.equal((await one("select count(*)::int n from hq.outreach where quote_id=$1 and status='gepland'", [quote.id])).n, 0);
  const acc = await req(`/api/hq/offertes/${quote.id}/akkoord`, { method: "POST", body: {} });
  assert.equal(acc.status, 200); assert.match(acc.json.intake_url, /^\/intake\?t=[a-f0-9]{48}$/);
  const acc2 = await req(`/api/hq/offertes/${quote.id}/akkoord`, { method: "POST", body: {} });
  assert.equal(acc2.json.project_id, acc.json.project_id, "herhaald akkoord → zelfde project");
  assert.equal((await one("select count(*)::int n from hq.projects where lead_id=$1", [leadC])).n, 1);
  const pr = await one("select * from hq.projects where id=$1", [acc.json.project_id]);
  assert.equal(pr.price_cents, quote.price_cents); assert.equal(pr.status, "intake");
  // Intake via de persoonlijke link (zonder account).
  const t = acc.json.intake_url.split("t=")[1];
  assert.equal((await req(`/api/public/intake?t=${"0".repeat(48)}`, { anon: true })).status, 404);
  const iv = (await req(`/api/public/intake?t=${t}`, { anon: true })).json;
  assert.equal(iv.complete, false); assert.equal(iv.project.test, true);
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const s1 = await req(`/api/public/intake?t=${t}`, { method: "POST", anon: true, headers: { origin: base }, body: { bedrijfsnaam: "Garage De Vries", over: "Familiegarage sinds jaren.", logo: { name: "logo.png", data: png } } });
  assert.equal(s1.status, 200); assert.equal(s1.json.complete, false);
  const s2 = await req(`/api/public/intake?t=${t}`, { method: "POST", anon: true, headers: { origin: base }, body: { diensten: "APK\nOnderhoud", contact: "06 12345678", domein: "garagedevries.nl" } });
  assert.equal(s2.json.complete, true, JSON.stringify(s2.json)); assert.equal(s2.json.briefing_ready, true, JSON.stringify(s2.json));
  const br = (await req(`/api/hq/projecten/${pr.id}/briefing`)).json;
  assert.match(br.briefing.text, /Bouwbriefing Garage De Vries/); assert.match(br.briefing.text, /Kentekencheck|kenteken/i);
  assert.equal((await one("select status from hq.projects where id=$1", [pr.id])).status, "in_aanbouw");
  // Feedback buiten de afspraken → voorstel met meerprijs, niet zomaar bouwen.
  const fb = await req(`/api/hq/projecten/${pr.id}/feedback`, { method: "POST", body: { text: "Kan er ook een webshop bij voor onderdelen?" } });
  assert.equal(fb.json.feedback.in_scope, false); assert.ok(fb.json.feedback.proposal.totaal_eur > 0);
  // Gesimuleerde betaling: alleen bij testgegevens.
  assert.equal((await req(`/api/hq/klanten/${leadA}/betaling`, { method: "POST", body: { amount_eur: 10, method: "simulatie" } })).status, 201, "A is ook testdata");
  await mods.db.q("delete from hq.payments where lead_id=$1", [leadA]);
  const pay = await req(`/api/hq/klanten/${leadC}/betaling`, { method: "POST", body: { amount_eur: quote.price_cents / 100, method: "simulatie", quote_id: quote.id } });
  assert.equal(pay.status, 201); assert.equal(pay.json.is_test, true);
  // Opgeleverd → nazorg gepland, reviewverzoek als concept.
  await req(`/api/hq/projecten/${pr.id}/status`, { method: "POST", body: { status: "opgeleverd" } });
  assert.equal((await one("select status from hq.outreach where project_id=$1 and kind='nazorg'", [pr.id])).status, "gepland");
  assert.equal((await one("select status from hq.outreach where project_id=$1 and kind='review_verzoek'", [pr.id])).status, "concept");
  // Resultaten (testomgeving): trechter, betaald los van open offertes, herkomst met methode.
  const res = (await req("/api/hq/resultaten?env=test")).json;
  assert.equal(res.funnel.find(f => f.key === "betaald").n, 1);
  assert.equal(res.betaald_cents, quote.price_cents);
  assert.ok(res.attribution.some(a => a.via === "link" && a.betalend === 1));
  assert.ok(res.qualified_definition.length > 20);
  // Productiecijfers blijven leeg: tests tellen alleen in de testomgeving.
  const prod = (await req("/api/hq/resultaten")).json;
  assert.equal(prod.betaald_cents, 0);
  const sc = await mods.plan.scorecards({ env: "productie" });
  assert.equal(sc.sales.metrics.find(m => /betalingen/.test(m.naam)).aantal, 0);
  const sct = await mods.plan.scorecards({ env: "test" });
  assert.equal(sct.marketing.metrics[1].aantal, 1, "marketing krijgt de betalende klant (test)");
});

test("afmelden: één klik stopt alles bij alle afdelingen", async () => {
  const { unsubscribeToken } = await import("../api/_lib/klant/mail.js");
  await mods.db.q("insert into hq.outreach (lead_id, channel, kind, status, body, to_address, scheduled_at, idempotency_key, is_test) values ($1,'email','opvolging','gepland','x','info@barbershop-bravo.nl',now() + interval '1 day','test-unsub',true)", [leadB]);
  assert.equal((await req("/api/public/afmelden?t=nep.token", { anon: true })).status, 400);
  const page = await req(`/api/public/afmelden?t=${encodeURIComponent(unsubscribeToken(leadB))}`, { anon: true });
  assert.equal(page.status, 200); assert.match(page.text, /Ja, afmelden/);
  assert.notEqual((await one("select status from hq.leads where id=$1", [leadB])).status, "afgemeld", "GET alleen tonen (linkscanners melden niemand af)");
  const r = await req(`/api/public/afmelden?t=${encodeURIComponent(unsubscribeToken(leadB))}`, { method: "POST", anon: true });
  assert.equal(r.status, 200);
  assert.equal((await one("select status from hq.leads where id=$1", [leadB])).status, "afgemeld");
  assert.equal((await one("select status from hq.outreach where idempotency_key='test-unsub'")).status, "geannuleerd");
  assert.ok(await one("select 1 from hq.suppressions where kind='email' and value='info@barbershop-bravo.nl'"));
  const ap = await req(`/api/hq/klanten/${leadB}/benaderen`, { method: "POST", body: {} });
  assert.equal(ap.json.decision, "niet_benaderen");
});

test("eigen fout: verzonden na afmelding → score omlaag, correctietaak en route op pauze tot hersteld en getest", async () => {
  // Nagebootste fout: een bericht dat na de afmelding toch als verzonden staat.
  await mods.db.q("insert into hq.outreach (lead_id, channel, kind, sequence, status, body, to_address, sent_at, idempotency_key, is_test) values ($1,'email','opvolging',5,'test_verzonden','x','info@barbershop-bravo.nl',now() + interval '1 second','test-fout',true)", [leadB]);
  const before = await mods.plan.scorecards({ env: "test" });
  assert.equal(await mods.plan.auditViolations(), 1);
  assert.equal(await mods.plan.auditViolations(), 0, "niet dubbel melden");
  const routes = (await req("/api/hq/kantoor")).json.routes;
  assert.equal(routes.email.paused, true);
  const err = await one("select * from hq.agent_errors where kind='afmelding_genegeerd'");
  assert.ok(err.correction_action_id);
  const sc = await mods.plan.scorecards({ env: "test" });
  assert.ok(sc.acquisitie.fouten.open >= 1 && sc.acquisitie.bonus < before.acquisitie.bonus, "eigen fout verlaagt de score");
  // Gepauzeerde route: niets automatisch inplannen.
  const ck = await (await import("../api/_lib/klant/contact.js")).contactCheck(await one("select * from hq.leads where id=$1", [leadC]), "email", { kind: "eerste_contact" });
  assert.ok(ck.reasons.some(x => /gepauzeerd/.test(x)));
  const fx = await req(`/api/hq/fouten/${err.id}/hersteld`, { method: "POST", body: { note: "Controle vlak voor verzenden toegevoegd" } });
  assert.equal(fx.status, 200); assert.match(fx.json.test, /zelftest geslaagd/);
  assert.equal((await req("/api/hq/kantoor")).json.routes.email.paused, false);
});

test("ontbrekende koppeling, kostenplafond en hervatten na een fout", async () => {
  // Geen SMTP: acquisitie meldt deels gekoppeld; live zetten verstuurt nog steeds niets echt.
  const conn = (await import("../api/_lib/agents/registry.js")).connection("acquisitie");
  assert.equal(conn.partial, true); assert.deepEqual(conn.missing, ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]);
  // Overleg zonder AI-tegoed: samenvatting uit code, taken worden gewoon aangemaakt.
  await mods.budget.putBudget({ enabled: true, confirmed: true, granted_usd: 1, hq_limit_usd: 1 }, { userId: owner.id, email: owner.email }).catch(() => {});
  await mods.db.q("delete from hq.briefings where env='test'");
  const m = await mods.plan.runMeeting({ env: "test" });
  assert.equal(m.briefing.summary_by, "code");
  assert.match(m.briefing.summary, /Gisteren:/);
  const dup = await mods.plan.runMeeting({ env: "test" });
  assert.equal(dup.duplicate, true, "één overleg per dag");
  // Hervatten na een fout: OpenStreetMap tijdelijk niet bereikbaar → taak wordt opnieuw ingepland en slaagt daarna.
  overpass.close(); await new Promise(r => setTimeout(r, 50));
  const { enqueue } = await import("../api/_lib/queue.js");
  const t = await mods.db.tx((db) => enqueue(db, { agent: "scout", kind: "ontdekken", title: "Ontdekken herstel", input: { segment: "autobedrijven", city: "Zoetermeer", limit: 2 }, idempotencyKey: "herstel-1" }));
  await mods.worker.runWorker({ source: "test", budgetMs: 20_000 });
  let task = await one("select * from hq.tasks where id=$1", [t.id]);
  assert.equal(task.status, "in_wachtrij", "tijdelijke fout: opnieuw ingepland");
  OSM.elements = [];
  overpass = http.createServer(async (rq, rs) => { for await (const _ of rq); rs.writeHead(200, { "content-type": "application/json" }); rs.end(JSON.stringify(OSM)); });
  await new Promise(r => overpass.listen(Number(new URL(process.env.OVERPASS_URL).port), "127.0.0.1", r));
  await drain();
  task = await one("select * from hq.tasks where id=$1", [t.id]);
  assert.equal(task.status, "afgerond", "dezelfde taak hervat, geen kopie");
});

test("opdrachtveld: gewone taal → klantkaart en offerteconcept, geld blijft bij Rayan", async () => {
  const r = await req("/api/hq/opdracht", { method: "POST", body: { text: 'Deze kapper wil een website met afspraken. Bedrijf: "Kapsalon Delta", mail delta@kapsalondelta.nl. Zet de aanvraag erin en bereid een offerte voor.', is_test: true } });
  assert.equal(r.status, 200);
  assert.equal(r.json.understood, true);
  assert.ok(r.json.done.some(d => /Klantkaart aangemaakt/.test(d)));
  assert.ok(r.json.done.some(d => /Offerteconcept/.test(d)));
  assert.ok(r.json.decide.some(d => /verstuur hem zelf/.test(d)));
  const q = await one("select q.* from hq.quotes q join hq.leads l on l.id=q.lead_id where l.contact_email='delta@kapsalondelta.nl'");
  assert.equal(q.status, "concept");
  assert.ok(q.package_key === "premium" || q.items.some(i => i.key === "booking"), "afspraken herkend");
  const v = (await req("/api/hq/vandaag?env=test")).json;
  assert.ok(v.quotes.some(x => x.id === q.id), "startscherm toont de offerte die aandacht vraagt");
});
