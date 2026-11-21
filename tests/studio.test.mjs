// Integratietests voor de contentstudio: van klantproject naar afspeelbare video en
// publicatie. Draait tegen een echte Postgres (TEST_DATABASE_URL), de lokale dev-server,
// een nagebootste Supabase Auth en een nagebootste Instagram API. Renders gebruiken echte
// ffmpeg en Chromium (zoals de render-worker); zonder die hulpmiddelen worden die tests
// overgeslagen met een duidelijke reden.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { SignJWT } from "jose";

const BASE_DB = process.env.TEST_DATABASE_URL || "postgres://postgres@127.0.0.1:54329/postgres";
const DB_NAME = `hq_studio_${process.pid}`;
const JWT_SECRET = "test-jwt-secret-dat-lang-genoeg-is-0123456789";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const hasTools = spawnSync(process.env.HQ_FFMPEG || "ffmpeg", ["-version"]).status === 0;
let server, base, fakeAuth, fakeIg, mods = {};
const users = {
  owner: { id: randomUUID(), email: "eigenaar@test.nl", role: "eigenaar", aal: "aal2" },
  staff: { id: randomUUID(), email: "medewerker@test.nl", role: "medewerker", aal: "aal1" },
  ro: { id: randomUUID(), email: "lezer@test.nl", role: "alleen_lezen", aal: "aal1" },
};
const sign = (u) => new SignJWT({ email: u.email, role: "authenticated", aal: u.aal, session_id: randomUUID() })
  .setProtectedHeader({ alg: "HS256" }).setSubject(u.id).setIssuer(`${process.env.SUPABASE_URL}/auth/v1`).setAudience("authenticated").setIssuedAt().setExpirationTime("1h")
  .sign(new TextEncoder().encode(JWT_SECRET));
