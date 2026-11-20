#!/usr/bin/env node
// Render-worker: pakt video-taken uit de HQ-wachtrij en rendert ze met ffmpeg en Chromium.
// Draait op elke machine met Node 20+, ffmpeg en Chromium: je eigen computer of GitHub Actions
// (.github/workflows/hq-render.yml). Schrijft het eindbestand naar duurzame opslag
// (Supabase Storage, of lokaal in .data/media) en zet de status in HQ bij.
//
//   DATABASE_URL=... npm run render-worker            # tot de wachtrij leeg is
//   DATABASE_URL=... npm run render-worker -- --watch # blijft wachten op nieuwe renders
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "./dev-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function processOne({ workerId, log = console.log } = {}) {
  const { claimNext, finish, sweepStale, heartbeat, event } = await import("../api/_lib/queue.js");
  const { q, one, getPool } = await import("../api/_lib/db.js");
  const { renderVideo } = await import("./render/video.mjs");
  const storage = await import("../api/_lib/content/storage.js");
  await sweepStale();
  await q(`insert into hq.settings (key, value, updated_at) values ('render_worker', $1, now()) on conflict (key) do update set value=excluded.value, updated_at=now()`,
    [{ last_seen: new Date().toISOString(), host: process.env.GITHUB_ACTIONS ? "GitHub Actions" : hostname().slice(0, 40), storage: storage.driver() }]);
  const claim = await claimNext(workerId, { only: ["video"] });
  if (!claim.task) return { processed: false, reason: claim.reason };
  const { task, runId } = claim;
  const render = await one("select r.*, c.project_id, c.origin from hq.renders r join hq.content_pieces c on c.id=r.piece_id where r.id=$1", [task.input?.render_id]);
  const started = Date.now();
  const hb = setInterval(() => heartbeat(task.id, workerId, 180).catch(() => {}), 30_000);
  let out = null;
  const tmp = await mkdtemp(path.join(tmpdir(), "hq-render-"));
  try {
    if (!render) throw Object.assign(new Error("Render niet gevonden."), { retryable: false });
    await q("update hq.renders set status='bezig', started_at=coalesce(started_at, now()), error=null where id=$1", [render.id]);
    await heartbeat(task.id, workerId, 180);
    // Alleen beelden van dit project die (nog) zijn vrijgegeven.
    const allowed = new Set((await q("select path from hq.project_assets where project_id=$1 and social_ok", [render.project_id])).rows.map(r => r.path));
    const resolveAsset = async (p) => {
      if (!allowed.has(p)) throw Object.assign(new Error(`Beeld is niet (meer) vrijgegeven: ${p}`), { retryable: false });
      if (!/^\/assets\/[a-z0-9/_.-]+$/i.test(p) || p.includes("..")) return null;
      const f = path.join(root, p);
      try { await access(f); return f; } catch { return null; }
    };
    const res = await renderVideo({
      script: render.script, root, resolveAsset, outDir: tmp,
      onStep: async (m) => { log(`  ${m}`); await event(getPool(), task.id, "stap", { toAgent: "video", message: m }); },
    });
    const base = `renders/${render.piece_id}/${render.id}`;
    await storage.ensureBucket();
    await storage.put(`${base}/video.mp4`, await readFile(res.video), "video/mp4");
    await storage.put(`${base}/cover.jpg`, await readFile(res.cover), "image/jpeg");
    out = { ...res, base };
    clearInterval(hb);
    await finish(task, runId, workerId, {
      status: "afgerond", result: { duur_s: res.duration_s, bytes: res.bytes, opslag: storage.driver() }, message: `Video klaar (${res.duration_s} s, ${(res.bytes / 1e6).toFixed(1)} MB).`,
      after: async (db) => {
        await db.query(`update hq.renders set status='klaar', video_key=$2, cover_key=$3, duration_s=$4, width=$5, height=$6, bytes=$7, render_ms=$8, finished_at=now(), error=null where id=$1`,
          [render.id, `${base}/video.mp4`, `${base}/cover.jpg`, res.duration_s, res.width, res.height, res.bytes, Date.now() - started]);
      },
    });
    if (render.origin === "automatisering") {
      const { onAutoRendered } = await import("../api/_lib/content/studio.js");
      await onAutoRendered(render.piece_id, render.id).catch(e => log(`  automatisch inplannen mislukt: ${e.message}`));
    }
    log(`✓ ${task.title}`);
  } catch (e) {
    clearInterval(hb);
    const msg = String(e.message || e).slice(0, 400);
    const retry = e.retryable === true && task.attempts < task.max_attempts;
    await finish(task, runId, workerId, {
      status: "mislukt", error: msg, retry, message: retry ? `Mislukt: ${msg} Opnieuw ingepland.` : `Mislukt: ${msg}`,
      after: async (db) => { if (render) await db.query("update hq.renders set status=$2, error=$3, finished_at=case when $2='mislukt' then now() else null end where id=$1", [render.id, retry ? "in_wachtrij" : "mislukt", msg]); },
    });
    log(`✗ ${task.title}: ${msg}`);
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return { processed: true, ok: Boolean(out) };
}

export async function runRenderWorker({ watch = false, maxJobs = 20, log = console.log } = {}) {
  const workerId = `render:${(process.env.GITHUB_ACTIONS ? "gha" : hostname()).slice(0, 20)}:${randomUUID().slice(0, 6)}`;
  let n = 0;
  for (;;) {
    const r = await processOne({ workerId, log });
    if (r.processed) { if (++n >= maxJobs) break; continue; }
    if (!watch) break;
    await new Promise(res => setTimeout(res, 10_000));
  }
  return n;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnvFile(path.join(root, ".env.local"));
  if (!process.env.DATABASE_URL) { console.log("DATABASE_URL ontbreekt: niets te doen."); process.exit(0); }
  const watch = process.argv.includes("--watch");
  runRenderWorker({ watch }).then(async (n) => {
    console.log(`${n} render(s) verwerkt.`);
    const { closePool } = await import("../api/_lib/db.js"); await closePool();
  }, (e) => { console.error(e.message); process.exit(1); });
}
