// PUBLISHER: plaatst een goedgekeurde video op het afgesproken moment via de officiële
// Instagram-koppeling. Regels tegen dubbele posts:
//  - één actieve publicatie per stuk per kanaal (unieke index) en één taak per poging;
//  - de container-id wordt opgeslagen vóórdat er gewacht of gepubliceerd wordt;
//  - vlak vóór media_publish gaat de status naar "onzeker": crasht of time-out het verzoek,
//    dan controleert de volgende run eerst de container (PUBLISHED?) en de recente posts
//    (zelfde caption) voordat er iets opnieuw wordt geprobeerd;
//  - een gepubliceerde container wordt nooit opnieuw gepubliceerd.
import { one, q } from "../db.js";
import { signedUrl } from "../content/storage.js";
import { captionFor, sha, scriptHash } from "../content/studio.js";
import * as ig from "../content/instagram.js";
import * as buffer from "../content/buffer.js";
import { getPlan, routeFor } from "../content/plan.js";

export const KIND = "publish";
const set = (id, fields) => {
  const keys = Object.keys(fields);
  return q(`update hq.publications set ${keys.map((k, i) => `${k}=$${i + 2}`).join(", ")}, updated_at=now() where id=$1`, [id, ...keys.map(k => fields[k])]);
};

async function mediaUrl(key, hours) {
  if (process.env.HQ_TEST_MODE === "1" && process.env.HQ_TEST_MEDIA_BASE) return `${process.env.HQ_TEST_MEDIA_BASE}/${key}`;
  const u = await signedUrl(key, { expiresIn: hours * 3600 });
  if (!u) throw Object.assign(new Error("De video staat in lokale opslag; Instagram kan hem niet ophalen. Koppel Supabase Storage (SUPABASE_SECRET_KEY)."), { retryable: false });
  return u;
}

async function markPublished(pub, mediaId, ctx) {
  let info = {};
  if (mediaId) { try { info = await ig.mediaInfo(mediaId); } catch { info = {}; } }
  await set(pub.id, { status: "gepubliceerd", external_id: mediaId || null, permalink: info.permalink || null, published_at: info.timestamp ? new Date(info.timestamp) : new Date(), last_error: mediaId ? null : "Gepubliceerd volgens Instagram (container PUBLISHED), maar het post-ID kon niet worden opgehaald.", last_checked_at: new Date() });
  await ctx.step(`Bevestigd gepubliceerd${mediaId ? ` (ID ${mediaId})` : ""}`);
  return { status: "afgerond", result: { external_id: mediaId, permalink: info.permalink || null }, message: "Gepubliceerd en bevestigd door Instagram." };
}

export async function run({ task, ctx }) {
  const pub = await one("select p.*, r.video_key, r.cover_key, c.script, c.status as piece_status, c.approved_render_id, c.project_id from hq.publications p join hq.renders r on r.id=p.render_id join hq.content_pieces c on c.id=p.piece_id where p.id=$1", [task.input?.publication_id]);
  if (!pub) throw Object.assign(new Error("Publicatie niet gevonden."), { retryable: false });
  if (["gepubliceerd", "handmatig_geplaatst", "geannuleerd"].includes(pub.status)) return { status: "afgerond", result: { overgeslagen: pub.status }, message: `Niets te doen (${pub.status}).` };
  if (pub.method === "export") throw Object.assign(new Error("Voor dit kanaal is geen automatische koppeling: plaats de export zelf."), { retryable: false });
  // Live publicatie staat uit (proefstand): alles klaarzetten en controleren, niets plaatsen.
  const plan = await getPlan();
  if (!plan.live_publishing) {
    await preflight(pub);
    await set(pub.id, { status: "concept_klaar", live: false, last_checked_at: new Date(), last_error: null });
    await ctx.step("Proefstand: niet live geplaatst (live publicatie staat uit)");
    return { status: "afgerond", result: { proef: true }, message: "Klaar als concept; live publicatie staat uit." };
  }
  if (pub.method === "buffer") return runBuffer(pub, ctx);
  if (pub.channel !== "instagram") throw Object.assign(new Error("Onbekende route voor dit kanaal."), { retryable: false });
  if (pub.status === "bezig" && Date.now() - new Date(pub.updated_at) < 120_000) return { deferS: 60, message: "Een andere uitvoering is met deze publicatie bezig; later controleren." };

  // 1. Al bekend als gepubliceerd?
  if (pub.external_id) return markPublished(pub, pub.external_id, ctx);

  // 2. Eerdere poging met container: eerst de stand bij Instagram controleren.
  if (pub.external_container_id) {
    await ctx.step("Eerdere poging controleren (container)");
    let st;
    try { st = await ig.containerStatus(pub.external_container_id); }
    catch (e) { if (e.retryable) return { deferS: 60, message: `Controle mislukt (${e.message}); later opnieuw.` }; throw e; }
    if (st.code === "PUBLISHED") {
      const found = await ig.findRecentByCaption(pub.caption, new Date(pub.created_at).getTime()).catch(() => null);
      return markPublished(pub, found?.id || null, ctx);
    }
    if (st.code === "IN_PROGRESS") { await set(pub.id, { status: "ingepland", last_checked_at: new Date() }); return { deferS: 30, message: "Instagram verwerkt de video nog." }; }
    if (st.code === "FINISHED") return doPublish(pub, ctx);
    // ERROR of EXPIRED: deze container is onbruikbaar. Als er toch een post met dezelfde caption staat, niets opnieuw doen.
    const found = await ig.findRecentByCaption(pub.caption, new Date(pub.created_at).getTime()).catch(() => null);
    if (found) return markPublished(pub, found.id, ctx);
    if (st.code === "ERROR") throw Object.assign(new Error(`Instagram kon de video niet verwerken${st.detail ? ` (${st.detail})` : ""}.`), { retryable: false });
    await set(pub.id, { external_container_id: null });
  } else if (pub.status === "onzeker") {
    // Containerverzoek met onduidelijke uitkomst: controleer recente posts.
    const found = await ig.findRecentByCaption(pub.caption, new Date(pub.created_at).getTime()).catch(() => null);
    if (found) return markPublished(pub, found.id, ctx);
  }

  // 3. Controles vlak voor het plaatsen.
  await preflight(pub);

  // 4. Container maken en direct opslaan.
  await ctx.step("Video aanbieden aan Instagram");
  await set(pub.id, { status: "bezig", attempts: pub.attempts + 1 });
  let containerId;
  try {
    containerId = await ig.createContainer({ videoUrl: await mediaUrl(pub.video_key, 6), coverUrl: pub.cover_key ? await mediaUrl(pub.cover_key, 6) : null, caption: pub.caption });
  } catch (e) {
    if (e.ambiguous) { await set(pub.id, { status: "onzeker", last_error: e.message }); return { deferS: 60, message: "Uitkomst onduidelijk; eerst controleren." }; }
    throw e;
  }
  await set(pub.id, { external_container_id: containerId, status: "ingepland", last_checked_at: new Date() });
  return { deferS: 20, message: "Container aangemaakt; wacht op verwerking door Instagram." };
}

