// Terugkerend onderhoud voor content (via /api/worker): Instagram-token verversen,
// resultaten van geplaatste posts ophalen en de automatisering laten draaien.
import { q } from "../db.js";
import * as ig from "./instagram.js";
import { automationTick } from "./studio.js";

export async function contentCron() {
  const out = {};
  try { out.instagramToken = await ig.refreshIfNeeded(); } catch (e) { out.instagramToken = { fout: e.message }; }
  const st = await ig.instagramState();
  if (st.connected) {
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
  return out;
}
