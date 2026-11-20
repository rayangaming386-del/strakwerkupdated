// Vervangbare integratielaag voor bezoekersdata. Elke bron levert waarden met een expliciete
// toestand, zodat "0 bezoekers", "verbinding kapot" en "nog nooit gemeten" niet op elkaar lijken.
import * as fp from "./firstparty.js";
import * as vc from "./vercel.js";
import { env } from "../env.js";

export const STATES = {
  ok: "Gemeten",
  geen_gegevens: "Geen gegevens beschikbaar",
  niet_gekoppeld: "Niet gekoppeld",
  fout: "Verbinding mislukt",
};

export function startOfDayAmsterdam(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  // Zoek de UTC-tijd waarop het in Amsterdam 00:00 is (houdt rekening met zomer/wintertijd).
  for (const off of [1, 2]) {
    const guess = new Date(`${parts}T00:00:00+0${off}:00`);
    const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", hourCycle: "h23" }).format(guess);
    if (h === "00") return guess;
  }
  return new Date(`${parts}T00:00:00Z`);
}

function daysAgoStart(n) {
  const d = startOfDayAmsterdam();
  return startOfDayAmsterdam(new Date(d.getTime() - n * 86400_000 + 12 * 3600_000));
}

async function eigenStatus(envName) {
  if (!env.databaseUrl) return { id: fp.ID, label: fp.LABEL, state: "niet_gekoppeld", missing: ["DATABASE_URL"] };
  try {
    const s = await fp.status(envName);
    return { id: fp.ID, label: fp.LABEL, state: s.hasData ? "ok" : "geen_gegevens", lastEventAt: s.lastEventAt, checkedAt: new Date().toISOString(), delaySeconds: 0,
      note: s.hasData ? "Events worden direct bij ontvangst opgeslagen." : "Nog geen enkele meting ontvangen. Staat /assets/sw-metrics.js live en is de database bereikbaar?" };
  } catch (e) {
    return { id: fp.ID, label: fp.LABEL, state: "fout", error: "Database niet bereikbaar.", checkedAt: new Date().toISOString() };
  }
}

function vercelBase() {
  const missing = vc.missing();
  if (missing.length) return { id: vc.ID, label: vc.LABEL, state: "niet_gekoppeld", missing };
  return null;
}

const wrap = (value, src, extra = {}) => ({ value, state: src.state === "ok" ? "ok" : src.state, source: src.id, measuredAt: src.lastEventAt || src.fetchedAt || null, ...extra });

export async function overview(envName = "production") {
  const eigen = await eigenStatus(envName);
  const out = { sources: [eigen], metrics: {} };
  // Actief (laatste 5 min) en klikken komen alleen uit de eigen meting.
  if (eigen.state === "ok") {
    try {
      const [act, clicks, today] = await Promise.all([fp.active5m(envName), fp.clicksToday(envName), fp.summary("vandaag", envName)]);
      out.metrics.active5m = wrap(act, eigen);
      out.metrics.visitorsToday = wrap(today.visitors, eigen);
      out.metrics.pageviewsToday = wrap(today.pageviews, eigen);
      out.metrics.clicks = {
        whatsapp: wrap((clicks.quote_whatsapp_click || 0) + (clicks.contact_whatsapp_click || 0), eigen),
        quoteWhatsapp: wrap(clicks.quote_whatsapp_click || 0, eigen),
        email: wrap(clicks.email_click || 0, eigen),
        phone: wrap(clicks.phone_click || 0, eigen),
        calculator: wrap(clicks.calculator_start || 0, eigen),
      };
    } catch {
      eigen.state = "fout"; eigen.error = "Ophalen mislukt.";
    }
  }
  for (const k of ["active5m", "visitorsToday", "pageviewsToday"]) out.metrics[k] ||= wrap(null, eigen);
  out.metrics.clicks ||= Object.fromEntries(["whatsapp", "quoteWhatsapp", "email", "phone", "calculator"].map(k => [k, wrap(null, eigen)]));

  const v = vercelBase();
  if (v) out.sources.push(v);
  else {
    const src = { id: vc.ID, label: vc.LABEL, checkedAt: new Date().toISOString() };
    try {
      const t = await vc.today(startOfDayAmsterdam().toISOString());
      Object.assign(src, { state: "ok", fetchedAt: t.fetchedAt, note: "Vercel verwerkt met enige vertraging; tijdsbuckets per uur. Geen 'actief nu' via deze bron." });
      out.metrics.vercelVisitorsToday = wrap(t.visitors, src);
      out.metrics.vercelPageviewsToday = wrap(t.pageviews, src);
    } catch (e) {
      Object.assign(src, { state: "fout", error: e.message });
    }
    out.sources.push(src);
  }
  return out;
}

export async function visitors(period = "vandaag", envName = "production") {
  const eigen = await eigenStatus(envName);
  const res = { period, env: envName, sources: [eigen], eigen: null, vercel: null };
  if (eigen.state === "ok") {
    try { res.eigen = await fp.summary(period, envName); }
    catch { eigen.state = "fout"; eigen.error = "Ophalen mislukt."; }
  }
  const v = vercelBase();
  if (v) res.sources.push(v);
  else if (envName === "production") {
    const src = { id: vc.ID, label: vc.LABEL, checkedAt: new Date().toISOString() };
    const since = period === "7d" ? daysAgoStart(6) : period === "30d" ? daysAgoStart(29) : startOfDayAmsterdam();
    try {
      res.vercel = await vc.summary(since.toISOString(), new Date().toISOString(), period === "vandaag" ? "hour" : "day");
      Object.assign(src, { state: "ok", fetchedAt: res.vercel.fetchedAt, notes: res.vercel.notes });
    } catch (e) { Object.assign(src, { state: "fout", error: e.message }); }
    res.sources.push(src);
  }
  return res;
}