async function doPublish(pub, ctx) {
  await ctx.step("Publiceren");
  // Markeer vóór het verzoek: als dit proces hierna stopt, weet de volgende run dat hij eerst moet controleren.
  await set(pub.id, { status: "onzeker", attempts: pub.attempts + 1, last_checked_at: new Date() });
  let mediaId;
  try { mediaId = await ig.publishContainer(pub.external_container_id); }
  catch (e) {
    if (e.ambiguous || e.retryable) { await set(pub.id, { last_error: e.message }); return { deferS: 60, message: `${e.message} Volgende run controleert eerst of de post al staat.` }; }
    await set(pub.id, { status: "ingepland" });
    throw e;
  }
  await set(pub.id, { external_id: mediaId });
  return markPublished(pub, mediaId, ctx);
}

export async function onFailure(db, task, { message, retry }) {
  if (retry) return;
  await db.query("update hq.publications set status='mislukt', last_error=$2, updated_at=now() where id=$1 and status not in ('gepubliceerd','handmatig_geplaatst','geannuleerd')", [task.input?.publication_id, message]);
}

/** Controles vlak voor het aanleveren: render hoort bij het script, beelden nog geldig, actie nog actief. */
async function preflight(pub) {
  const r = await one("select script_hash from hq.renders where id=$1 and status='klaar'", [pub.render_id]);
  if (!r) throw Object.assign(new Error("De video bestaat niet meer."), { retryable: false });
  // Door jou ingepland: alleen met jouw goedkeuring van precies deze video. Door het kantoor
  // automatisch ingepland: alleen zolang het script niet is gewijzigd na de render.
  const ok = pub.created_by ? (pub.piece_status === "goedgekeurd" && pub.approved_render_id === pub.render_id) : r.script_hash === scriptHash(pub.script);
  if (!ok) throw Object.assign(new Error("De goedkeuring hoort niet meer bij deze video (script gewijzigd). Keur opnieuw goed."), { retryable: false });
  const paths = [...new Set(pub.script.scenes.flatMap(s => [s.asset, s.asset2]).filter(Boolean))];
  const bad = (await q("select label from hq.project_assets where (project_id is not distinct from $1 or project_id is null) and path = any($2::text[]) and (not social_ok or valid_until <= now())", [pub.project_id, paths])).rows;
  if (bad.length) throw Object.assign(new Error(`Beeld niet meer bruikbaar: ${bad.map(b => b.label).join(", ")}.`), { retryable: false });
  // Actieregel alleen zolang de actie loopt (op het moment van plaatsen).
  const caption = await captionFor(null, pub.script, pub.channel, pub.scheduled_at || new Date());
  if (caption !== pub.caption) { await set(pub.id, { caption, caption_hash: sha(caption) }); pub.caption = caption; }
}

