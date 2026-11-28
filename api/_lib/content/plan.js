// Kantoorplan en publicatieroute per kanaal (los van studio.js om kringverwijzingen te voorkomen).
import { q } from "../db.js";
import { instagramState } from "./instagram.js";
import { bufferConfigured } from "./buffer.js";

export const ROUTES = { export: "Export (zelf plaatsen)", buffer: "Buffer (gratis plan)", instagram_api: "Instagram API (officieel)" };
export const MODES = { review: "Eerst beoordelen", auto: "Automatisch publiceren" };
const DEFAULT = { enabled: false, weekly_limit: 3, weekdays: [1, 3, 5], post_time: "18:30", audiences: ["ondernemers"], goals: ["aanvragen"], portfolio_every: 3, lead_days: 2, live_publishing: false,
  channels: { instagram: { enabled: true, mode: "review", route: "export" }, tiktok: { enabled: true, mode: "review", route: "export" } } };

export async function getPlan(db) {
  const r = (await (db || { query: q }).query("select value from hq.settings where key='marketing'")).rows[0]?.value || {};
  return { ...DEFAULT, ...r, channels: { instagram: { ...DEFAULT.channels.instagram, ...(r.channels?.instagram || {}) }, tiktok: { ...DEFAULT.channels.tiktok, ...(r.channels?.tiktok || {}) } } };
}

/** Hoe een kanaal nu echt publiceert (route kan ontbreken → export, met reden). */
export async function routeFor(channel, plan) {
  const p = plan || await getPlan();
  const want = p.channels[channel]?.route || "export";
  if (want === "instagram_api") {
    const ig = await instagramState();
    return ig.connected ? { method: "api", route: want } : { method: "export", route: "export", reason: `Instagram API niet gekoppeld${ig.missing.length ? ` (ontbreekt: ${ig.missing.join(", ")})` : ""}` };
  }
  if (want === "buffer") {
    const b = { buffer_channels: { instagram: "", tiktok: "", ...((await q("select value from hq.settings where key='brand'")).rows[0]?.value?.buffer_channels || {}) } };
    if (!bufferConfigured()) return { method: "export", route: "export", reason: "Buffer niet gekoppeld (BUFFER_API_KEY ontbreekt)" };
    if (!b.buffer_channels[channel]) return { method: "export", route: "export", reason: `Kies het Buffer-kanaal voor ${channel} in HQ` };
    return { method: "buffer", route: want, channelId: b.buffer_channels[channel] };
  }
  return { method: "export", route: "export" };
}

