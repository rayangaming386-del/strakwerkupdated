// Instagram-publicatie via de officiële "Instagram API with Instagram Login" voor
// professionele accounts (zakelijk of creator). Flow volgens Meta:
//   1. container maken: POST /{ig-user-id}/media  (media_type=REELS, video_url, caption, cover_url)
//   2. wachten tot de container verwerkt is: GET /{container-id}?fields=status_code
//      (IN_PROGRESS → FINISHED; ERROR/EXPIRED = mislukt; PUBLISHED = al geplaatst)
//   3. publiceren: POST /{ig-user-id}/media_publish (creation_id=container-id) → media-id
//   4. permalink ophalen: GET /{media-id}?fields=permalink,timestamp
// Host en versie zijn instelbaar (IG_GRAPH_BASE, IG_API_VERSION) omdat Meta die regelmatig
// verhoogt; controleer ze bij de eerste koppeling tegen de actuele documentatie.
// Tokens staan alleen op de server, versleuteld in hq.integrations (HQ_ENCRYPTION_KEY).
import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual, createHmac } from "node:crypto";
import { q, one } from "../db.js";
import { env } from "../env.js";

const E = (k) => (process.env[k] ?? "").trim();
export const igConfig = () => ({
  appId: E("IG_APP_ID"), appSecret: E("IG_APP_SECRET"),
  graph: (E("IG_GRAPH_BASE") || "https://graph.instagram.com").replace(/\/+$/, ""),
  version: E("IG_API_VERSION") || "v24.0",
  oauth: (E("IG_OAUTH_BASE") || "https://www.instagram.com").replace(/\/+$/, ""),
  tokenBase: (E("IG_TOKEN_BASE") || "https://api.instagram.com").replace(/\/+$/, ""),
  encKey: E("HQ_ENCRYPTION_KEY"),
});
export const SCOPES = "instagram_business_basic,instagram_business_content_publish";

export function missingIg() {
  const c = igConfig(), m = [];
  if (!c.appId) m.push("IG_APP_ID");
  if (!c.appSecret) m.push("IG_APP_SECRET");
  if (!c.encKey) m.push("HQ_ENCRYPTION_KEY");
  return m;
}