const cookieFor = async (u) => `__Host-sw_hq_at=${await sign(u)}`;
async function req(p, { method = "GET", cookie, body, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (method !== "GET") { h["x-hq-request"] = "1"; h.origin = base; }
  if (body !== undefined) h["content-type"] = "application/json";
  const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch {}
  return { status: r.status, headers: r.headers, buf, json };
}

// Nagebootste Instagram API: houdt bij hoe vaak er echt gepubliceerd is.
const igState = { containers: {}, media: [], publishCalls: 0, hangPublishOnce: false };
function fakeInstagram() {
  return http.createServer(async (rq, rs) => {
    let body = ""; for await (const c of rq) body += c;
    const u = new URL(rq.url, "http://x"), parts = u.pathname.split("/").filter(Boolean); // [v24.0, ...]
    const send = (code, j) => { rs.writeHead(code, { "content-type": "application/json" }); rs.end(JSON.stringify(j)); };
    const p = Object.fromEntries(new URLSearchParams(body));
    if (rq.method === "POST" && parts[2] === "media") {
      const id = `c${Object.keys(igState.containers).length + 1}`;
      igState.containers[id] = { status: "FINISHED", caption: p.caption, video_url: p.video_url, media_type: p.media_type };
      return send(200, { id });
    }
    if (rq.method === "POST" && parts[2] === "media_publish") {
      const c = igState.containers[p.creation_id];
      if (!c) return send(400, { error: { message: "Onbekende container", code: 100 } });
      if (c.status === "PUBLISHED") return send(400, { error: { message: "Al gepubliceerd", code: 9007 } });
      igState.publishCalls++;
      const mid = `m${igState.media.length + 1}`;
      c.status = "PUBLISHED";
      igState.media.unshift({ id: mid, caption: c.caption, timestamp: new Date().toISOString(), permalink: `https://www.instagram.com/reel/${mid}/` });
      if (igState.hangPublishOnce) { igState.hangPublishOnce = false; return; } // verwerkt, maar geen antwoord (time-out)
      return send(200, { id: mid });
    }
    if (rq.method === "GET" && parts[2] === "media") return send(200, { data: igState.media });
    if (rq.method === "GET" && igState.containers[parts[1]]) return send(200, { status_code: igState.containers[parts[1]].status });
    const m = igState.media.find(x => x.id === parts[1]);
    if (rq.method === "GET" && m) return send(200, { id: m.id, permalink: m.permalink, timestamp: m.timestamp });
    send(404, { error: { message: "niet gevonden", code: 100 } });
  });
}

before(async () => {
  const admin = new pg.Client({ connectionString: BASE_DB }); await admin.connect();
  await admin.query(`drop database if exists ${DB_NAME}`); await admin.query(`create database ${DB_NAME}`); await admin.end();
  const dbUrl = BASE_DB.replace(/\/[^/]*$/, `/${DB_NAME}`);
  fakeAuth = http.createServer((rq, rs) => { rs.writeHead(404); rs.end(); });
  await new Promise(r => fakeAuth.listen(0, "127.0.0.1", r));
  fakeIg = fakeInstagram();
  await new Promise(r => fakeIg.listen(0, "127.0.0.1", r));
  Object.assign(process.env, {
    DATABASE_URL: dbUrl, SUPABASE_URL: `http://127.0.0.1:${fakeAuth.address().port}`, SUPABASE_PUBLISHABLE_KEY: "test-publishable",
    SUPABASE_JWT_SECRET: JWT_SECRET, CRON_SECRET: "test-cron-0123456789", HQ_TEST_MODE: "1", HQ_STORAGE: "local",
    HQ_MEDIA_DIR: mkdtempSync(path.join(tmpdir(), "hq-media-")), HQ_TEST_MEDIA_BASE: "https://media.test",
    IG_APP_ID: "test-app", IG_APP_SECRET: "test-secret", HQ_ENCRYPTION_KEY: "test-encryptie-sleutel-0123456789",
    IG_GRAPH_BASE: `http://127.0.0.1:${fakeIg.address().port}`, IG_HTTP_TIMEOUT_MS: "1500",
  });
  delete process.env.ANTHROPIC_API_KEY; delete process.env.SUPABASE_SECRET_KEY;
  const { migrate } = await import("../scripts/migrate.mjs");
  await migrate(dbUrl, { log: () => {} });
  mods.db = await import("../api/_lib/db.js");
  mods.worker = await import("../api/_lib/worker.js");
  mods.studio = await import("../api/_lib/content/studio.js");
  mods.render = await import("../scripts/render-worker.mjs");
  for (const u of Object.values(users)) await mods.db.q("insert into hq.members (user_id, email, role, status) values ($1,$2,$3,'actief')", [u.id, u.email, u.role]);
  const { createServer } = await import("../scripts/dev-server.mjs");
  server = createServer();
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await mods.db?.closePool();
  server?.close(); fakeAuth?.close(); fakeIg?.close();
  const admin = new pg.Client({ connectionString: BASE_DB }); await admin.connect();
  await admin.query(`drop database if exists ${DB_NAME} with (force)`); await admin.end();
});

// De dev-server start in dit proces ook zelf een worker na een API-aanroep; wacht tot
// alle serverloze taken echt klaar zijn (niet in wachtrij en niet bezig).
const runServerless = async () => {
  for (let i = 0; i < 40; i++) {
    await mods.db.q("update hq.tasks set run_after=now() where status='in_wachtrij' and agent_key<>'video'");
    await mods.worker.runWorker({ source: "test", budgetMs: 120_000 });
    const left = (await mods.db.q("select count(*)::int n from hq.tasks where agent_key<>'video' and status in ('in_wachtrij','bezig')")).rows[0].n;
    if (!left) return;
    await new Promise(r => setTimeout(r, 250));
  }
};
const glow = async () => (await mods.db.q("select * from hq.projects where slug='glow'")).rows[0];
let pieceId, renderId;

test("prijzen en actie komen uit dezelfde bron als de site", async () => {
  const site = JSON.parse(readFileSync(path.join(root, "api/_lib/content/site-data.json"), "utf8"));
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  const { readConfig } = await import("../scripts/sync-site-data.mjs");
  const cfg = readConfig(html);
  const pk = (await mods.db.q("select key, price_cents from hq.packages")).rows;
  for (const [k, b] of Object.entries(cfg.bases)) {
    assert.equal(site.bases[k].price_eur, b.price, `site-data ${k}`);
    assert.equal(pk.find(p => p.key === k).price_cents, b.price * 100, `hq.packages ${k} = CONFIG.bases`);
  }
  assert.equal(site.promo.until, cfg.promo.until);
  const { captionFor } = mods.studio;
  const script = { captions: { instagram: "Tekst\n\n#tag", promo_line: "Actie tot en met 30 november: x.", promo_until: "2026-12-01T00:00:00+01:00" } };
  assert.match(await captionFor(null, script, "instagram", new Date("2026-11-25T12:00:00Z")), /Actie tot en met/);
  assert.doesNotMatch(await captionFor(null, script, "instagram", new Date("2026-12-02T12:00:00Z")), /Actie/, "na de einddatum geen actieregel");
});

test("Nederlandse tijd: kalender rekent goed rond zomer- en wintertijd", () => {
  const { amsToUtc, amsParts } = mods.studio;
  assert.equal(amsToUtc(2026, 3, 29, 18, 30).toISOString(), "2026-03-29T16:30:00.000Z"); // zomertijd (UTC+2)
  assert.equal(amsToUtc(2026, 11, 24, 18, 30).toISOString(), "2026-11-24T17:30:00.000Z"); // wintertijd (UTC+1)
  assert.equal(amsParts(new Date("2026-10-25T00:30:00Z")).hh, 2);
});

test("beelden vrijgeven: rechten, blokkade en controle op beelden", async () => {
  const o = await cookieFor(users.owner), s = await cookieFor(users.staff);
  const ov = await req("/api/hq/studio/overview", { cookie: o });
  assert.equal(ov.status, 200);
  const g = await glow();
  assert.equal(g.status, "opgeleverd");
  const d = (await req(`/api/hq/studio/projects/${g.id}`, { cookie: o })).json;
  assert.ok(d.assets.length >= 6, "alle Glow-screenshots staan als beeld klaar");
  assert.ok(d.assets.every(a => !a.social_ok), "standaard niets vrijgegeven voor social media");
  const one = d.assets.find(a => a.path.endsWith("/glow.webp"));
  assert.match(one.notes, /actiebalk/); assert.ok(one.valid_until, "einddatum van de actie in beeld is vastgelegd");
  assert.equal((await req(`/api/hq/studio/assets/${one.id}`, { method: "PATCH", cookie: s, body: { social_ok: true } })).status, 403, "alleen de eigenaar geeft vrij");
  const cr = (await mods.db.q("select a.id from hq.project_assets a join hq.projects p on p.id=a.project_id where p.slug='cartronic' and a.path like '%reviews%'")).rows[0];
  assert.equal((await req(`/api/hq/studio/assets/${cr.id}`, { method: "PATCH", cookie: o, body: { social_ok: true } })).status, 409, "screenshot met reviews kan niet worden vrijgegeven");
  // Te weinig beelden: geen opdracht
  const r = await req("/api/hq/studio/pieces", { method: "POST", cookie: o, body: { project_id: g.id, audience: "saloneigenaren", goal: "aanvragen" } });
  assert.equal(r.status, 409); assert.equal(r.json.error, "te_weinig_beelden");
});

test("opgeleverd + vrijgegeven materiaal geeft precies één contentopdracht, ook bij herhaling en gelijktijdigheid", async () => {
  const o = await cookieFor(users.owner);
  const g = await glow();
  await req(`/api/hq/studio/projects/${g.id}`, { method: "PATCH", cookie: o, body: { status: "websitecontrole" } });
  const d = (await req(`/api/hq/studio/projects/${g.id}`, { cookie: o })).json;
  for (const a of d.assets.filter(a => !/salon|contact/.test(a.path))) {
    assert.equal((await req(`/api/hq/studio/assets/${a.id}`, { method: "PATCH", cookie: o, body: { social_ok: true } })).status, 200);
  }
  // Project is nog niet opgeleverd: vrijgeven alleen maakt nog geen opdracht.
  assert.equal((await mods.db.q("select count(*)::int n from hq.content_pieces")).rows[0].n, 0);
  const res = await Promise.all([1, 2, 3].map(() => req(`/api/hq/studio/projects/${g.id}`, { method: "PATCH", cookie: o, body: { status: "opgeleverd" } })));
  assert.ok(res.every(r => r.status === 200), res.map(r => r.status).join(","));
  await req(`/api/hq/studio/projects/${g.id}`, { method: "PATCH", cookie: o, body: { status: "nazorg" } });
  await req(`/api/hq/studio/projects/${g.id}`, { method: "PATCH", cookie: o, body: { status: "opgeleverd" } });
  const pieces = (await mods.db.q("select * from hq.content_pieces where project_id=$1", [g.id])).rows;
  assert.equal(pieces.length, 1, "één opdracht");
  assert.equal(pieces[0].origin, "oplevering"); assert.equal(pieces[0].audience, "saloneigenaren");
  pieceId = pieces[0].id;
});

test("planner: drie verschillende hoeken uit echte projectinformatie, zonder verzonnen claims", async () => {
  await runServerless();
  const o = await cookieFor(users.owner);
  const d = (await req(`/api/hq/studio/pieces/${pieceId}`, { cookie: o })).json;
  assert.equal(d.piece.status, "kiezen");
  const A = d.piece.angles;
  assert.equal(A.length, 3); assert.equal(new Set(A.map(a => a.key)).size, 3); assert.equal(new Set(A.map(a => a.opening)).size, 3);
  const pijn = A.find(a => a.key === "pijnpunt");
  assert.equal(pijn.opening, "Saloneigenaar, plan jij nog alles via DM?");
  assert.equal(pijn.cta, "Wil je dit voor jouw salon? App ‘SALON’.");
  const released = (await mods.db.q("select path from hq.project_assets where social_ok")).rows.map(r => r.path);
  const { contentGuard } = await import("../api/_lib/content/planner.js");
  for (const a of A) {
    assert.ok(a.scenes.length >= 4 && a.scenes.at(-1).type === "cta", "scènes met één oproep tot actie aan het eind");
    assert.equal(a.scenes.filter(s => s.type === "cta").length, 1);
    for (const p of a.assets_used) assert.ok(released.includes(p), `alleen vrijgegeven beelden (${p})`);
    assert.ok(!a.assets_used.some(p => /salon\.webp|contact/.test(p)), "niet vrijgegeven beelden worden niet gebruikt");
    const all = [...a.scenes.map(s => `${s.kicker || ""} ${s.text} ${s.sub || ""}`), a.captions.instagram, a.captions.tiktok].join("\n");
    assert.deepEqual(contentGuard(all, { allowedPrices: [200] }), [], a.key);
    assert.match(a.captions.instagram, /€200/); assert.match(a.captions.instagram, /SALON/);
  }
  const scenesPijn = pijn.scenes.map(s => s.asset || "");
  assert.ok(scenesPijn.some(x => x.includes("behandelingen")) && scenesPijn.some(x => x.includes("boeken")), "toont behandelingen en de boekingsaanvraag");
});

test("render mislukt → begrijpelijke fout in de werkvoorraad → opnieuw proberen geeft een afspeelbare MP4", { skip: hasTools ? false : "ffmpeg/Chromium niet beschikbaar" }, async () => {
  const o = await cookieFor(users.owner);
  const d = (await req(`/api/hq/studio/pieces/${pieceId}`, { cookie: o })).json;
  const idx = d.piece.angles.findIndex(a => a.key === "pijnpunt");
  assert.equal((await req(`/api/hq/studio/pieces/${pieceId}/angle`, { method: "POST", cookie: await cookieFor(users.ro), body: { index: idx } })).status, 403);
  assert.equal((await req(`/api/hq/studio/pieces/${pieceId}/angle`, { method: "POST", cookie: o, body: { index: idx } })).status, 200);
  // Eerste render faalt: ffmpeg ontbreekt op de render-machine.
  const prev = process.env.HQ_FFMPEG; process.env.HQ_FFMPEG = "/bestaat/niet/ffmpeg";
  await mods.render.runRenderWorker({ log: () => {} });
  process.env.HQ_FFMPEG = prev || ""; if (!prev) delete process.env.HQ_FFMPEG;
  let wq = (await req("/api/hq/studio/overview", { cookie: o })).json;
  let p = wq.pieces.find(x => x.id === pieceId);
  assert.equal(p.column, "actie_nodig");
  assert.equal(p.render.status, "mislukt");
  assert.ok(p.actions.some(a => a.code === "render_mislukt" && /ffmpeg is niet geïnstalleerd/.test(a.text)), JSON.stringify(p.actions));
  // Opnieuw proberen: nieuwe versie, oude blijft bewaard.
  const rr = await req(`/api/hq/studio/pieces/${pieceId}/render`, { method: "POST", cookie: o, body: {} });
  assert.equal(rr.status, 201); assert.equal(rr.json.version, 2);
  assert.equal((await req(`/api/hq/studio/pieces/${pieceId}/render`, { method: "POST", cookie: o, body: {} })).json.duplicate, true, "dubbelklik maakt geen tweede render");
  wq = (await req("/api/hq/studio/overview", { cookie: o })).json;
  assert.equal(wq.pieces.find(x => x.id === pieceId).column, "render_bezig");
  await mods.render.runRenderWorker({ log: () => {} });
  wq = (await req("/api/hq/studio/overview", { cookie: o })).json;
  p = wq.pieces.find(x => x.id === pieceId);
  assert.equal(p.render.status, "klaar", JSON.stringify(p.render)); assert.equal(p.column, "klaar_voor_review");
  renderId = p.render.id;
  assert.ok(p.render.duration_s >= 15 && p.render.duration_s <= 25, `duur ${p.render.duration_s}`);
  // Afspelen (met Range, zoals iOS doet) en downloaden; zonder login niets.
  assert.equal((await req(`/api/hq/media/${renderId}/video`)).status, 401);
  const part = await req(`/api/hq/media/${renderId}/video`, { cookie: o, headers: { range: "bytes=0-1023" } });
  assert.equal(part.status, 206); assert.equal(part.buf.length, 1024); assert.equal(part.buf.toString("ascii", 4, 8), "ftyp");
  const full = await req(`/api/hq/media/${renderId}/video?download=1`, { cookie: o });
  assert.equal(full.status, 200); assert.match(full.headers.get("content-disposition"), /attachment; filename="strakwerk-glow-v2\.mp4"/);
  const f = path.join(tmpdir(), `glow-${process.pid}.mp4`);
  (await import("node:fs")).writeFileSync(f, full.buf);
  const pr = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name:format=duration", "-of", "json", f]);
  const info = JSON.parse(pr.stdout.toString());
  assert.equal(info.streams[0].width, 1080); assert.equal(info.streams[0].height, 1920); assert.equal(info.streams[0].codec_name, "h264");
  const cover = await req(`/api/hq/media/${renderId}/cover`, { cookie: o });
  assert.equal(cover.status, 200); assert.equal(cover.buf[0], 0xff);
});

test("één scène of caption aanpassen zonder nieuw concept; goedkeuring hoort bij exact die video", { skip: hasTools ? false : "ffmpeg/Chromium niet beschikbaar" }, async () => {
  const o = await cookieFor(users.owner), s = await cookieFor(users.staff);
  const bad = await req(`/api/hq/studio/pieces/${pieceId}/scenes/s3`, { method: "PATCH", cookie: s, body: { text: "30% meer boekingen dankzij reviews" } });
  assert.equal(bad.status, 422);
  const price = await req(`/api/hq/studio/pieces/${pieceId}/captions/tiktok`, { method: "PUT", cookie: s, body: { text: "Nu voor €99 een website!" } });
  assert.equal(price.status, 422, "geen prijs die niet uit de pakketten komt");
  const ok = await req(`/api/hq/studio/pieces/${pieceId}/captions/tiktok`, { method: "PUT", cookie: s, body: { text: "Plan jij nog alles via DM? Zo kan het ook. App ‘SALON’." } });
  assert.equal(ok.status, 200);
  const before = (await req(`/api/hq/studio/pieces/${pieceId}`, { cookie: o })).json.piece;
  const e = await req(`/api/hq/studio/pieces/${pieceId}/scenes/s3`, { method: "PATCH", cookie: s, body: { text: "Elke behandeling een **eigen pagina**" } });
  assert.equal(e.status, 200);
  const after = (await req(`/api/hq/studio/pieces/${pieceId}`, { cookie: o })).json.piece;
  assert.deepEqual(after.angles, before.angles, "concept blijft gelijk");
  assert.equal(after.script.scenes[2].text, "Elke behandeling een **eigen pagina**");
  assert.deepEqual(after.script.scenes.filter((_, i) => i !== 2), before.script.scenes.filter((_, i) => i !== 2), "alleen deze scène is gewijzigd");
  assert.equal(after.render_dirty, true);
  assert.equal((await req(`/api/hq/studio/pieces/${pieceId}/approve`, { method: "POST", cookie: o, body: { render_id: renderId } })).status, 409, "oude render kan niet meer worden goedgekeurd");
  // Origineel terugzetten maakt de oude render weer geldig.
  await req(`/api/hq/studio/pieces/${pieceId}/scenes/s3`, { method: "PATCH", cookie: s, body: { reset: true } });
  assert.equal((await req(`/api/hq/studio/pieces/${pieceId}/approve`, { method: "POST", cookie: s, body: { render_id: renderId } })).status, 403, "medewerker keurt niet goed");
  assert.equal((await req(`/api/hq/studio/pieces/${pieceId}/approve`, { method: "POST", cookie: o, body: { render_id: renderId } })).status, 200);
});

test("TikTok: export met MP4, cover en caption; zelf geplaatst markeren", { skip: hasTools ? false : "ffmpeg/Chromium niet beschikbaar" }, async () => {
  const o = await cookieFor(users.owner);
  const r = await req(`/api/hq/studio/pieces/${pieceId}/schedule`, { method: "POST", cookie: o, body: { channel: "tiktok", at_local: "2026-11-27T18:30" } });
  assert.equal(r.status, 201); assert.equal(r.json.method, "export"); assert.equal(r.json.status, "export_klaar");
  const pub = (await mods.db.q("select * from hq.publications where id=$1", [r.json.id])).rows[0];
  assert.equal(pub.scheduled_at.toISOString(), "2026-11-27T17:30:00.000Z", "18:30 Nederlandse tijd");
  assert.equal((await req(`/api/hq/studio/pieces/${pieceId}/schedule`, { method: "POST", cookie: o, body: { channel: "tiktok", at_local: "2026-11-28T18:30" } })).status, 409, "geen tweede TikTok-publicatie");
  const m = await req(`/api/hq/studio/publications/${r.json.id}/zelf_geplaatst`, { method: "POST", cookie: o, body: { permalink: "https://www.tiktok.com/@strakwerk/video/1" } });
  assert.equal(m.json.status, "handmatig_geplaatst");
});

test("Instagram: geen dubbele post bij een time-out na verzending of gelijktijdige uitvoering", { skip: hasTools ? false : "ffmpeg/Chromium niet beschikbaar" }, async () => {
  const o = await cookieFor(users.owner);
  // Koppeling (zoals na OAuth): token versleuteld op de server.
  const ig = await import("../api/_lib/content/instagram.js");
  await mods.db.q("insert into hq.integrations (key, account_id, account_name, token_enc, expires_at, connected_at) values ('instagram','17841400000000000','strakwerk',$1, now() + interval '50 days', now())", [ig.encrypt("geheim-test-token")]);
  const raw = (await mods.db.q("select token_enc from hq.integrations")).rows[0].token_enc;
  assert.ok(!raw.includes("geheim-test-token"), "token niet leesbaar opgeslagen");
  const ov = (await req("/api/hq/studio/overview", { cookie: o })).buf.toString();
  assert.ok(!ov.includes("geheim-test-token"), "token gaat nooit naar de browser");
  // Live publicatie staat standaard uit (proefstand); deze test gaat over echt plaatsen.
  assert.equal((await req("/api/hq/studio/office", { method: "PUT", cookie: o, body: { live_publishing: true } })).status, 200);
  const at = new Date(Date.now() + 10 * 60_000).toISOString();
  const r = await req(`/api/hq/studio/pieces/${pieceId}/schedule`, { method: "POST", cookie: o, body: { channel: "instagram", at, method: "api" } });
  assert.equal(r.status, 201, JSON.stringify(r.json)); assert.equal(r.json.method, "api");
  const pubId = r.json.id;
  // Nog niet het tijdstip: worker doet niets.
  await mods.worker.runWorker({ source: "test", budgetMs: 60_000 });
  assert.equal(igState.publishCalls, 0);
  // Tijdstip bereikt. Instagram verwerkt de publicatie, maar het antwoord komt nooit aan.
  igState.hangPublishOnce = true;
  for (let i = 0; i < 4; i++) await Promise.all([runServerless(), runServerless()]);
  const pub = (await mods.db.q("select * from hq.publications where id=$1", [pubId])).rows[0];
  assert.equal(pub.status, "gepubliceerd", JSON.stringify(pub));
  assert.equal(igState.publishCalls, 1, "precies één keer gepubliceerd");
  assert.equal(pub.external_id, igState.media[0].id); assert.match(pub.permalink, /instagram\.com\/reel/);
  assert.equal(Object.keys(igState.containers).length, 1, "één container");
  assert.match(igState.containers.c1.video_url, /^https:\/\/media\.test\/renders\//);
  assert.equal(igState.containers.c1.media_type, "REELS");
  // Opnieuw starten van een gepubliceerde publicatie kan niet.
  assert.equal((await req(`/api/hq/studio/publications/${pubId}/opnieuw`, { method: "POST", cookie: o, body: {} })).status, 409);
  const wq = (await req("/api/hq/studio/overview", { cookie: o })).json;
  assert.equal(wq.pieces.find(x => x.id === pieceId).column, "gepubliceerd");
});

test("herkomst: klik, aanvraag en geaccepteerde offerte blijven gescheiden; onbekend blijft onbekend", { skip: hasTools ? false : "ffmpeg/Chromium niet beschikbaar" }, async () => {
  const o = await cookieFor(users.owner);
  let ins = (await req("/api/hq/studio/insights", { cookie: o })).json;
  let row = ins.pieces.find(p => p.id === pieceId);
  assert.equal(row.views, null, "geen views gemeten = onbekend, geen 0");
  assert.equal(row.clicks, 0); assert.equal(row.requests, 0);
  const code = row.campaign_code;
  await mods.db.q("insert into hq.analytics_events (event_id, at, env, name, path, device, utm_campaign) values ($1, now(), 'production', 'page_view', '/', 'mobiel', $2)", [randomUUID(), code]);
  const lead = (await req("/api/hq/leads", { method: "POST", cookie: o, body: { company: "Salon Test", source: "aanvraag_whatsapp" } })).json.lead;
  const k = await req(`/api/hq/leads/${lead.id}/campaign`, { method: "POST", cookie: o, body: { keyword: "salon" } });
  assert.equal(k.status, 200); assert.equal(k.json.via, "whatsapp_woord"); assert.equal(k.json.piece_id, pieceId);
  await mods.db.q("update hq.packages set terms='Testvoorwaarden' where key='nieuw'");
  const qu = (await req(`/api/hq/leads/${lead.id}/quotes`, { method: "POST", cookie: o, body: { package_key: "nieuw" } })).json.quote;
  await mods.db.q("update hq.quotes set status='verstuurd' where id=$1", [qu.id]);
  assert.equal((await req(`/api/hq/quotes/${qu.id}/status`, { method: "POST", cookie: o, body: { status: "geaccepteerd" } })).status, 200);
  const proj = (await mods.db.q("select * from hq.projects where lead_id=$1", [lead.id])).rows;
  assert.equal(proj.length, 1, "akkoord maakt het klantproject aan"); assert.equal(proj[0].status, "akkoord");
  await req(`/api/hq/studio/publications/${(await mods.db.q("select id from hq.publications where piece_id=$1 and channel='instagram'", [pieceId])).rows[0].id}/metrics`, { method: "POST", cookie: o, body: { metric: "views", value: 812 } });
  ins = (await req("/api/hq/studio/insights", { cookie: o })).json;
  row = ins.pieces.find(p => p.id === pieceId);
  assert.deepEqual([row.views, row.clicks, row.requests, row.accepted, row.accepted_cents], [812, 1, 1, 1, 20000]);
  assert.match(ins.suggestion.text, /Van DM naar aanvraag/);
  assert.match(ins.suggestion.basis, /geaccepteerde offerte/);
});

test("automatisering: pauzeknop, weeklimiet en geen dubbele afleveringen", async () => {
  const o = await cookieFor(users.owner), s = await cookieFor(users.staff);
  assert.equal((await req("/api/hq/studio/automation", { method: "PUT", cookie: s, body: { channel: "instagram", format_key: "project_reel", enabled: true } })).status, 403);
  await req("/api/hq/studio/automation", { method: "PUT", cookie: o, body: { channel: "tiktok", format_key: "project_reel", enabled: true, weekly_limit: 1, weekdays: [2, 4], post_time: "18:30", audience: "saloneigenaren" } });
  // Format nog niet vrijgegeven: niets.
  assert.deepEqual((await mods.studio.automationTick()).made, []);
  await req("/api/hq/studio/formats/project_reel", { method: "PUT", cookie: o, body: { released: true } });
  await req("/api/hq/studio/settings", { method: "PUT", cookie: o, body: { paused: true } });
  assert.equal((await mods.studio.automationTick()).skipped, "gepauzeerd");
  await req("/api/hq/studio/settings", { method: "PUT", cookie: o, body: { paused: false } });
  const n0 = (await mods.db.q("select count(*)::int n from hq.content_pieces where origin='automatisering'")).rows[0].n;
  await Promise.all([mods.studio.automationTick(), mods.studio.automationTick()]);
  await mods.studio.automationTick();
  const n1 = (await mods.db.q("select count(*)::int n from hq.content_pieces where origin='automatisering'")).rows[0].n;
  assert.equal(n1 - n0, 1, "weeklimiet 1 = één aflevering, ook bij gelijktijdige runs");
  await req("/api/hq/studio/settings", { method: "PUT", cookie: o, body: { monthly_budget_usd: 0 } });
  assert.equal((await mods.studio.automationTick()).skipped, "kostenplafond");
  const cal = (await req("/api/hq/studio/calendar?days=14", { cookie: o })).json;
  assert.equal(cal.tz, "Europe/Amsterdam"); assert.ok(cal.slots.length >= 2);
});
