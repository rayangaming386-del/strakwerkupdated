// Tests voor het zelfstandige kantoor: campagnes voor StrakWerk zonder klantproject,
// centraal AI-budget (lege portemonnee, gelijktijdige reserveringen, onvoldoende tegoed),
// Buffer als publicatieroute (volle wachtrij, onduidelijke uitkomst, hervatten zonder
// dubbele post), proefstand zonder live publicatie en tijd wijzigen zonder AI of render.
// Nagebootst: Supabase Auth, de Claude API en de Buffer-API. Geen echte accounts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { SignJWT } from "jose";

const BASE_DB = process.env.TEST_DATABASE_URL || "postgres://postgres@127.0.0.1:54329/postgres";
const DB_NAME = `hq_office_${process.pid}`;
const JWT_SECRET = "test-jwt-secret-dat-lang-genoeg-is-0123456789";
const hasTools = spawnSync(process.env.HQ_FFMPEG || "ffmpeg", ["-version"]).status === 0;
let server, base, fakeAuth, fakeClaude, fakeBuffer, mods = {};
const owner = { id: randomUUID(), email: "eigenaar@test.nl", role: "eigenaar", aal: "aal2" };
const staff = { id: randomUUID(), email: "medewerker@test.nl", role: "medewerker", aal: "aal1" };
const sign = (u) => new SignJWT({ email: u.email, role: "authenticated", aal: u.aal, session_id: randomUUID() })
  .setProtectedHeader({ alg: "HS256" }).setSubject(u.id).setIssuer(`${process.env.SUPABASE_URL}/auth/v1`).setAudience("authenticated").setIssuedAt().setExpirationTime("1h")
  .sign(new TextEncoder().encode(JWT_SECRET));
async function req(p, { method = "GET", user = owner, body } = {}) {
  const h = { cookie: `__Host-sw_hq_at=${await sign(user)}` };
  if (method !== "GET") { h["x-hq-request"] = "1"; h.origin = base; }
  if (body !== undefined) h["content-type"] = "application/json";
  const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch {}
  return { status: r.status, json };
}

// Nagebootste Claude API: telt aanroepen; kan "onvoldoende tegoed" melden.
const claude = { calls: 0, credit: true };
// Nagebootste Buffer: wachtrij met limiet, "verwerkt maar geen antwoord", status per post.
const buf = { posts: [], creates: 0, limit: 10, hangOnce: false, sentIds: new Set() };

