#!/usr/bin/env node
// Lokale, reproduceerbare demonstratie van de contentworkflow met Glow & Laser For You:
// beelden vrijgeven → automatische contentopdracht bij "opgeleverd" → drie hoeken →
// hoek "Van DM naar aanvraag" kiezen → video renderen (ffmpeg + Chromium) → goedkeuren →
// Instagram en TikTok als export klaarzetten. Publiceert niets op echte accounts.
//
//   DATABASE_URL=postgres://... npm run demo:glow [-- --out docs/hq/demo]
// Gebruik een lokale of test-database: het script maakt demogegevens aan.
import path from "node:path";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvFile } from "./dev-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function demoGlow({ out = null, log = console.log } = {}) {
  process.env.HQ_STORAGE ||= "local";
  const { migrate } = await import("./migrate.mjs");
  await migrate(process.env.DATABASE_URL, { log: () => {} });
  const { q, one } = await import("../api/_lib/db.js");
  const studio = await import("../api/_lib/content/studio.js");
  const { runWorker } = await import("../api/_lib/worker.js");
  const { runRenderWorker } = await import("./render-worker.mjs");
  const storage = await import("../api/_lib/content/storage.js");

  // Demo-eigenaar (alleen in de database; geen login).
  const owner = { userId: "00000000-0000-4000-8000-00000000d001", email: "demo@strakwerk.local", role: "eigenaar" };
  await q("insert into hq.members (user_id, email, role, status) values ($1,$2,'eigenaar','actief') on conflict do nothing", [owner.userId, owner.email]);
  await studio.ensurePortfolio();
  const glow = await one("select * from hq.projects where slug='glow'");
  log(`Project: ${glow.name} (${glow.status})`);

  // 1. Beelden vrijgeven (zoals Rayan in HQ doet). De salonfoto blijft uit: daar is toestemming van de klant voor nodig.
  const assets = (await q("select * from hq.project_assets where project_id=$1 order by created_at", [glow.id])).rows;
  for (const a of assets) {
    if (a.path.endsWith("glow-salon.webp") || a.path.endsWith("glow-contact.webp")) continue;
    if (!a.social_ok) await studio.patchAsset(a.id, { social_ok: true }, owner);
  }
  // 2. Statuswijziging naar opgeleverd (twee keer, om te laten zien dat er geen dubbele opdracht komt).
  await studio.patchProject(glow.id, { status: "nazorg" }, owner);
  await studio.patchProject(glow.id, { status: "opgeleverd" }, owner);
  await studio.patchProject(glow.id, { status: "nazorg" }, owner);
  await studio.patchProject(glow.id, { status: "opgeleverd" }, owner);
  const pieces = (await q("select * from hq.content_pieces where project_id=$1 and origin='oplevering'", [glow.id])).rows;
  log(`Contentopdrachten na 2× "opgeleverd": ${pieces.length}`);
  const piece = pieces[0];

  // 3. Planner (serverloze worker).
  await runWorker({ source: "demo", budgetMs: 60_000 });
  const planned = await one("select status, angles from hq.content_pieces where id=$1", [piece.id]);
  log(`Planner: ${planned.status}; hoeken: ${planned.angles.map(a => a.name).join(" | ")}`);
  const idx = planned.angles.findIndex(a => a.key === "pijnpunt");
  await studio.chooseAngle(piece.id, idx, owner);

  // 4. Render-worker (ffmpeg + Chromium).
  await runRenderWorker({ log });
  const detail = await studio.pieceDetail(piece.id);
  const render = detail.renders[0];
  log(`Render v${render.version}: ${render.status}${render.error ? ` (${render.error})` : ""}, ${render.duration_s} s`);
  if (render.status !== "klaar") throw new Error("Render niet gelukt.");

  // 5. Goedkeuren en per kanaal klaarzetten (zonder koppeling: export).
  await studio.approve(piece.id, render.id, owner);
  const igPub = await studio.schedule(piece.id, { channel: "instagram", at: new Date(Date.now() + 2 * 864e5).toISOString() }, owner);
  const ttPub = await studio.schedule(piece.id, { channel: "tiktok", at: new Date(Date.now() + 3 * 864e5).toISOString() }, owner);
  log(`Instagram: ${igPub.method}/${igPub.status} · TikTok: ${ttPub.method}/${ttPub.status}`);
  const wq = await studio.workqueue();
  const mine = wq.pieces.find(p => p.id === piece.id);
  log(`Werkvoorraad: ${mine.column} · acties: ${mine.actions.map(a => a.text).join(" / ")}`);

  const final = await studio.pieceDetail(piece.id);
  if (out) {
    await mkdir(out, { recursive: true });
    const key = (await one("select video_key, cover_key from hq.renders where id=$1", [render.id]));
    await copyFile(path.join(storage.localDir(), key.video_key), path.join(out, "glow-saloneigenaren.mp4"));
    await copyFile(path.join(storage.localDir(), key.cover_key), path.join(out, "glow-saloneigenaren-cover.jpg"));
    const s = final.piece.script;
    await writeFile(path.join(out, "glow-saloneigenaren.json"), JSON.stringify({ hoek: s.name, opening: s.opening, cta: s.cta, scenes: s.scenes, captions: { instagram: (await q("select caption from hq.publications where piece_id=$1 and channel='instagram'", [piece.id])).rows[0]?.caption, tiktok: (await q("select caption from hq.publications where piece_id=$1 and channel='tiktok'", [piece.id])).rows[0]?.caption }, render: { duur_s: render.duration_s, bytes: render.bytes, breedte: render.width, hoogte: render.height }, campagne: final.links }, null, 2));
    log(`Bestanden in ${path.relative(root, out) || out}`);
  }
  return { pieceId: piece.id, renderId: render.id, detail: final };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnvFile(path.join(root, ".env.local"));
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL ontbreekt (gebruik een lokale of test-database)."); process.exit(1); }
  const i = process.argv.indexOf("--out");
  demoGlow({ out: i > 0 ? path.resolve(process.argv[i + 1]) : null }).then(async () => {
    const { closePool } = await import("../api/_lib/db.js"); await closePool();
  }, (e) => { console.error(e); process.exit(1); });
}
