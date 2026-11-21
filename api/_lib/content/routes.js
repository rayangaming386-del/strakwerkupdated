// Routes van de contentstudio onder /api/hq/studio/*, /api/hq/media/* en
// /api/hq/integrations/instagram/*. Elke route controleert rechten aan de serverkant.
import { one, q, audit } from "../db.js";
import { json, route, HttpError, assertUuid } from "../http.js";
import { assertPerm } from "../auth.js";
import * as studio from "./studio.js";
import * as storage from "./storage.js";
import * as ig from "./instagram.js";
import { AUDIENCES, GOALS, BRAND_TOPICS } from "./planner.js";
import * as office from "./office.js";
import * as budget from "../budget.js";
import * as buffer from "./buffer.js";

async function renderWorkerState() {
  const r = await one("select value, updated_at from hq.settings where key='render_worker'");
  return r ? { ...r.value, seen: r.updated_at } : null;
}

export async function handleStudio({ m, path, url, body, auth, request, startWorker }) {
  let p;
  if (m === "GET" && path === "studio/overview") {
    const [wq, projects, rw, settings] = await Promise.all([studio.workqueue(), studio.listProjects(), renderWorkerState(), studio.contentSettings()]);
    return json({ ...wq, projects: projects.map(x => ({ id: x.id, name: x.name, status: x.status, released_count: x.released_count, asset_count: x.asset_count, piece_count: x.piece_count })),
      renderWorker: rw, storage: storage.driver(), instagram: await ig.instagramState(), settings, audiences: AUDIENCES, goals: GOALS, topics: BRAND_TOPICS,
      ai: await budget.budgetOverview(), office: { plan: await office.getPlan() },
      projectStatus: studio.PROJECT_STATUS_LABEL });
  }
  // ── Zelfstandig kantoor, merk en AI-budget ──
  if (m === "GET" && path === "studio/office") return json(await office.officeOverview());
  if (m === "PUT" && path === "studio/office") { assertPerm(auth, "content.settings"); return json({ plan: await office.putPlan(body, auth) }); }
  if (m === "PUT" && path === "studio/brand") { assertPerm(auth, "content.settings"); return json({ brand: await studio.putBrand(body, auth) }); }
  if (m === "GET" && path === "ai/budget") return json(await budget.budgetOverview());
  if (m === "PUT" && path === "ai/budget") { assertPerm(auth, "content.settings"); const r = await budget.putBudget(body, auth); if (r.resumed) startWorker(); return json(r); }
  if (m === "GET" && path === "integrations/buffer/channels") {
    assertPerm(auth, "content.settings");
    if (!buffer.bufferConfigured()) throw new HttpError(409, "niet_gekoppeld", "Buffer is nog niet gekoppeld.", { missing: ["BUFFER_API_KEY"] });
    try { return json({ channels: await buffer.listChannels() }); } catch (e) { throw new HttpError(502, "buffer", e.message); }
  }
  if ((p = route(path, "studio/publications/:id/tijd")) && m === "POST") { assertPerm(auth, "content.approve"); return json(await office.reschedulePublication(p.id, body, auth)); }
  if (m === "GET" && path === "studio/projects") return json({ projects: await studio.listProjects(), statuses: studio.PROJECT_STATUS_LABEL });
  if (m === "POST" && path === "studio/projects") { assertPerm(auth, "content.write"); return json({ project: await studio.createProject(body, auth) }, 201); }
  if ((p = route(path, "studio/projects/:id"))) {
    if (m === "GET") return json({ ...(await studio.projectDetail(p.id)), statuses: studio.PROJECT_STATUS_LABEL });
    if (m === "PATCH") {
      assertPerm(auth, "content.write");
      const r = await studio.patchProject(p.id, body, auth);
      if (r.deliveryPiece?.id && !r.deliveryPiece.duplicate) startWorker();
      return json(r);
    }
  }
  if ((p = route(path, "studio/assets/:id")) && m === "PATCH") {
    if ("social_ok" in body || "valid_until" in body) assertPerm(auth, "assets.release"); else assertPerm(auth, "content.write");
    const r = await studio.patchAsset(p.id, body, auth); startWorker(); return json({ asset: r });
  }

  if (m === "POST" && path === "studio/pieces") {
    assertPerm(auth, "content.write");
    const r = await studio.createPiece(body, auth, request.headers.get("x-idempotency-key"));
    startWorker(); return json(r, r.duplicate ? 200 : 201);
  }
  if ((p = route(path, "studio/pieces/:id")) && m === "GET") return json(await studio.pieceDetail(p.id));
  if ((p = route(path, "studio/pieces/:id/angle")) && m === "POST") { assertPerm(auth, "content.write"); return json(await studio.chooseAngle(p.id, Number(body.index), auth)); }
  if ((p = route(path, "studio/pieces/:id/scenes/:scene")) && m === "PATCH") { assertPerm(auth, "content.write"); return json(await studio.editScene(p.id, p.scene, body, auth)); }
  if ((p = route(path, "studio/pieces/:id/captions/:channel")) && m === "PUT") { assertPerm(auth, "content.write"); return json(await studio.editCaption(p.id, p.channel, body, auth)); }
  if ((p = route(path, "studio/pieces/:id/render")) && m === "POST") { assertPerm(auth, "content.write"); return json(await studio.rerender(p.id, auth), 201); }
  if ((p = route(path, "studio/pieces/:id/replan")) && m === "POST") { assertPerm(auth, "content.write"); const r = await studio.replan(p.id, auth); startWorker(); return json(r, 201); }
  if ((p = route(path, "studio/pieces/:id/approve")) && m === "POST") {
    assertPerm(auth, "content.approve");
    const r = await studio.approve(p.id, body.render_id, auth);
    // Kantoorvideo: kanalen op "eerst beoordelen" nu inplannen op het moment uit het plan.
    const sched = await office.scheduleReviewChannels(p.id, auth);
    if (Object.keys(sched).length) startWorker();
    return json({ ...r, scheduled: sched });
  }
  if ((p = route(path, "studio/pieces/:id/schedule")) && m === "POST") { assertPerm(auth, "content.approve"); const r = await studio.schedule(p.id, body, auth); startWorker(); return json(r, 201); }
  if ((p = route(path, "studio/pieces/:id/archive")) && m === "POST") { assertPerm(auth, "content.write"); return json(await studio.archivePiece(p.id, auth)); }
  if ((p = route(path, "studio/publications/:id/metrics")) && m === "POST") { assertPerm(auth, "content.write"); return json(await studio.addMetric(p.id, body, auth)); }
  if ((p = route(path, "studio/publications/:id/:action")) && m === "POST") {
    assertPerm(auth, p.action === "zelf_geplaatst" ? "content.write" : "content.approve");
    const r = await studio.publicationAction(p.id, p.action, body, auth);
    if (r.taskId) startWorker();
    return json(r);
  }
  if (m === "GET" && path === "studio/calendar") return json(await studio.calendar(url.searchParams.get("from"), url.searchParams.get("days")));
  if (m === "GET" && path === "studio/automation") return json(await studio.automationOverview());
  if (m === "PUT" && path === "studio/settings") { assertPerm(auth, "content.settings"); return json({ settings: await studio.putContentSettings(body, auth) }); }
  if ((p = route(path, "studio/formats/:key")) && m === "PUT") { assertPerm(auth, "content.settings"); return json({ format: await studio.putFormat(p.key, body, auth) }); }
  if (m === "PUT" && path === "studio/automation") { assertPerm(auth, "content.settings"); return json({ rule: await studio.putAutomation(body, auth) }); }
  if (m === "GET" && path === "studio/insights") return json(await studio.insights());
  if ((p = route(path, "leads/:id/campaign")) && m === "POST") { assertPerm(auth, "leads.write"); return json(await studio.linkLead(p.id, body, auth)); }
  if (m === "GET" && path === "studio/campaigns") {
    return json({ campaigns: (await q("select c.id, c.title, c.keyword, c.campaign_code from hq.content_pieces c where c.status<>'gearchiveerd' order by c.created_at desc limit 50")).rows });
  }

  // Video en cover afspelen of downloaden (alleen ingelogd).
  if ((p = route(path, "media/:render/:file")) && m === "GET") {
    assertUuid(p.render, "render");
    if (!["video", "cover", "subtitles"].includes(p.file)) throw new HttpError(404, "niet_gevonden", "Onbekend bestand.");
    const r = await one("select r.video_key, r.cover_key, r.subtitles_key, r.version, coalesce(pr.slug, 'strakwerk-' || coalesce(c.topic_key, 'video')) as slug from hq.renders r join hq.content_pieces c on c.id=r.piece_id left join hq.projects pr on pr.id=c.project_id where r.id=$1", [p.render]);
    const key = r && ({ video: r.video_key, cover: r.cover_key, subtitles: r.subtitles_key })[p.file];
    if (!key) throw new HttpError(404, "niet_gevonden", "Bestand niet gevonden.");
    const ext = { video: "mp4", cover: "jpg", subtitles: "srt" }[p.file];
    const download = url.searchParams.get("download") ? `${r.slug.startsWith("strakwerk") ? r.slug : `strakwerk-${r.slug}`}-v${r.version}.${ext}` : null;
    const type = { video: "video/mp4", cover: "image/jpeg", subtitles: "application/x-subrip; charset=utf-8" }[p.file];
    if (storage.driver() === "supabase") return new Response(null, { status: 302, headers: { location: await storage.signedUrl(key, { expiresIn: 600, download }), "cache-control": "no-store" } });
    return storage.localResponse(key, request, { contentType: type, download });
  }

  // Instagram koppelen (OAuth). Tokens blijven op de server.
  if (m === "GET" && path === "integrations/instagram/start") {
    assertPerm(auth, "content.settings");
    const miss = ig.missingIg();
    if (miss.length) throw new HttpError(409, "niet_gekoppeld", "Instagram-koppeling is nog niet ingesteld.", { missing: miss });
    return new Response(null, { status: 302, headers: { location: ig.authorizeUrl(auth.userId), "cache-control": "no-store" } });
  }
  if (m === "GET" && path === "integrations/instagram/callback") {
    assertPerm(auth, "content.settings");
    if (!ig.checkState(url.searchParams.get("state"), auth.userId)) throw new HttpError(400, "ongeldig", "Ongeldige of verlopen koppelpoging. Probeer opnieuw.");
    if (url.searchParams.get("error")) return redirect("/hq/instellingen?instagram=geweigerd");
    const code = String(url.searchParams.get("code") || "").replace(/#_$/, "");
    try { await ig.exchangeCode(code, auth.userId); } catch (e) { return redirect(`/hq/instellingen?instagram=mislukt&reden=${encodeURIComponent(String(e.message).slice(0, 120))}`); }
    await audit(null, { actor: auth.userId, label: auth.email, action: "instagram.gekoppeld" });
    return redirect("/hq/instellingen?instagram=gekoppeld");
  }
  if (m === "POST" && path === "integrations/instagram/disconnect") {
    assertPerm(auth, "content.settings"); await ig.disconnect();
    await audit(null, { actor: auth.userId, label: auth.email, action: "instagram.ontkoppeld" });
    return json({ ok: true });
  }
  return null;
}

const redirect = (to) => new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });
