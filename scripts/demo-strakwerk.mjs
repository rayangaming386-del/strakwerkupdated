#!/usr/bin/env node
// Bewijs van het zelfstandige kantoor: een campagne voor StrakWerk zelf, zonder klantproject.
// Het kantoor plant het eerste publicatiemoment, kiest het onderwerp "Wat kost een website
// laten maken?", schrijft het script (vaste voorbeelddata: AI staat uit), gebruikt de echte
// configurator (eigen schermopname) en prijzen uit de website, rendert de MP4 + cover +
// ondertitels, schrijft captions en plant per kanaal in. Live publicatie staat uit.
//
//   DATABASE_URL=postgres://... npm run demo:strakwerk [-- --out docs/hq/demo]
import path from "node:path";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvFile } from "./dev-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function demoStrakwerk({ out = null, log = console.log } = {}) {
  process.env.HQ_STORAGE ||= "local";
  const { migrate } = await import("./migrate.mjs");
  await migrate(process.env.DATABASE_URL, { log: () => {} });
  const { q, one } = await import("../api/_lib/db.js");
  const studio = await import("../api/_lib/content/studio.js");
  const office = await import("../api/_lib/content/office.js");
  const { runWorker } = await import("../api/_lib/worker.js");
  const { runRenderWorker } = await import("./render-worker.mjs");
  const storage = await import("../api/_lib/content/storage.js");
  const owner = { userId: "00000000-0000-4000-8000-00000000d001", email: "demo@strakwerk.local", role: "eigenaar" };
  await q("insert into hq.members (user_id, email, role, status) values ($1,$2,'eigenaar','actief') on conflict do nothing", [owner.userId, owner.email]);
  await studio.ensurePortfolio();
  const released = (await one("select count(*)::int n from hq.project_assets where project_id is not null and social_ok")).n;
  log(`Klantprojecten met vrijgegeven beelden: ${released} (campagne draait zonder klantproject)`);

  // Eén keer instellen: doelgroep, doelen, kanalen, dagen, weeklimiet (3 per week).
  await office.putPlan({ enabled: true, weekly_limit: 3, weekdays: [1, 3, 5], post_time: "18:30", audiences: ["ondernemers"], goals: ["aanvragen"], live_publishing: false,
    channels: { instagram: { enabled: true, mode: "auto", route: "buffer" }, tiktok: { enabled: true, mode: "review", route: "buffer" } } }, owner);
  const tick = await office.officeTick();
  log(`Kantoor: ${tick.made?.length || 0} video('s) gepland: ${(tick.made || []).map(m => `${m.slot} (${m.kind})`).join(", ")}`);
  const pieceId = tick.made[0].piece;
  await runWorker({ source: "demo", budgetMs: 60_000 });
  const pc = await one("select status, title, angles, script from hq.content_pieces where id=$1", [pieceId]);
  log(`Planner: ${pc.title} · gekozen hoek: ${pc.script?.name} · ${pc.angles.map(a => a.name).join(" | ")}`);
  await runRenderWorker({ log });
  await runWorker({ source: "demo", budgetMs: 60_000 });
  const d = await studio.pieceDetail(pieceId);
  const r = d.renders[0];
  log(`Render v${r.version}: ${r.status} · ${r.duration_s} s · ${(r.bytes / 1e6).toFixed(1)} MB`);
  log(`Werkvoorraad: ${d.piece.column} · ${d.piece.actions.map(a => a.text).join(" / ") || "geen actie nodig"}`);
  for (const p of d.piece.publications) log(`  ${p.channel}: ${p.method} · ${p.status} · gepland ${p.scheduled_at}`);
  if (out) {
    await mkdir(out, { recursive: true });
    const k = await one("select video_key, cover_key, subtitles_key from hq.renders where id=$1", [r.id]);
    await copyFile(path.join(storage.localDir(), k.video_key), path.join(out, "strakwerk-wat-kost-een-website.mp4"));
    await copyFile(path.join(storage.localDir(), k.cover_key), path.join(out, "strakwerk-wat-kost-een-website-cover.jpg"));
    await copyFile(path.join(storage.localDir(), k.subtitles_key), path.join(out, "strakwerk-wat-kost-een-website.srt"));
    const s = d.piece.script;
    await writeFile(path.join(out, "strakwerk-wat-kost-een-website.json"), JSON.stringify({ onderwerp: pc.title, hoek: s.name, opening: s.opening, cta: s.cta, scenes: s.scenes,
      captions: { instagram: s.captions.instagram, tiktok: s.captions.tiktok, actieregel: s.captions.promo_line, actie_tot: s.captions.promo_until },
      publicaties: d.piece.publications.map(p => ({ kanaal: p.channel, route: p.method, status: p.status, gepland: p.scheduled_at })),
      render: { duur_s: r.duration_s, bytes: r.bytes }, campagne: d.links, ai: "uit: vaste voorbeelddata (geen API-aanroep)" }, null, 2));
    log(`Bestanden in ${path.relative(root, out) || out}`);
  }
  return { pieceId, renderId: r.id };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnvFile(path.join(root, ".env.local"));
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL ontbreekt (gebruik een lokale of test-database)."); process.exit(1); }
  const i = process.argv.indexOf("--out");
  demoStrakwerk({ out: i > 0 ? path.resolve(process.argv[i + 1]) : null }).then(async () => {
    const { closePool } = await import("../api/_lib/db.js"); await closePool();
  }, (e) => { console.error(e); process.exit(1); });
}
