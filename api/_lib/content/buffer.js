// Buffer als gratis publicatieroute (Buffer Free: 3 kanalen, 10 geplande posts per kanaal).
// GraphQL-API op api.buffer.com met een persoonlijke API-sleutel (Bearer). Volgens de
// documentatie van Buffer: één post per kanaal via de mutation createPost met
// schedulingType automatic, mode customScheduled en dueAt (ISO 8601, UTC); video's als
// assets: [{ video: { url } }]. Velden die Buffer kan wijzigen staan hier bij elkaar;
// controleer ze bij de eerste koppeling met "Verbinding testen" in HQ.
// De sleutel staat alleen op de server (BUFFER_API_KEY), nooit in de browser.
const E = (k) => (process.env[k] ?? "").trim();
export const bufferConfigured = () => Boolean(E("BUFFER_API_KEY"));
const base = () => (E("BUFFER_API_BASE") || "https://api.buffer.com").replace(/\/+$/, "");

export class BufferError extends Error {
  constructor(message, { retryable = false, ambiguous = false, queueFull = false, code = null } = {}) { super(message); this.retryable = retryable; this.ambiguous = ambiguous; this.queueFull = queueFull; this.code = code; }
}

async function gql(query, variables = {}, { mutation = false } = {}) {
  let res;
  try {
    res = await fetch(base(), { method: "POST", headers: { authorization: `Bearer ${E("BUFFER_API_KEY")}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(Number(E("BUFFER_HTTP_TIMEOUT_MS")) || 20_000) });
  } catch (e) {
    throw new BufferError(`Buffer reageerde niet (${e.name === "TimeoutError" ? "time-out" : "netwerkfout"}).`, { retryable: true, ambiguous: mutation });
  }
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new BufferError("Buffer weigert de API-sleutel. Maak een nieuwe sleutel in Buffer › Settings › API.");
  if (res.status === 429) throw new BufferError("Limiet van de Buffer-API bereikt; later opnieuw.", { retryable: true });
  if (res.status >= 500) throw new BufferError(`Buffer-fout ${res.status}.`, { retryable: true, ambiguous: mutation });
  if (j.errors?.length) throw new BufferError(`Buffer: ${j.errors.map(e => e.message).join("; ").slice(0, 300)}`, { queueFull: isQueueFull(j.errors.map(e => e.message).join(" ")) });
  return j.data || {};
}

// Buffer meldt een volle wachtrij (gratis plan: 10 geplande posts per kanaal) als fout.
export const isQueueFull = (msg) => /limit|queue (is )?full|maximum|too many scheduled|upgrade/i.test(String(msg || ""));

export async function listChannels() {
  const d = await gql(`query { account { organizations { id name } } }`);
  const orgs = d.account?.organizations || [];
  const out = [];
  for (const o of orgs) {
    const c = await gql(`query($org: OrganizationId!) { channels(input: { organizationId: $org }) { id name service } }`, { org: o.id });
    for (const ch of c.channels || []) out.push({ id: ch.id, name: ch.name, service: ch.service, organization: o.name });
  }
  return out;
}

/** Plaatst een video in de wachtrij van Buffer op een vast tijdstip. Geeft het Buffer-post-ID. */
export async function createVideoPost({ channelId, channel, text, videoUrl, coverUrl, dueAt }) {
  const input = { channelId, text, schedulingType: "automatic", mode: "customScheduled", dueAt: new Date(dueAt).toISOString(),
    assets: [{ video: { url: videoUrl, ...(coverUrl ? { thumbnailUrl: coverUrl } : {}) } }] };
  if (channel === "instagram") input.metadata = { instagram: { type: "reel", shouldShareToFeed: true } };
  const d = await gql(`mutation($input: CreatePostInput!) { createPost(input: $input) {
      ... on PostActionSuccess { post { id status dueAt } }
      ... on MutationError { message } } }`, { input }, { mutation: true });
  const r = d.createPost || {};
  if (r.message) throw new BufferError(`Buffer: ${r.message}`, { queueFull: isQueueFull(r.message) });
  if (!r.post?.id) throw new BufferError("Buffer gaf geen post-ID terug.", { retryable: true, ambiguous: true });
  return { id: r.post.id, status: r.post.status };
}

/** Stand van een post bij Buffer. "sent" = geplaatst op het platform (bevestigd door Buffer). */
export async function getPost(id) {
  const d = await gql(`query($id: PostId!) { post(input: { id: $id }) { id status dueAt sentAt externalLink error { message } } }`, { id });
  const p = d.post;
  if (!p) return null;
  return { id: p.id, status: String(p.status || "").toLowerCase(), sentAt: p.sentAt || null, link: p.externalLink || null, error: p.error?.message || null };
}

/** Na een onduidelijke uitkomst: staat deze post al in Buffer (zelfde kanaal, tekst en tijd)? */
export async function findPost({ channelId, text, dueAt }) {
  const d = await gql(`query($ch: ChannelId!) { posts(input: { channelIds: [$ch], first: 50 }) { edges { node { id text dueAt status } } } }`, { ch: channelId });
  const want = new Date(dueAt).getTime();
  return (d.posts?.edges || []).map(e => e.node).find(n => (n.text || "").trim() === text.trim() && Math.abs(new Date(n.dueAt).getTime() - want) < 120_000) || null;
}
