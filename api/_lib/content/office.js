// Zelfstandig marketingkantoor van StrakWerk. Eén keer instellen (doelgroep, doelen,
// kanalen, publicatiedagen, weeklimiet); daarna maakt HQ zelf de video's:
//   onderwerp kiezen → script (AI of voorbeelddata) → eigen beelden → MP4 + cover →
//   caption per kanaal → inplannen → uitkomst controleren.
// Per kanaal kies je "eerst beoordelen" of "automatisch publiceren". Gewone code doet de
// planning, montage, ondertitels, opslag, publicatie en rapportage; AI alleen de teksten.
import { q, one, tx, audit } from "../db.js";
import { HttpError, assertUuid } from "../http.js";
import { AUDIENCES, GOALS, BRAND_TOPICS } from "./planner.js";
import { amsParts, amsToUtc, isoWeekKey, createPieceTx, contentSettings, approve, schedule, getBrand } from "./studio.js";
import { instagramState } from "./instagram.js";
import { bufferConfigured } from "./buffer.js";
import { getPlan, routeFor, ROUTES, MODES } from "./plan.js";
export { getPlan, routeFor, ROUTES, MODES };

export async function putPlan(body, auth) {
  const cur = await getPlan();
  const next = { ...cur };
  if ("enabled" in body) next.enabled = Boolean(body.enabled);
  if ("weekly_limit" in body) { const n = Number(body.weekly_limit); if (!(Number.isInteger(n) && n >= 0 && n <= 14)) throw new HttpError(400, "ongeldig", "Weeklimiet moet tussen 0 en 14 liggen."); next.weekly_limit = n; }
  if ("weekdays" in body) next.weekdays = [...new Set((body.weekdays || []).map(Number).filter(d => d >= 1 && d <= 7))].sort();
  if ("post_time" in body) { if (!/^[0-2]\d:[0-5]\d$/.test(body.post_time)) throw new HttpError(400, "ongeldig", "Tijd als UU:MM."); next.post_time = body.post_time; }
  if ("audiences" in body) { next.audiences = (body.audiences || []).filter(a => AUDIENCES[a]); if (!next.audiences.length) next.audiences = ["ondernemers"]; }
  if ("goals" in body) { next.goals = (body.goals || []).filter(g => GOALS[g]); if (!next.goals.length) next.goals = ["aanvragen"]; }
  if ("portfolio_every" in body) { const n = Number(body.portfolio_every); next.portfolio_every = Number.isInteger(n) && n >= 0 && n <= 10 ? n : 3; }
  if ("live_publishing" in body) next.live_publishing = Boolean(body.live_publishing);
  for (const ch of ["instagram", "tiktok"]) if (body.channels?.[ch]) {
    const c = body.channels[ch], o = { ...cur.channels[ch] };
    if ("enabled" in c) o.enabled = Boolean(c.enabled);
    if ("mode" in c) { if (!MODES[c.mode]) throw new HttpError(400, "ongeldig", "Onbekende modus."); o.mode = c.mode; }
    if ("route" in c) {
      if (!ROUTES[c.route] || (c.route === "instagram_api" && ch !== "instagram")) throw new HttpError(400, "ongeldig", "Onbekende publicatieroute voor dit kanaal.");
      o.route = c.route; // precies één actieve route per kanaal: voorkomt dubbele posts
    }
    next.channels[ch] = o;
  }
  if (next.weekly_limit > next.weekdays.length * 2) throw new HttpError(400, "ongeldig", "Kies meer publicatiedagen of een lagere weeklimiet.");
  await q("insert into hq.settings (key, value, updated_by, updated_at) values ('marketing',$1,$2,now()) on conflict (key) do update set value=excluded.value, updated_by=excluded.updated_by, updated_at=now()", [next, auth.userId]);
  await audit(null, { actor: auth.userId, label: auth.email, action: "kantoor.plan", details: { van: cur, naar: next } });
  return next;
}