before(async () => {
  const admin = new pg.Client({ connectionString: BASE_DB }); await admin.connect();
  await admin.query(`drop database if exists ${DB_NAME}`); await admin.query(`create database ${DB_NAME}`); await admin.end();
  const dbUrl = BASE_DB.replace(/\/[^/]*$/, `/${DB_NAME}`);
  fakeAuth = http.createServer((rq, rs) => { rs.writeHead(404); rs.end(); });
  await new Promise(r => fakeAuth.listen(0, "127.0.0.1", r));
  fakeClaude = http.createServer(async (rq, rs) => {
    let body = ""; for await (const c of rq) body += c;
    claude.calls++;
    if (!claude.credit) { rs.writeHead(400, { "content-type": "application/json" }); return rs.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } })); }
    rs.writeHead(500); rs.end("{}"); // geen echte antwoorden nodig in deze tests
  });
  await new Promise(r => fakeClaude.listen(0, "127.0.0.1", r));
  fakeBuffer = http.createServer(async (rq, rs) => {
    let body = ""; for await (const c of rq) body += c;
    const { query, variables } = JSON.parse(body || "{}");
    const send = (data) => { rs.writeHead(200, { "content-type": "application/json" }); rs.end(JSON.stringify({ data })); };
    if (/createPost/.test(query)) {
      const queued = buf.posts.filter(p => p.status === "buffer").length;
      if (queued >= buf.limit) return send({ createPost: { message: "You have reached the limit of 10 scheduled posts for this channel. Upgrade to schedule more." } });
      buf.creates++;
      const post = { id: `b${buf.posts.length + 1}`, text: variables.input.text, dueAt: variables.input.dueAt, status: "buffer", channelId: variables.input.channelId, assets: variables.input.assets };
      buf.posts.push(post);
      if (buf.hangOnce) { buf.hangOnce = false; return; } // verwerkt, maar het antwoord komt nooit aan
      return send({ createPost: { post: { id: post.id, status: post.status, dueAt: post.dueAt } } });
    }
    if (/posts\(input/.test(query)) return send({ posts: { edges: buf.posts.filter(p => p.channelId === variables.ch).map(n => ({ node: n })) } });
    if (/post\(input/.test(query)) {
      const p = buf.posts.find(x => x.id === variables.id);
      return send({ post: p ? { id: p.id, status: buf.sentIds.has(p.id) ? "sent" : p.status, dueAt: p.dueAt, sentAt: buf.sentIds.has(p.id) ? new Date().toISOString() : null, externalLink: buf.sentIds.has(p.id) ? `https://www.tiktok.com/@strakwerk/video/${p.id}` : null, error: null } : null });
    }
    if (/organizations/.test(query)) return send({ account: { organizations: [{ id: "org1", name: "StrakWerk" }] } });
    if (/channels\(input/.test(query)) return send({ channels: [{ id: "ch-ig", name: "strakwerk", service: "instagram" }, { id: "ch-tt", name: "strakwerk", service: "tiktok" }] });
    send({});
  });
  await new Promise(r => fakeBuffer.listen(0, "127.0.0.1", r));
  Object.assign(process.env, {
    DATABASE_URL: dbUrl, SUPABASE_URL: `http://127.0.0.1:${fakeAuth.address().port}`, SUPABASE_PUBLISHABLE_KEY: "test-publishable",
    SUPABASE_JWT_SECRET: JWT_SECRET, CRON_SECRET: "test-cron-0123456789", HQ_TEST_MODE: "1", HQ_STORAGE: "local",
    HQ_MEDIA_DIR: mkdtempSync(path.join(tmpdir(), "hq-media-")), HQ_TEST_MEDIA_BASE: "https://media.test",
    ANTHROPIC_API_KEY: "test-sleutel", ANTHROPIC_BASE_URL: `http://127.0.0.1:${fakeClaude.address().port}`,
    BUFFER_API_KEY: "test-buffer", BUFFER_API_BASE: `http://127.0.0.1:${fakeBuffer.address().port}`, BUFFER_HTTP_TIMEOUT_MS: "1500",
  });
  delete process.env.SUPABASE_SECRET_KEY; delete process.env.IG_APP_ID;
  const { migrate } = await import("../scripts/migrate.mjs");
  await migrate(dbUrl, { log: () => {} });
  mods.db = await import("../api/_lib/db.js");
  mods.worker = await import("../api/_lib/worker.js");
  mods.studio = await import("../api/_lib/content/studio.js");
  mods.office = await import("../api/_lib/content/office.js");
  mods.budget = await import("../api/_lib/budget.js");
  mods.render = await import("../scripts/render-worker.mjs");
  for (const u of [owner, staff]) await mods.db.q("insert into hq.members (user_id, email, role, status) values ($1,$2,$3,'actief')", [u.id, u.email, u.role]);
  const { createServer } = await import("../scripts/dev-server.mjs");
  server = createServer();
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await mods.db?.closePool();
  server?.close(); fakeAuth?.close(); fakeClaude?.close(); fakeBuffer?.close();
  const admin = new pg.Client({ connectionString: BASE_DB }); await admin.connect();
  await admin.query(`drop database if exists ${DB_NAME} with (force)`); await admin.end();
});

const runServerless = async () => {
  for (let i = 0; i < 40; i++) {
    await mods.db.q("update hq.tasks set run_after=now() where status='in_wachtrij' and agent_key not in ('video','publisher')");
    await mods.worker.runWorker({ source: "test", budgetMs: 120_000 });
    const left = (await mods.db.q("select count(*)::int n from hq.tasks where agent_key not in ('video','publisher') and status in ('in_wachtrij','bezig')")).rows[0].n;
    if (!left) return;
    await new Promise(r => setTimeout(r, 250));
  }
};
// Draait publisher-taken tot er geen meer bezig of aan de beurt is. Goedkeuren start (net als in
// productie) ook een achtergrondwerker, die dezelfde taak eerder kan oppakken; zonder te wachten
// las de test dan soms een tussenstand.
const runPublisher = async () => {
  await mods.db.q("update hq.tasks set run_after=now() where status='in_wachtrij' and agent_key='publisher'");
  for (let i = 0; i < 200; i++) {
    await mods.worker.runWorker({ source: "test", budgetMs: 60_000 });
    const n = (await mods.db.q("select count(*)::int n from hq.tasks where agent_key='publisher' and (status='bezig' or (status='in_wachtrij' and control is null and run_after<=now()))")).rows[0].n;
    if (!n) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("Publisher-taak bleef bezig.");
};
const counts = async () => (await mods.db.q("select (select count(*)::int from hq.tasks where agent_key in ('content','video')) as tasks, (select count(*)::int from hq.renders) as renders, (select count(*)::int from hq.ai_reservations) as ai")).rows[0];
let pieceId;

test("kantoor: 3 video's per week voor StrakWerk zelf, met nul klantprojecten", async () => {
  const ov = (await req("/api/hq/studio/office")).json;
  assert.equal(ov.plan.weekly_limit, 3, "startinstelling: drie video's per week");
  assert.equal(ov.plan.live_publishing, false, "live publicatie staat standaard uit");
  assert.equal((await mods.db.q("select count(*)::int n from hq.project_assets where project_id is not null and social_ok")).rows[0].n, 0, "geen enkel klantproject vrijgegeven");
  assert.equal((await req("/api/hq/studio/office", { method: "PUT", user: staff, body: { enabled: true } })).status, 403);
  const r = await req("/api/hq/studio/office", { method: "PUT", body: { enabled: true, weekly_limit: 3, weekdays: [1, 2, 3, 4, 5, 6, 7], post_time: "18:30",
    channels: { instagram: { enabled: true, mode: "auto", route: "buffer" }, tiktok: { enabled: true, mode: "review", route: "buffer" } } } });
  assert.equal(r.status, 200);
  await mods.studio.ensurePortfolio();
  await mods.db.q("insert into hq.settings (key, value) values ('brand', $1) on conflict (key) do update set value=excluded.value", [{ socials: { instagram: "strakwerk", tiktok: "strakwerk" }, buffer_channels: { instagram: "ch-ig", tiktok: "ch-tt" } }]);
  // Een maand lang ticks: nooit meer dan 3 per week, en gelijktijdige ticks maken niets dubbel.
  const start = new Date("2026-11-23T06:00:00Z");
  for (let d = 0; d < 28; d++) { const at = new Date(start.getTime() + d * 864e5); await Promise.all([mods.office.officeTick(at), mods.office.officeTick(at)]); }
  const rows = (await mods.db.q("select slot_at, project_id, kind, topic_key from hq.content_pieces where origin='automatisering' order by slot_at")).rows;
  assert.ok(rows.length >= 12, `minstens 12 video's in 4 weken (${rows.length})`);
  const { isoWeekKey } = mods.studio;
  const perWeek = {}; for (const x of rows) perWeek[isoWeekKey(new Date(x.slot_at))] = (perWeek[isoWeekKey(new Date(x.slot_at))] || 0) + 1;
  assert.ok(Object.values(perWeek).every(n => n <= 3), JSON.stringify(perWeek));
  assert.ok(rows.every(x => x.project_id === null && x.kind === "merk"), "alles voor StrakWerk zelf, geen klantproject nodig");
  assert.equal(new Set(rows.map(x => x.slot_at.toISOString())).size, rows.length, "één video per publicatiemoment");
  assert.deepEqual([...new Set(rows.map(x => x.topic_key))].sort(), ["configurator", "pakketten", "prijs"]);
  // Voor de rest van de tests alleen de eerste video houden.
  await mods.db.q("delete from hq.content_pieces where id <> (select id from hq.content_pieces where topic_key='prijs' order by slot_at limit 1)");
  pieceId = (await mods.db.q("select id from hq.content_pieces")).rows[0].id;
});

test("lege AI-portemonnee: AI-taken pauzeren, geen aanroep, hervatten zonder dubbele uitvoer", async () => {
  // Tegoed bevestigd, AI aan, maar de HQ-limiet is te klein voor één aanroep.
  const now = Date.now();
  const r = await req("/api/hq/ai/budget", { method: "PUT", body: { period_start: new Date(now - 864e5).toISOString(), period_end: new Date(now + 20 * 864e5).toISOString(), granted_usd: 100, hq_limit_usd: 0.01, confirmed: true, enabled: true } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await runServerless();
  const t = (await mods.db.q("select status, pause_reason, attempts from hq.tasks where piece_id=$1 and kind='content_plan'", [pieceId])).rows[0];
  assert.equal(t.status, "gepauzeerd"); assert.equal(t.pause_reason, "budget");
  assert.equal(claude.calls, 0, "geen enkele aanroep naar Claude");
  const wq = (await req("/api/hq/studio/overview")).json;
  const p = wq.pieces.find(x => x.id === pieceId);
  assert.ok(p.actions.some(a => a.code === "ai_budget"), "melding: jouw actie nodig");
  const ov = (await req("/api/hq/ai/budget")).json;
  assert.equal(ov.active, false); assert.equal(ov.waiting_tasks, 1);
  assert.equal(ov.byDepartment.marketing.calls, 0);
  // Tegoed op bij Anthropic: limiet ruim, maar de API meldt onvoldoende saldo.
  claude.credit = false;
  await req("/api/hq/ai/budget", { method: "PUT", body: { hq_limit_usd: 80 } });
  await runServerless();
  assert.equal(claude.calls, 1, "één aanroep, die 'onvoldoende tegoed' gaf");
  const b2 = (await req("/api/hq/ai/budget")).json;
  assert.equal(b2.reason, "saldo");
  const t2 = (await mods.db.q("select status, pause_reason from hq.tasks where piece_id=$1 and kind='content_plan'", [pieceId])).rows;
  assert.equal(t2.length, 1, "nog steeds dezelfde ene taak"); assert.equal(t2[0].status, "gepauzeerd");
  assert.equal((await mods.db.q("select coalesce(sum(actual_usd),0)::float s from hq.ai_reservations")).rows[0].s, 0, "afgewezen aanroep kost niets");
  // AI uit (voorbeelddata), opnieuw bevestigen: dezelfde taak loopt verder met vaste voorbeeldteksten.
  claude.credit = true;
  await req("/api/hq/ai/budget", { method: "PUT", body: { enabled: false, confirmed: true, resume: true } });
  assert.equal((await mods.db.q("select status from hq.tasks where piece_id=$1 and kind='content_plan'", [pieceId])).rows[0].status, "in_wachtrij", "bevestigen hervat dezelfde taak");
  await runServerless();
  const t3 = (await mods.db.q("select status from hq.tasks where piece_id=$1 and kind='content_plan'", [pieceId])).rows;
  assert.deepEqual(t3.map(x => x.status), ["afgerond"], "één plan, afgerond");
  assert.equal(claude.calls, 1, "geen extra aanroep: AI staat uit");
  const pc = (await mods.db.q("select status, script from hq.content_pieces where id=$1", [pieceId])).rows[0];
  assert.equal(pc.script.opening, "Wat kost een website laten maken?");
  assert.equal(pc.script.scenes.at(-1).text, "Bereken jouw website op **strakwerkk.nl**");
});

test("reserveringen: gelijktijdige aanvragen gaan samen nooit boven de HQ-limiet", async () => {
  const now = Date.now();
  // Deze test gaat over de totale HQ-limiet: geef de post "sales" tijdelijk het hele budget.
  const prevAi = (await mods.db.q("select value from hq.settings where key='sales_ai'")).rows[0].value;
  await mods.db.q("update hq.settings set value = jsonb_set(value, '{posts}', $1) where key='sales_ai'", [{ sales: 100, voorbeeldsite: 0, acquisitie: 0, websitecheck: 0, controle: 0, overig: 0 }]);
  await req("/api/hq/ai/budget", { method: "PUT", body: { period_start: new Date(now - 864e5).toISOString(), period_end: new Date(now + 20 * 864e5).toISOString(), hq_limit_usd: 1, confirmed: true, enabled: true } });
  const tries = await Promise.allSettled(Array.from({ length: 8 }, () => mods.budget.reserve({ department: "sales", maxUsd: 0.3, model: "claude-opus-5-5" })));
  const ok = tries.filter(t => t.status === "fulfilled").length;
  assert.equal(ok, 3, "3 × $0,30 past binnen $1, de vierde niet");
  assert.ok(tries.filter(t => t.status === "rejected").every(t => t.reason.budget), "de rest: budgetfout");
  const ov = (await req("/api/hq/ai/budget")).json;
  assert.ok(Math.abs(ov.hq_reserved_usd - 0.9) < 1e-6);
  assert.equal(ov.reason, "plafond"); assert.equal(ov.active, false, "plafond bereikt: AI-taken pauzeren");
  await mods.db.q("delete from hq.ai_reservations");
  await mods.db.q("update hq.settings set value=$1 where key='sales_ai'", [prevAi]);
  await req("/api/hq/ai/budget", { method: "PUT", body: { enabled: false } });
});

test("budget per post: openbare websitecheck kan nooit het hele tegoed opmaken; budget volgt betalende klanten", async () => {
  const now = Date.now();
  await req("/api/hq/ai/budget", { method: "PUT", body: { period_start: new Date(now - 864e5).toISOString(), period_end: new Date(now + 20 * 864e5).toISOString(), hq_limit_usd: 10, confirmed: true, enabled: true } });
  // Basisverdeling: websitecheck 20% van $10 = $2 → vier keer $0,50 past, de vijfde niet.
  const tries = [];
  for (let i = 0; i < 5; i++) tries.push(await mods.budget.reserve({ department: "overig", post: "websitecheck", maxUsd: 0.5, model: "claude-sonnet-5-5" }).then(() => "ok", (e) => e.reason));
  assert.deepEqual(tries, ["ok", "ok", "ok", "ok", "post"]);
  const ov = (await req("/api/hq/ai/budget")).json;
  assert.equal(ov.active, true, "een volle post pauzeert de rest van HQ niet");
  const wc = ov.posts.items.find(x => x.post === "websitecheck");
  assert.equal(wc.cap_usd, 2); assert.equal(ov.posts.learned, false); assert.match(ov.posts.note, /onvoldoende bewijs/);
  // Andere posten hebben hun eigen ruimte (voorbeeldsite 25% = $2,50).
  await mods.budget.reserve({ department: "sales", post: "voorbeeldsite", maxUsd: 2.4, model: "claude-opus-5-5" });
  // Drie betalende klanten (echt, geen test): twee via bellen, één via de websitecheck → verdeling past zich aan.
  for (const [i, ch] of [[1, "bellen"], [2, "bellen"], [3, "websitecheck"]]) {
    const l = (await mods.db.q("insert into hq.leads (company, company_key, source, status, sales_channel) values ($1,$2,'handmatig','gewonnen',$3) returning id", [`Betaald ${i}`, `betaald-${i}`, ch])).rows[0];
    await mods.db.q("insert into hq.payments (lead_id, amount_cents, received_on, kind) values ($1, 10000, current_date, 'aanbetaling')", [l.id]);
  }
  const sh = await mods.budget.postShares();
  assert.equal(sh.learned, true);
  // Lerende posten (65% samen): helft basis, helft naar betaalde klanten (acquisitie 2/3, websitecheck 1/3).
  assert.equal(sh.shares.acquisitie, Math.round((0.5 * 20 + 0.5 * 65 * 2 / 3) * 10) / 10);
  assert.equal(sh.shares.websitecheck, Math.round((0.5 * 20 + 0.5 * 65 / 3) * 10) / 10);
  assert.equal(sh.shares.voorbeeldsite, 12.5, "geen betaalde klant via een voorbeeldsite: alleen de helft van de basis");
  assert.equal(sh.shares.sales, 15, "sales, controle en overig blijven vast");
  const total = Object.values(sh.shares).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 100) < 0.2, `samen ${total}%`);
  await mods.db.q("delete from hq.payments where lead_id in (select id from hq.leads where company like 'Betaald %')");
  await mods.db.q("delete from hq.leads where company like 'Betaald %'");
  await mods.db.q("delete from hq.ai_reservations");
  await req("/api/hq/ai/budget", { method: "PUT", body: { enabled: false } });
});

test("StrakWerk-video zonder klantproject: echte configurator, prijzen van de site, afspeelbare MP4", { skip: hasTools ? false : "ffmpeg/Chromium niet beschikbaar" }, async () => {
  await mods.render.runRenderWorker({ log: () => {} });
  const d = (await req(`/api/hq/studio/pieces/${pieceId}`)).json;
  const r = d.renders[0];
  assert.equal(r.status, "klaar", JSON.stringify(r)); assert.equal(r.width, 1080); assert.equal(r.height, 1920);
  assert.ok(r.duration_s >= 15 && r.duration_s <= 25);
  const s = d.piece.script;
  const prices = s.scenes.find(x => x.type === "prices").items.map(i => i.price_eur);
  const { readConfig } = await import("../scripts/sync-site-data.mjs");
  const cfg = readConfig((await import("node:fs")).readFileSync(new URL("../index.html", import.meta.url), "utf8"));
  assert.deepEqual(prices, [cfg.bases.nieuw.price, cfg.bases.premium.price, cfg.bases.pro.price], "prijzen uit de actuele website");
  assert.ok(s.scenes.some(x => x.type === "screen" && x.asset === "/brand/configurator-mobiel.mp4"), "eigen schermopname van de configurator");
  // Instagram staat op automatisch: na de render direct ingepland via Buffer (proefstand).
  const ig = d.piece.publications.find(x => x.channel === "instagram");
  assert.equal(ig?.method, "buffer"); assert.equal(ig.status, "ingepland");
  assert.ok(!d.piece.publications.some(x => x.channel === "tiktok"), "TikTok wacht op jouw beoordeling");
  assert.ok(d.piece.actions.some(a => a.code === "review"));
});

test("tijd wijzigen kost geen AI-aanroep en geen nieuwe render", { skip: hasTools ? false : "ffmpeg/Chromium niet beschikbaar" }, async () => {
  const before = await counts();
  const pub = (await mods.db.q("select id, task_id from hq.publications where piece_id=$1 and channel='instagram'", [pieceId])).rows[0];
  const r = await req(`/api/hq/studio/publications/${pub.id}/tijd`, { method: "POST", body: { at_local: "2026-12-04T19:15" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const after = await counts();
  assert.deepEqual(after, before, "geen nieuwe taken, renders of AI-reserveringen");
  const row = (await mods.db.q("select p.scheduled_at, t.run_after from hq.publications p join hq.tasks t on t.id=p.task_id where p.id=$1", [pub.id])).rows[0];
  assert.equal(row.scheduled_at.toISOString(), "2026-12-04T18:15:00.000Z", "19:15 Nederlandse tijd");
  assert.equal(row.run_after.toISOString(), "2026-12-04T18:15:00.000Z");
});

test("proefstand: live publicatie uit → klaar als concept, niets naar Buffer", { skip: hasTools ? false : "ffmpeg/Chromium niet beschikbaar" }, async () => {
  await runPublisher();
  const pub = (await mods.db.q("select status, external_container_id from hq.publications where piece_id=$1 and channel='instagram'", [pieceId])).rows[0];
  assert.equal(pub.status, "concept_klaar"); assert.equal(pub.external_container_id, null);
  assert.equal(buf.creates, 0, "niets bij Buffer aangemaakt");
  const ov = (await req("/api/hq/studio/overview")).json.pieces.find(x => x.id === pieceId);
  assert.notEqual(ov.column, "gepubliceerd", "proef telt niet als gepubliceerd");
});

test("volle wachtrij bij Buffer: bewaren, later opnieuw; onduidelijke uitkomst: hervatten zonder dubbele post", { skip: hasTools ? false : "ffmpeg/Chromium niet beschikbaar" }, async () => {
  await req("/api/hq/studio/office", { method: "PUT", body: { live_publishing: true } });
  // 1. Wachtrij vol (10 andere posts staan al klaar), al vóór het goedkeuren: welke werker de
  // publicatie ook als eerste oppakt (de achtergrondwerker of de test), de uitkomst is dezelfde.
  for (let i = 0; i < 10; i++) buf.posts.push({ id: `x${i}`, text: `ander ${i}`, dueAt: new Date().toISOString(), status: "buffer", channelId: "ch-tt" });
  // TikTok staat op "eerst beoordelen": goedkeuren plant hem in via Buffer op het publicatiemoment.
  const d = (await req(`/api/hq/studio/pieces/${pieceId}`)).json;
  const ap = await req(`/api/hq/studio/pieces/${pieceId}/approve`, { method: "POST", body: { render_id: d.renders[0].id } });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  assert.equal(ap.json.scheduled.tiktok?.method, "buffer");
  const tt = (await mods.db.q("select id from hq.publications where piece_id=$1 and channel='tiktok'", [pieceId])).rows[0].id;
  await runPublisher();
  let p = (await mods.db.q("select status, last_error from hq.publications where id=$1", [tt])).rows[0];
  assert.equal(p.status, "wachtrij_vol"); assert.match(p.last_error, /later opnieuw/);
  assert.equal(buf.creates, 0);
  const task = (await mods.db.q("select status, run_after from hq.tasks where id=(select task_id from hq.publications where id=$1)", [tt])).rows[0];
  assert.equal(task.status, "in_wachtrij"); assert.ok(new Date(task.run_after) > new Date(Date.now() + 2 * 3600e3), "over een paar uur opnieuw");
  // 2. Ruimte vrij, maar Buffer verwerkt de post zonder te antwoorden (time-out).
  buf.posts = buf.posts.filter(x => !x.id.startsWith("x"));
  buf.hangOnce = true;
  await Promise.all([runPublisher(), runPublisher()]);
  p = (await mods.db.q("select status from hq.publications where id=$1", [tt])).rows[0];
  assert.equal(p.status, "onzeker");
  // 3. Hervatten: HQ zoekt eerst in Buffer en neemt de bestaande post over; geen tweede post.
  await Promise.all([runPublisher(), runPublisher()]);
  await runPublisher();
  p = (await mods.db.q("select status, external_container_id from hq.publications where id=$1", [tt])).rows[0];
  assert.equal(p.status, "bij_dienst"); assert.equal(buf.creates, 1, "precies één post bij Buffer");
  assert.equal(buf.posts.filter(x => x.channelId === "ch-tt").length, 1);
  assert.ok(buf.posts[0].assets[0].video.url.startsWith("https://media.test/renders/"), "video als URL aangeleverd");
  // 4. Pas "gepubliceerd" als Buffer de post als verstuurd meldt.
  let wq = (await req("/api/hq/studio/overview")).json.pieces.find(x => x.id === pieceId);
  assert.notEqual(wq.publications.find(x => x.channel === "tiktok").status, "gepubliceerd");
  buf.sentIds.add(p.external_container_id);
  await runPublisher();
  p = (await mods.db.q("select status, permalink, external_id from hq.publications where id=$1", [tt])).rows[0];
  assert.equal(p.status, "gepubliceerd"); assert.match(p.permalink, /tiktok\.com/);
  assert.equal(buf.creates, 1, "nog steeds één post");
  // Een gepubliceerde post kan niet opnieuw worden gestart of in tijd worden gewijzigd.
  assert.equal((await req(`/api/hq/studio/publications/${tt}/opnieuw`, { method: "POST", body: {} })).status, 409);
  assert.equal((await req(`/api/hq/studio/publications/${tt}/tijd`, { method: "POST", body: { at_local: "2026-12-05T10:00" } })).status, 409);
});
