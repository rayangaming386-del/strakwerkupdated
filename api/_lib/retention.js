// Bewaartermijnen (ook vastgelegd in de privacyverklaring en docs/hq/privacy.md):
// - dagzout: na 2 dagen verwijderd (daarna is een bezoekershash niet meer te herleiden);
// - bezoekershash per event: na 31 dagen leeggemaakt (dagtotalen blijven in analytics_daily);
// - analytics-events: na 13 maanden verwijderd;
// - taakstappen (task_events): na 12 maanden verwijderd; taken en goedkeuringen blijven
//   bewaard zolang de lead bestaat (verwijderen van een lead verwijdert alles eraan);
// - websitecheck: bezoekershash na 2 dagen gewist; checks zonder achtergelaten gegevens na
//   90 dagen verwijderd (met gegevens: horen bij de klantkaart);
// - voorbeeldsites: 60 dagen na het verlopen verwijderd (de link gaf al "verlopen").
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
  out.checkHashes = (await q("update hq.site_checks set ip_hash=null where ip_hash is not null and created_at < now() - interval '2 days'")).rowCount;
  out.checks = (await q("delete from hq.site_checks where lead_id is null and created_at < now() - interval '90 days'")).rowCount;
  out.previews = (await q("delete from hq.previews where expires_at < now() - interval '60 days'")).rowCount;
  return out;
}