/** Publicatiemomenten (Nederlandse tijd) volgens het plan, met de weeklimiet per ISO-week. */
export function planSlots(plan, from, to) {
  const [hh, mm] = plan.post_time.split(":").map(Number);
  const out = [], perWeek = {};
  for (let t = from.getTime() - 864e5; t < to.getTime() + 864e5; t += 864e5) {
    const p = amsParts(new Date(t));
    if (!plan.weekdays.includes(p.wd)) continue;
    const at = amsToUtc(p.y, p.m, p.d, hh, mm);
    if (at < from || at >= to || out.some(x => +x === +at)) continue;
    const wk = isoWeekKey(at);
    perWeek[wk] = (perWeek[wk] || 0) + 1;
    if (perWeek[wk] > plan.weekly_limit) continue;
    out.push(at);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Eén ronde van het kantoor (via /api/worker, elke paar minuten). Maakt voor elk komend
 * publicatiemoment binnen de productietijd precies één contentstuk (origin_key per moment),
 * ook als meerdere rondes tegelijk draaien.
 */
export async function officeTick(now = new Date()) {
  const plan = await getPlan();
  const s = await contentSettings();
  if (!plan.enabled) return { skipped: "uit" };
  if (s.paused) return { skipped: "gepauzeerd" };
  // Week-teller begint bij het begin van de (Nederlandse) week, zodat de limiet per week klopt.
  const p = amsParts(now);
  const weekStart = amsToUtc(p.y, p.m, p.d, 0, 0); weekStart.setTime(weekStart.getTime() - (p.wd - 1) * 864e5);
  const horizon = new Date(now.getTime() + (plan.lead_days + 1) * 864e5);
  const slots = planSlots(plan, weekStart, horizon).filter(at => at > new Date(now.getTime() + 2 * 3600e3));
  const made = [];
  for (const at of slots) {
    const key = `kantoor:${at.toISOString()}`;
    if (await one("select 1 from hq.content_pieces where origin_key=$1", [key])) continue;
    const n = (await one("select count(*)::int n from hq.content_pieces where origin='automatisering' and origin_key like 'kantoor:%'")).n;
    const audience = plan.audiences[n % plan.audiences.length];
    const goal = plan.goals[n % plan.goals.length];
    // Portfolio is optioneel: elke n-de video, alleen als er een opgeleverd project met vrijgegeven beelden is.
    let project = null;
    if (plan.portfolio_every > 0 && n % plan.portfolio_every === plan.portfolio_every - 1) {
      project = await one(`select p.* from hq.projects p where p.status in ('opgeleverd','nazorg')
        and (select count(*) from hq.project_assets a where a.project_id=p.id and a.social_ok and (a.valid_until is null or a.valid_until > $1)) >= 3
        order by (select max(created_at) from hq.content_pieces c where c.project_id=p.id) nulls first limit 1`, [at]);
    }
    const topic = project ? null : await nextTopic();
    const out = await tx(db => createPieceTx(db, { project, topic, audience: project ? audience : audience, goal, assetIds: [], origin: "automatisering", originKey: key, slotAt: at }, null));
    made.push({ slot: at.toISOString(), piece: out.id, duplicate: out.duplicate, kind: project ? "portfolio" : "merk" });
  }
  return { made };
}

async function nextTopic() {
  const used = (await q("select topic_key, max(created_at) as last from hq.content_pieces where project_id is null and topic_key is not null group by 1")).rows;
  return Object.keys(BRAND_TOPICS).sort((a, b) => (+new Date(used.find(u => u.topic_key === a)?.last || 0)) - (+new Date(used.find(u => u.topic_key === b)?.last || 0)))[0];
}

/**
 * Na een geslaagde render van een kantoorvideo: kanalen op "automatisch" worden direct
 * ingepland op het publicatiemoment; kanalen op "eerst beoordelen" wachten op jouw
 * goedkeuring (en worden dan op hetzelfde moment ingepland).
 */
export async function onOfficeRendered(pieceId, renderId) {
  const piece = await one("select * from hq.content_pieces where id=$1 and origin='automatisering' and origin_key like 'kantoor:%'", [pieceId]);
  if (!piece) return null;
  const plan = await getPlan(), s = await contentSettings();
  if (s.paused) return { skipped: "gepauzeerd" };
  const enabled = Object.entries(plan.channels).filter(([, c]) => c.enabled);
  const auto = enabled.filter(([, c]) => c.mode === "auto").map(([k]) => k);
  const review = enabled.filter(([, c]) => c.mode === "review").map(([k]) => k);
  const out = {};
  if (!auto.length) return { review };
  // Automatisch kanaal: HQ keurt deze render goed (binnen jouw instellingen) en plant in.
  if (!review.length) await approve(pieceId, renderId, null);
  for (const ch of auto) {
    const at = slotOrSoon(piece.slot_at);
    try { out[ch] = await schedule(pieceId, { channel: ch, at: at.toISOString(), system_render_id: renderId }, null); }
    catch (e) { out[ch] = { fout: e.message }; }
  }
  return { auto: out, review };
}

/** Na jouw goedkeuring: kanalen op "eerst beoordelen" inplannen op het moment uit het plan. */
export async function scheduleReviewChannels(pieceId, actor) {
  const piece = await one("select * from hq.content_pieces where id=$1", [pieceId]);
  if (!piece?.slot_at) return {};
  const plan = await getPlan();
  const out = {};
  for (const [ch, c] of Object.entries(plan.channels)) {
    if (!c.enabled) continue;
    if (await one("select 1 from hq.publications where piece_id=$1 and channel=$2 and status<>'geannuleerd'", [pieceId, ch])) continue;
    try { out[ch] = await schedule(pieceId, { channel: ch, at: slotOrSoon(piece.slot_at).toISOString() }, actor); }
    catch (e) { out[ch] = { fout: e.message }; }
  }
  return out;
}
const slotOrSoon = (slot) => { const soon = new Date(Date.now() + 15 * 60_000); return slot && new Date(slot) > soon ? new Date(slot) : soon; };

/**
 * Alleen de publicatietijd wijzigen: geen AI-aanroep en geen nieuwe render. Werkt voor
 * publicaties die nog niet bij een dienst of platform liggen.
 */
export async function reschedulePublication(pubId, body, auth) {
  assertUuid(pubId);
  const loc = typeof body.at_local === "string" && body.at_local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  const at = loc ? amsToUtc(+loc[1], +loc[2], +loc[3], +loc[4], +loc[5]) : body.at ? new Date(body.at) : null;
  if (!at || Number.isNaN(at.getTime())) throw new HttpError(400, "ongeldig", "Ongeldig tijdstip.");
  if (at < new Date(Date.now() + 2 * 60_000)) throw new HttpError(400, "ongeldig", "Kies een tijdstip minstens 2 minuten in de toekomst.");
  return tx(async (db) => {
    const pub = (await db.query("select * from hq.publications where id=$1 for update", [pubId])).rows[0];
    if (!pub) throw new HttpError(404, "niet_gevonden", "Publicatie niet gevonden.");
    if (!["ingepland", "wachtrij_vol", "export_klaar", "concept_klaar"].includes(pub.status))
      throw new HttpError(409, "ongeldige_overgang", pub.status === "bij_dienst" ? "Deze post ligt al bij Buffer. Wijzig de tijd daar, of annuleer en plan opnieuw." : "De tijd van deze publicatie kan niet meer worden gewijzigd.");
    await db.query("update hq.publications set scheduled_at=$2, updated_at=now() where id=$1", [pubId, at]);
    if (pub.task_id) await db.query("update hq.tasks set run_after=$2, updated_at=now() where id=$1 and status='in_wachtrij'", [pub.task_id, at]);
    await audit(db, { actor: auth.userId, label: auth.email, action: "publicatie.tijd", entity: "publication", entityId: pubId, details: { van: pub.scheduled_at, naar: at } });
    return { id: pubId, scheduled_at: at };
  });
}

/** Overzicht voor de instellingenpagina van het kantoor. */
export async function officeOverview() {
  const plan = await getPlan();
  const now = new Date();
  const slots = planSlots(plan, now, new Date(now.getTime() + 14 * 864e5));
  const routes = {};
  for (const ch of ["instagram", "tiktok"]) routes[ch] = await routeFor(ch, plan);
  const rw = await one("select value, updated_at from hq.settings where key='render_worker'");
  const waitingRender = (await one("select count(*)::int n, min(created_at) as oldest from hq.tasks where agent_key='video' and status='in_wachtrij'"));
  return { plan, slots, routes, routeLabels: ROUTES, modeLabels: MODES, topics: BRAND_TOPICS, audiences: AUDIENCES, goals: GOALS, brand: await getBrand(),
    buffer: { configured: bufferConfigured() }, instagram: await instagramState(),
    renderWorker: rw ? { ...rw.value, seen: rw.updated_at } : null, waitingRender };
}
