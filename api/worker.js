// /api/worker — geplande taken. Alleen met "Authorization: Bearer <CRON_SECRET>".
// Cloudflare: de Worker roept dit elke minuut aan via zijn cron-trigger (worker/index.js),
// per onderdeel in een eigen aanroep (eigen rekentijd en looptijd):
//   ?part=taken     takenwachtrij (één taak per aanroep op Workers)
//   ?part=klant     klanten winnen: berichten, fouten, overleg, herinneringen, Scout, voorstellen
//   ?part=content   contentstudio: token, resultaten, automatisering, kantoor, AI hervatten
//   ?part=bewaren   bewaartermijnen
// Zonder ?part (lokaal of handmatig): alles na elkaar.
import { env } from "./_lib/env.js";
import { json, errorResponse } from "./_lib/http.js";
import { runWorker } from "./_lib/worker.js";
import { runRetention } from "./_lib/retention.js";
import { contentCron } from "./_lib/content/cron.js";
import { klantCron } from "./_lib/klant/cron.js";
import { isWorkers } from "./_lib/runtime.js";
import { q } from "./_lib/db.js";
import { timingSafeEqual } from "node:crypto";

function authorized(request) {
  const secret = env.cronSecret;
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(request.headers.get("authorization") || "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export const PARTS = ["taken", "klant", "content", "bewaren"];

/** Laatste geslaagde run per onderdeel; zichtbaar in HQ (Instellingen) en in de overdracht. */
async function stamp(part, result) {
  await q(`insert into hq.settings (key, value, updated_at) values ($1, $2, now())
    on conflict (key) do update set value=excluded.value, updated_at=now()`, [`cron:${part}`, { at: new Date().toISOString(), result }]).catch(() => {});
}

export async function runPart(part, { t0 = Date.now() } = {}) {
  let out;
  if (part === "bewaren") out = await runRetention();
  else if (part === "content") out = await contentCron();
  else if (part === "klant") out = await klantCron();
  else if (part === "taken") out = await runWorker({ source: "cron", budgetMs: isWorkers ? 25_000 : Math.max(10_000, 57_000 - (Date.now() - t0)), maxTasks: isWorkers ? 1 : Infinity });
  else throw Object.assign(new Error("Onbekend onderdeel."), { status: 400, code: "ongeldig" });
  await stamp(part, out);
  return out;
}

export async function handle(request) {
  try {
    if (!authorized(request)) return json({ error: "geen_toegang" }, 401);
    const t0 = Date.now();
    const part = new URL(request.url).searchParams.get("part");
    if (part) return json({ ok: true, part, result: await runPart(part, { t0 }) });
    const all = {};
    for (const p of ["bewaren", "content", "klant", "taken"]) all[p] = await runPart(p, { t0 }).catch(e => ({ fout: e.message }));
    return json({ ok: true, ...all });
  } catch (e) {
    return errorResponse(e);
  }
}
export const GET = handle, POST = handle;
