// Bewaartermijnen (ook vastgelegd in de privacyverklaring en docs/hq/privacy.md):
// - dagzout: na 2 dagen verwijderd (daarna is een bezoekershash niet meer te herleiden);
// - bezoekershash per event: na 31 dagen leeggemaakt (dagtotalen blijven in analytics_daily);
// - analytics-events: na 13 maanden verwijderd;
// - taakstappen (task_events): na 12 maanden verwijderd; taken en goedkeuringen blijven
//   bewaard zolang de lead bestaat (verwijderen van een lead verwijdert alles eraan).
import { q } from "./db.js";

export async function runRetention() {
  const out = {};
  out.rollup = (await q(`insert into hq.analytics_daily (day, env, visitors, pageviews)
    select (at at time zone 'Europe/Amsterdam')::date, env, count(distinct visitor_hash) filter (where name='page_view'), count(*) filter (where name='page_view')
    from hq.analytics_events where at < date_trunc('day', now() at time zone 'Europe/Amsterdam') at time zone 'Europe/Amsterdam' and at > now() - interval '35 days' and visitor_hash is not null
    group by 1, 2
    on conflict (day, env) do update set visitors=excluded.visitors, pageviews=excluded.pageviews, computed_at=now()`)).rowCount;
  out.salts = (await q("delete from hq.analytics_salts where day < (now() at time zone 'Europe/Amsterdam')::date - 1")).rowCount;
  out.hashes = (await q("update hq.analytics_events set visitor_hash=null where visitor_hash is not null and at < now() - interval '31 days'")).rowCount;
  out.events = (await q("delete from hq.analytics_events where at < now() - interval '13 months'")).rowCount;
  out.taskEvents = (await q("delete from hq.task_events where at < now() - interval '12 months'")).rowCount;
  return out;
}
