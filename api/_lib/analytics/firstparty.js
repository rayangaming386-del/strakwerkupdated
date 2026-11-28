// Bron "Eigen meting": leest hq.analytics_events. Alle tijden in Europe/Amsterdam.
import { q, one } from "../db.js";

export const ID = "eigen";
export const LABEL = "Eigen meting (StrakWerk)";
const TZ = "Europe/Amsterdam";

export const PERIODS = {
  vandaag: { sql: `(now() at time zone '${TZ}')::date::timestamp at time zone '${TZ}'`, bucket: "hour", label: "Vandaag" },
  "7d":    { sql: `((now() at time zone '${TZ}')::date - 6)::timestamp at time zone '${TZ}'`, bucket: "day", label: "Laatste 7 dagen" },
  "30d":   { sql: `((now() at time zone '${TZ}')::date - 29)::timestamp at time zone '${TZ}'`, bucket: "day", label: "Laatste 30 dagen" },
};

// Status van de bron: niet gekoppeld / fout / geen gegevens / ok. Nul is alleen "0" als er
// aantoonbaar al eerder gemeten is (anders weten we niet of de meting werkt).
export async function status(envName = "production") {
  const r = await one("select max(at) as last from hq.analytics_events where env = $1", [envName]);
  return { lastEventAt: r?.last || null, hasData: Boolean(r?.last) };
}

export async function active5m(envName = "production") {
  const r = await one(
    "select count(distinct visitor_hash)::int as n, max(at) as last from hq.analytics_events where env = $1 and at > now() - interval '5 minutes'",
    [envName]);
  return r.n;
}

export async function summary(period, envName = "production") {
  const P = PERIODS[period] || PERIODS.vandaag;
  const since = `(${P.sql})`;
  const [tot, series, pages, refs, camps, devices, events] = await Promise.all([
    one(`select count(*) filter (where name='page_view')::int as pageviews,
                count(distinct visitor_hash) filter (where name='page_view')::int as visitors
         from hq.analytics_events where env=$1 and at >= ${since}`, [envName]),
    q(`select date_trunc('${P.bucket}', at at time zone '${TZ}') as t,
              count(*) filter (where name='page_view')::int as pageviews,
              count(distinct visitor_hash) filter (where name='page_view')::int as visitors
       from hq.analytics_events where env=$1 and at >= ${since} group by 1 order by 1`, [envName]),
    q(`select path as key, count(*)::int as pageviews, count(distinct visitor_hash)::int as visitors
       from hq.analytics_events where env=$1 and name='page_view' and at >= ${since} group by 1 order by 2 desc limit 10`, [envName]),
    q(`select coalesce(referrer_host,'(direct of onbekend)') as key, count(distinct visitor_hash)::int as visitors
       from hq.analytics_events where env=$1 and name='page_view' and at >= ${since} group by 1 order by 2 desc limit 10`, [envName]),
    q(`select concat_ws(' / ', utm_source, utm_medium, utm_campaign) as key, count(distinct visitor_hash)::int as visitors
       from hq.analytics_events where env=$1 and name='page_view' and at >= ${since} and (utm_source is not null or utm_campaign is not null)
       group by 1 order by 2 desc limit 10`, [envName]),
    q(`select device as key, count(distinct visitor_hash)::int as visitors
       from hq.analytics_events where env=$1 and name='page_view' and at >= ${since} group by 1 order by 2 desc`, [envName]),
    q(`select name as key, count(*)::int as count, count(distinct visitor_hash)::int as visitors
       from hq.analytics_events where env=$1 and name <> 'page_view' and at >= ${since} group by 1 order by 2 desc`, [envName]),
  ]);
  // Na 31 dagen zijn de hashes gewist; unieke bezoekers per dag komen dan uit hq.analytics_daily.
  return {
    period, periodLabel: P.label, bucket: P.bucket,
    pageviews: tot.pageviews, visitors: tot.visitors,
    series: series.rows.map(r => ({ t: r.t, pageviews: r.pageviews, visitors: r.visitors })),
    pages: pages.rows, referrers: refs.rows, campaigns: camps.rows, devices: devices.rows, events: events.rows,
  };
}

export async function clicksToday(envName = "production") {
  const r = await q(
    `select name, count(*)::int as n from hq.analytics_events
     where env=$1 and at >= ${PERIODS.vandaag.sql} and name in ('quote_whatsapp_click','contact_whatsapp_click','email_click','phone_click','calculator_start')
     group by 1`, [envName]);
  return Object.fromEntries(r.rows.map(x => [x.name, x.n]));
}
