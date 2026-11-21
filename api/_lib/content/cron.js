// Terugkerend onderhoud voor content (via /api/worker): Instagram-token verversen,
// resultaten van geplaatste posts ophalen en de automatisering laten draaien.
import { q } from "../db.js";
import * as ig from "./instagram.js";
import { automationTick } from "./studio.js";
import { officeTick } from "./office.js";
import { resumeBudgetTasks } from "../budget.js";
import { dispatchRenderWorker } from "./dispatch.js";

export async function contentCron() {
  const out = {};
  try { out.instagramToken = await ig.refreshIfNeeded(); } catch (e) { out.instagramToken = { fout: e.message }; }
  const st = await ig.instagramState();
  // Resultaten hooguit één keer per 20 uur ophalen (cron draait vaak; de API-limiet blijft ruim).
  const lastMetrics = (await q("select updated_at from hq.settings where key='content_metrics_at'")).rows[0]?.updated_at;
  if (st.connected && (!lastMetrics || Date.now() - new Date(lastMetrics) > 20 * 3600e3)) {
    await q("insert into hq.settings (key, value, updated_at) values ('content_metrics_at', '{}'::jsonb, now()) on conflict (key) do update set updated_at=now()");
    const pubs = (await q("select id, external_id from hq.publications where channel='instagram' and status='gepubliceerd' and external_id is not null and published_at > now() - interval '30 days'")).rows;
    let n = 0;
    for (const p of pubs) {
      const m = await ig.insightsFor(p.external_id);
      for (const [metric, value] of Object.entries(m)) {
        if (!Number.isFinite(value)) continue;
        await q(`insert into hq.content_metrics (publication_id, metric, value, source) values ($1,$2,$3,'instagram_api')
          on conflict (publication_id, metric, source) do update set value=excluded.value, measured_at=now()`, [p.id, metric, value]);
        n++;
      }
    }
    out.metrics = n;
  }
  try { out.automation = await automationTick(); } catch (e) { out.automation = { fout: e.message }; }
  try { out.kantoor = await officeTick(); } catch (e) { out.kantoor = { fout: e.message }; }
  // Nieuwe tegoedperiode of verhoogde limiet: wachtende AI-taken (dezelfde, geen kopieën) weer oppakken.
  try { out.ai_hervat = await resumeBudgetTasks(); } catch (e) { out.ai_hervat = { fout: e.message }; }
  // Renders klaar om te maken: de gratis render-worker (GitHub Actions) starten, als die is gekoppeld.
  const pending = (await q("select count(*)::int n from hq.tasks where agent_key='video' and status='in_wachtrij'")).rows[0].n;
  // Hooguit één start per 20 minuten (elke run kost gratis maar beperkte Actions-minuten).
  const lastDispatch = (await q("select updated_at from hq.settings where key='render_dispatch_at'")).rows[0]?.updated_at;
  if (pending && (!lastDispatch || Date.now() - new Date(lastDispatch) > 20 * 60_000)) {
    out.render_dispatch = await dispatchRenderWorker();
    if (out.render_dispatch) await q("insert into hq.settings (key, value, updated_at) values ('render_dispatch_at', '{}'::jsonb, now()) on conflict (key) do update set updated_at=now()");
  }
  return out;
}