// ── Buffer ─────────────────────────────────────────────────────────────────
// Regels tegen dubbele posts: één Buffer-post per publicatie (ID opgeslagen); vlak vóór het
// aanmaken status "onzeker"; na een onduidelijke uitkomst eerst in Buffer zoeken (zelfde
// kanaal, tekst en tijd) voordat er iets opnieuw wordt aangemaakt. "Gepubliceerd" pas als
// Buffer de post als verstuurd meldt.
async function runBuffer(pub, ctx) {
  const route = await routeFor(pub.channel);
  if (route.method !== "buffer") throw Object.assign(new Error(`Buffer-route niet (meer) beschikbaar: ${route.reason || "andere route gekozen"}.`), { retryable: false });
  // Al bij Buffer: stand controleren.
  if (pub.external_container_id) return checkBuffer(pub, ctx);
  if (pub.status === "onzeker") {
    await ctx.step("Eerdere poging controleren in Buffer");
    let found;
    try { found = await buffer.findPost({ channelId: route.channelId, text: pub.caption, dueAt: pub.scheduled_at }); }
    catch (e) { if (e.retryable) return { deferS: 120, message: `Controle in Buffer mislukt (${e.message}); later opnieuw.` }; throw Object.assign(new Error(`Controleer in Buffer of deze post er al staat (${e.message}). Daarna kun je opnieuw proberen.`), { retryable: false }); }
    if (found) { await set(pub.id, { external_container_id: found.id, status: "bij_dienst", last_error: null }); return checkBuffer({ ...pub, external_container_id: found.id }, ctx); }
  }
  await preflight(pub);
  await ctx.step(`Aanleveren bij Buffer (${pub.channel})`);
  await set(pub.id, { status: "onzeker", attempts: pub.attempts + 1, last_checked_at: new Date() });
  let post;
  try {
    post = await buffer.createVideoPost({ channelId: route.channelId, channel: pub.channel, text: pub.caption, videoUrl: await mediaUrl(pub.video_key, 72), coverUrl: pub.cover_key ? await mediaUrl(pub.cover_key, 72) : null,
      dueAt: new Date(Math.max(new Date(pub.scheduled_at || Date.now()).getTime(), Date.now() + 5 * 60_000)) });
  } catch (e) {
    if (e.queueFull) {
      // Wachtrij vol (gratis plan: 10 geplande posts per kanaal): post bewaren en later opnieuw.
      await set(pub.id, { status: "wachtrij_vol", last_error: "Wachtrij bij Buffer is vol; HQ probeert het later opnieuw." });
      return { deferS: 3 * 3600, message: "Wachtrij bij Buffer vol; over 3 uur opnieuw." };
    }
    if (e.ambiguous) { await set(pub.id, { last_error: e.message }); return { deferS: 120, message: `${e.message} Volgende run zoekt eerst in Buffer.` }; }
    await set(pub.id, { status: "ingepland" });
    throw e;
  }
  await set(pub.id, { external_container_id: post.id, status: "bij_dienst", last_error: null });
  return checkBuffer({ ...pub, external_container_id: post.id }, ctx);
}

async function checkBuffer(pub, ctx) {
  let p;
  try { p = await buffer.getPost(pub.external_container_id); }
  catch (e) { return { deferS: 600, message: `Stand bij Buffer niet op te halen (${e.message}); later opnieuw.` }; }
  if (!p) throw Object.assign(new Error("De post staat niet meer in Buffer (verwijderd?). Plan opnieuw in als dat de bedoeling is."), { retryable: false });
  await set(pub.id, { last_checked_at: new Date() });
  if (p.status === "sent") {
    await set(pub.id, { status: "gepubliceerd", external_id: p.id, permalink: p.link, published_at: p.sentAt ? new Date(p.sentAt) : new Date(), last_error: null });
    await ctx.step("Bevestigd geplaatst door Buffer");
    return { status: "afgerond", result: { buffer_id: p.id, link: p.link }, message: "Gepubliceerd (bevestigd door Buffer)." };
  }
  if (p.status === "error") throw Object.assign(new Error(`Buffer kon de post niet plaatsen${p.error ? `: ${p.error}` : ""}.`), { retryable: false });
  // Nog in de wachtrij van Buffer: na het geplande moment opnieuw kijken.
  const due = new Date(pub.scheduled_at || Date.now()).getTime();
  const wait = Math.max(300, Math.min(6 * 3600, Math.round((due - Date.now()) / 1000) + 300));
  if (Date.now() - due > 48 * 3600e3) { await set(pub.id, { status: "onzeker", last_error: "Buffer meldt na 48 uur nog geen plaatsing. Controleer de post in Buffer." }); return { status: "afgerond", message: "Na 48 uur nog niet bevestigd." }; }
  return { deferS: wait, message: "Ligt bij Buffer; wacht op bevestiging van plaatsing." };
}
