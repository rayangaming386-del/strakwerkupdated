// Bron "Vercel Web Analytics" via de officiële REST-API (api.vercel.com/v1/query/web-analytics).
// Server-side, met een token met leesrechten. Geen dashboard-scraping.
// Beperkingen (Vercel, november 2026): Hobby bewaart 1 maand; eigen events en UTM-uitsplitsing
// vragen een duurder abonnement (Pro / Web Analytics Plus; antwoord 402); tijdsbuckets zijn
// per uur of dag, dus "actief in de laatste 5 minuten" kan deze bron niet leveren.
import { env } from "../env.js";

export const ID = "vercel";
export const LABEL = "Vercel Web Analytics";
const API = "https://api.vercel.com/v1/query/web-analytics";

export function missing() {
  const m = [];
  if (!env.vercelToken) m.push("VERCEL_ANALYTICS_TOKEN");
  if (!env.vercelProjectId) m.push("VERCEL_PROJECT_ID");
  return m;
}

const cache = new Map();
const TTL = 30_000;

class VercelError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function get(path, params) {
  const qs = new URLSearchParams({ projectId: env.vercelProjectId, ...params });
  if (env.vercelTeamId) qs.set("teamId", env.vercelTeamId);
  const url = `${API}${path}?${qs}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const res = await fetch(url, { headers: { authorization: `Bearer ${env.vercelToken}` }, signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  if (!res.ok) {
    const reason = {
      401: "Token ongeldig of verlopen.", 403: "Token heeft geen toegang tot dit project of team.",
      402: "Niet inbegrepen in het huidige Vercel-abonnement.", 404: "Web Analytics niet gevonden voor dit project (staat het aan?).",
      429: "Limiet van de Vercel-API bereikt; later opnieuw.",
    }[res.status] || `Vercel antwoordde ${res.status}.`;
    throw new VercelError(res.status, reason);
  }
  const value = { data: data?.data, fetchedAt: new Date().toISOString() };
  cache.set(url, { at: Date.now(), value });
  if (cache.size > 200) cache.clear();
  return value;
}

const num = (v) => { const n = Number(v ?? 0); return Number.isFinite(n) && n > 0 ? n : 0; };

export async function summary(sinceIso, untilIso, bucket) {
  const range = { since: sinceIso, until: untilIso };
  const out = { fetchedAt: null, notes: [] };
  const tot = await get("/visits/count", range);
  out.fetchedAt = tot.fetchedAt;
  out.visitors = num(tot.data?.visitors); out.pageviews = num(tot.data?.pageviews);
  const opt = async (key, params, map) => {
    try { out[key] = map((await get("/visits/aggregate", { ...range, ...params })).data || []); }
    catch (e) { out[key] = null; out.notes.push(`${key}: ${e.message}`); }
  };
  await Promise.all([
    opt("series", { by: bucket }, rows => rows.filter(r => r.timestamp).map(r => ({ t: r.timestamp, visitors: num(r.visitors), pageviews: num(r.pageviews) }))),
    opt("pages", { by: "requestPath", limit: "10" }, rows => rows.map(r => ({ key: r.requestPath || "/", visitors: num(r.visitors), pageviews: num(r.pageviews) }))),
    opt("referrers", { by: "referrerHostname", limit: "10" }, rows => rows.map(r => ({ key: r.referrerHostname || "(direct)", visitors: num(r.visitors) }))),
    opt("devices", { by: "deviceType", limit: "5" }, rows => rows.map(r => ({ key: r.deviceType || "onbekend", visitors: num(r.visitors) }))),
    opt("campaigns", { by: "utmCampaign", limit: "10" }, rows => rows.map(r => ({ key: r.utmCampaign || "(geen)", visitors: num(r.visitors) }))),
  ]);
  try {
    const ev = await get("/events/aggregate", { ...range, by: "eventName", limit: "50" });
    out.events = (ev.data || []).filter(r => r.eventName && r.eventName !== "Others").map(r => ({ key: r.eventName, count: num(r.count), visitors: num(r.visitors) }));
  } catch (e) { out.events = null; out.notes.push(`events: ${e.message}`); }
  return out;
}

export async function today(sinceIso) {
  const r = await get("/visits/count", { since: sinceIso, until: new Date().toISOString() });
  return { visitors: num(r.data?.visitors), pageviews: num(r.data?.pageviews), fetchedAt: r.fetchedAt };
}