// ── Versleuteling (AES-256-GCM) ──────────────────────────────────────────────
const key = () => createHash("sha256").update(igConfig().encKey).digest();
export function encrypt(text) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString("base64url")).join(".");
}
export function decrypt(blob) {
  const [iv, tag, enc] = blob.split(".").map(s => Buffer.from(s, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export async function instagramState() {
  const missing = missingIg();
  let row = null;
  try { row = await one("select account_id, account_name, expires_at, connected_at from hq.integrations where key='instagram' and token_enc is not null"); } catch { row = null; }
  const expired = row?.expires_at && new Date(row.expires_at) < new Date();
  return {
    connected: Boolean(row && !missing.length && !expired),
    account: row ? { id: row.account_id, name: row.account_name, expires_at: row.expires_at, connected_at: row.connected_at } : null,
    expired: Boolean(expired), missing,
    note: missing.length ? "Instagram-koppeling niet ingesteld: video's worden als export klaargezet." : !row ? "Koppel je professionele Instagram-account in Instellingen." : expired ? "Toegang verlopen: koppel opnieuw." : "Gekoppeld via de officiële Instagram API.",
  };
}

async function token() {
  const r = await one("select account_id, token_enc, expires_at from hq.integrations where key='instagram' and token_enc is not null");
  if (!r) throw Object.assign(new Error("Instagram is niet gekoppeld."), { retryable: false, code: "niet_gekoppeld" });
  return { accountId: r.account_id, token: decrypt(r.token_enc) };
}

export class IgError extends Error {
  constructor(message, { status = 0, code = null, retryable = false, ambiguous = false } = {}) { super(message); this.status = status; this.igCode = code; this.retryable = retryable; this.ambiguous = ambiguous; }
}

async function call(method, path, params = {}, { timeoutMs = 20_000, base } = {}) {
  const c = igConfig();
  timeoutMs = Number(process.env.IG_HTTP_TIMEOUT_MS) || timeoutMs;
  const url = new URL(`${base || c.graph}/${c.version}/${path.replace(/^\//, "")}`);
  let body;
  if (method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  else body = new URLSearchParams(params);
  let res;
  try {
    res = await fetch(url, { method, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    // Time-out of netwerkfout: bij een POST weten we niet of Instagram het verzoek heeft verwerkt.
    throw new IgError(`Instagram reageerde niet (${e.name === "TimeoutError" ? "time-out" : "netwerkfout"}).`, { retryable: true, ambiguous: method !== "GET" });
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) {
    const err = j.error || {};
    const msg = err.error_user_msg || err.message || `HTTP ${res.status}`;
    const retryable = res.status >= 500 || res.status === 429 || [1, 2, 4, 17, 32, 613, 9004, 2207051].includes(err.code);
    if (err.code === 190) throw new IgError("Toegang tot Instagram is verlopen of ingetrokken. Koppel opnieuw in Instellingen.", { status: res.status, code: 190 });
    throw new IgError(`Instagram: ${msg}`, { status: res.status, code: err.code, retryable, ambiguous: res.status >= 500 && method !== "GET" });
  }
  return j;
}

export async function containerStatus(containerId) {
  const { token: t } = await token();
  const r = await call("GET", containerId, { fields: "status_code,status", access_token: t });
  return { code: r.status_code, detail: r.status || null };
}

export async function createContainer({ videoUrl, coverUrl, caption }) {
  const { accountId, token: t } = await token();
  const params = { media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true", access_token: t };
  if (coverUrl) params.cover_url = coverUrl;
  const r = await call("POST", `${accountId}/media`, params, { timeoutMs: 30_000 });
  return r.id;
}

export async function publishContainer(containerId) {
  const { accountId, token: t } = await token();
  const r = await call("POST", `${accountId}/media_publish`, { creation_id: containerId, access_token: t }, { timeoutMs: 30_000 });
  return r.id;
}

export async function mediaInfo(mediaId) {
  const { token: t } = await token();
  return call("GET", mediaId, { fields: "id,permalink,timestamp,caption,media_product_type", access_token: t });
}

/** Recente posts doorzoeken op exact dezelfde caption (na een onduidelijke uitkomst). */
export async function findRecentByCaption(caption, sinceMs) {
  const { accountId, token: t } = await token();
  const r = await call("GET", `${accountId}/media`, { fields: "id,caption,timestamp,permalink", limit: "25", access_token: t });
  const want = caption.trim();
  return (r.data || []).find(m => (m.caption || "").trim() === want && (!sinceMs || Date.parse(m.timestamp) >= sinceMs - 10 * 60_000)) || null;
}

export async function publishingLimit() {
  const { accountId, token: t } = await token();
  const r = await call("GET", `${accountId}/content_publishing_limit`, { fields: "quota_usage,config", access_token: t });
  const d = r.data?.[0];
  return d ? { used: d.quota_usage, total: d.config?.quota_total ?? null } : null;
}

export async function insightsFor(mediaId) {
  const { token: t } = await token();
  // Namen van metrics veranderen bij Meta; wat niet terugkomt blijft "onbekend".
  try {
    const r = await call("GET", `${mediaId}/insights`, { metric: "views,reach,likes,comments,shares,saved", access_token: t });
    const map = { views: "views", reach: "reach", likes: "likes", comments: "comments", shares: "shares", saved: "saves" };
    return Object.fromEntries((r.data || []).filter(m => map[m.name]).map(m => [map[m.name], Number(m.values?.[0]?.value ?? m.total_value?.value ?? 0)]));
  } catch { return {}; }
}

// ── OAuth (koppelen vanuit HQ) ──────────────────────────────────────────────
const stateSecret = () => createHash("sha256").update(`ig-state|${igConfig().encKey}|${igConfig().appSecret}`).digest();
export function oauthState(userId) {
  const payload = Buffer.from(JSON.stringify({ u: userId, t: Date.now(), n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${payload}.${createHmac("sha256", stateSecret()).update(payload).digest("base64url")}`;
}
export function checkState(state, userId) {
  const [payload, sig] = String(state || "").split(".");
  if (!payload || !sig) return false;
  const want = createHmac("sha256", stateSecret()).update(payload).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  try { const j = JSON.parse(Buffer.from(payload, "base64url").toString()); return j.u === userId && Date.now() - j.t < 15 * 60_000; } catch { return false; }
}
export const redirectUri = () => `${env.siteUrl}/api/hq/integrations/instagram/callback`;
export function authorizeUrl(userId) {
  const c = igConfig();
  const u = new URL(`${c.oauth}/oauth/authorize`);
  u.searchParams.set("client_id", c.appId); u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("response_type", "code"); u.searchParams.set("scope", SCOPES); u.searchParams.set("state", oauthState(userId));
  return u.toString();
}

export async function exchangeCode(code, userId) {
  const c = igConfig();
  const r1 = await fetch(`${c.tokenBase}/oauth/access_token`, { method: "POST", body: new URLSearchParams({ client_id: c.appId, client_secret: c.appSecret, grant_type: "authorization_code", redirect_uri: redirectUri(), code }), signal: AbortSignal.timeout(20_000) });
  const j1 = await r1.json().catch(() => ({}));
  if (!r1.ok || !j1.access_token) throw new IgError(`Koppelen mislukt: ${j1.error_message || j1.error?.message || r1.status}`);
  const long = await call("GET", "access_token", { grant_type: "ig_exchange_token", client_secret: c.appSecret, access_token: j1.access_token }, { base: c.graph });
  const me = await call("GET", "me", { fields: "user_id,username", access_token: long.access_token });
  await q(`insert into hq.integrations (key, account_id, account_name, token_enc, expires_at, scopes, connected_by, connected_at, updated_at)
    values ('instagram',$1,$2,$3,now() + make_interval(secs => $4),$5,$6,now(),now())
    on conflict (key) do update set account_id=excluded.account_id, account_name=excluded.account_name, token_enc=excluded.token_enc, expires_at=excluded.expires_at, scopes=excluded.scopes, connected_by=excluded.connected_by, connected_at=now(), updated_at=now()`,
    [String(me.user_id || me.id || j1.user_id), me.username || null, encrypt(long.access_token), Number(long.expires_in) || 5184000, SCOPES, userId]);
  return { account: me.username };
}

/** Langlevend token verversen (dagelijks via cron, als het binnen 15 dagen verloopt). */
export async function refreshIfNeeded() {
  if (missingIg().length) return { skipped: "niet_ingesteld" };
  const r = await one("select token_enc, expires_at from hq.integrations where key='instagram' and token_enc is not null");
  if (!r) return { skipped: "niet_gekoppeld" };
  if (r.expires_at && new Date(r.expires_at) - Date.now() > 15 * 864e5) return { skipped: "nog_geldig" };
  const j = await call("GET", "refresh_access_token", { grant_type: "ig_refresh_token", access_token: decrypt(r.token_enc) });
  await q("update hq.integrations set token_enc=$1, expires_at=now() + make_interval(secs => $2), updated_at=now() where key='instagram'", [encrypt(j.access_token), Number(j.expires_in) || 5184000]);
  return { refreshed: true };
}

export async function disconnect() {
  await q("update hq.integrations set token_enc=null, expires_at=null, updated_at=now() where key='instagram'");
}
