// /api/worker — vangnet en onderhoud. Wordt aangeroepen door Vercel Cron (dagelijks, zie
// vercel.json) of een andere planner met "Authorization: Bearer <CRON_SECRET>".
// Terugkerende agentruns zijn er NIET: die staan standaard uit en bestaan in deze versie niet.
import { env } from "./_lib/env.js";
import { json, errorResponse } from "./_lib/http.js";
import { runWorker } from "./_lib/worker.js";
import { runRetention } from "./_lib/retention.js";
import { contentCron } from "./_lib/content/cron.js";
import { klantCron } from "./_lib/klant/cron.js";
import { timingSafeEqual } from "node:crypto";

function authorized(request) {
  const secret = env.cronSecret;
  if (!secret) return false;
  const got = Buffer.from(request.headers.get("authorization") || "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function handle(request) {
  try {
    if (!authorized(request)) return json({ error: "geen_toegang" }, 401);
    const t0 = Date.now();
    const retention = await runRetention();
    const content = await contentCron().catch(e => ({ fout: e.message }));
    const klant = await klantCron().catch(e => ({ fout: e.message }));
    // Resterende tijd van deze functie (max. 60 s) voor taken; een taak start alleen als hij past.
    const worker = await runWorker({ source: "cron", budgetMs: Math.max(10_000, 57_000 - (Date.now() - t0)) });
    return json({ ok: true, retention, content, klant, worker });
  } catch (e) {
    return errorResponse(e);
  }
}
export const GET = handle, POST = handle;
