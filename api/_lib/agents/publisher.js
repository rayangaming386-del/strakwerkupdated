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
import { captionFor, sha } from "../content/studio.js";
import * as ig from "../content/instagram.js";

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
  if (pub.method !== "api" || pub.channel !== "instagram") throw Object.assign(new Error("Voor dit kanaal is geen automatische koppeling: plaats de export zelf."), { retryable: false });
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
  if (pub.piece_status !== "goedgekeurd" || pub.approved_render_id !== pub.render_id) throw Object.assign(new Error("De goedkeuring hoort niet meer bij deze video (script gewijzigd). Keur opnieuw goed."), { retryable: false });
  const paths = [...new Set(pub.script.scenes.flatMap(s => [s.asset, s.asset2]).filter(Boolean))];
  const bad = (await q("select label from hq.project_assets where project_id=$1 and path = any($2::text[]) and (not social_ok or valid_until <= now())", [pub.project_id, paths])).rows;
  if (bad.length) throw Object.assign(new Error(`Beeld niet meer bruikbaar: ${bad.map(b => b.label).join(", ")}.`), { retryable: false });
  // Actieregel alleen zolang de actie loopt.
  const caption = await captionFor(null, pub.script, "instagram", new Date());
  if (caption !== pub.caption) { await set(pub.id, { caption, caption_hash: sha(caption) }); pub.caption = caption; }

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
