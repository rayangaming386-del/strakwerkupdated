// Contentstudio: klantprojecten, vrijgegeven beelden, contentopdrachten, renders,
// publicaties per kanaal, automatisering en resultaten. Alles via dezelfde klant- en
// projectgegevens als het CRM (hq.leads → hq.projects → hq.content_pieces).
import { createHash, randomUUID } from "node:crypto";
import { q, one, tx, audit } from "../db.js";
import { HttpError, assertUuid, str } from "../http.js";
import { enqueue, event } from "../queue.js";
import { AUDIENCES, GOALS, BRAND_TOPICS, contentGuard } from "./planner.js";
import { instagramState } from "./instagram.js";
import { routeFor, getPlan } from "./plan.js";

import SITE_DATA from "./site-data.json" with { type: "json" };
export const SITE = SITE_DATA;

export const PROJECT_STATUS = ["akkoord", "intake", "in_aanbouw", "websitecontrole", "opgeleverd", "nazorg", "gestopt"];
export const PROJECT_STATUS_LABEL = { akkoord: "Akkoord", intake: "Intake", in_aanbouw: "In aanbouw", websitecontrole: "Websitecontrole", opgeleverd: "Opgeleverd", nazorg: "Nazorg", gestopt: "Gestopt" };
export const CHANNELS = { instagram: "Instagram", tiktok: "TikTok" };
export const PUB_LABEL = { ingepland: "Ingepland", bezig: "Wordt geplaatst", bij_dienst: "Ligt bij Buffer", wachtrij_vol: "Wachtrij vol: HQ probeert later", gepubliceerd: "Gepubliceerd", mislukt: "Mislukt", onzeker: "Onzeker: wordt gecontroleerd", export_klaar: "Klaar om zelf te plaatsen", handmatig_geplaatst: "Zelf geplaatst", geannuleerd: "Geannuleerd", concept_klaar: "Proef: klaar, niet live" };
export const COLUMNS = { actie_nodig: "Actie nodig", concept: "Concept", render_bezig: "Render bezig", klaar_voor_review: "Klaar voor review", ingepland: "Ingepland", gepubliceerd: "Gepubliceerd" };

// Wat ik bij het controleren van de bestaande portfoliobeelden zag. Feiten over het beeld,
// geen marketingclaims. "block" = niet vrij te geven voor social media.
const ASSET_INFO = {
  "/assets/work/glow.webp": { hint: "Rustige salon aan het Bredewater in Zoetermeer.", notes: "Toont bovenaan de actiebalk van de salon (t/m 1 januari).", valid_until: "2027-01-02T00:00:00+01:00" },
  "/assets/work/glow-behandelingen.webp": { hint: "Laserontharing, gezicht en huid, wimpers en meer.", notes: "Toont bovenaan de actiebalk van de salon (t/m 1 januari).", valid_until: "2027-01-02T00:00:00+01:00" },
  "/assets/work/glow-prijzen.webp": { hint: "Klanten zoeken hun behandeling en zien vooraf de prijs.", notes: "Toont bovenaan de actiebalk van de salon (t/m 1 januari).", valid_until: "2027-01-02T00:00:00+01:00" },
  "/assets/work/glow-boeken.webp": { hint: "Behandeling, dag en tijd, gegevens, overzicht.", notes: "Toont bovenaan de actiebalk van de salon (t/m 1 januari).", valid_until: "2027-01-02T00:00:00+01:00" },
  "/assets/work/glow-contact.webp": { hint: "Openingstijden en route op één pagina.", notes: "Toont adres, telefoonnummer en e-mail van de salon (openbare bedrijfsgegevens) en de actiebalk (t/m 1 januari).", valid_until: "2027-01-02T00:00:00+01:00" },
  "/assets/work/glow-mobiel.webp": { notes: "Toont de actiebalk van de salon (t/m 1 januari).", valid_until: "2027-01-02T00:00:00+01:00" },
  "/assets/work/glow-salon.webp": { notes: "Bevat een foto van de behandelruimte: vraag de klant om toestemming voordat je dit op social media zet. Toont de actiebalk (t/m 1 januari).", valid_until: "2027-01-02T00:00:00+01:00" },
  "/assets/work/cartronic-reviews.webp": { block: true, notes: "Toont reviews van klanten van CarTronic. Niet gebruiken in StrakWerk-marketing: kan lijken op reviews van StrakWerk." },
};
export const assetInfo = (p) => ASSET_INFO[p] || {};

const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
// Zelfde canonieke hash als worker.stableHash (hier los, om een kringverwijzing te voorkomen).
export function stableHash(obj) {
  const canon = (v) => Array.isArray(v) ? `[${v.map(canon).join(",")}]`
    : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`
    : JSON.stringify(v ?? null);
  return sha(canon(obj));
}
const hasRole = (auth, ...roles) => roles.includes(auth?.role);

// ── Portfolio als projecten (eenmalig per instantie, idempotent) ──────────────
let seeded = false;
export async function ensurePortfolio() {
  if (seeded) return;
  await tx(async (db) => {
    for (const p of SITE.projects) {
      const pr = (await db.query(
        `insert into hq.projects (slug, name, status, sector, city, live_url, summary, features, source)
         values ($1,$2,'opgeleverd',$3,$4,$5,$6,$7,'portfolio') on conflict (slug) do update set summary=excluded.summary, features=excluded.features, live_url=excluded.live_url
         returning id`, [p.slug, p.name, p.sector, p.city, p.live, p.text, JSON.stringify(p.made)])).rows[0];
      for (const s of p.shots) {
        const info = assetInfo(s.path);
        await db.query(
          `insert into hq.project_assets (project_id, path, kind, label, alt, width, height, notes, valid_until)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (project_id, path) do nothing`,
          [pr.id, s.path, s.kind, s.label, s.alt, s.width || null, s.height || null, info.notes || "", info.valid_until || null]);
      }
    }
  });
  // Eigen materiaal van StrakWerk (geen klantproject): van Rayan zelf, dus vrij voor social media.
  await tx(async (db) => {
    for (const a of SITE.brand_assets || []) {
      await db.query(`insert into hq.project_assets (project_id, path, kind, label, alt, width, height, duration_s, social_ok, released_at, notes)
        values (null,$1,$2,$3,$4,$5,$6,$7,true,now(),$8) on conflict (path) where project_id is null do update set width=excluded.width, height=excluded.height, duration_s=excluded.duration_s, label=excluded.label`,
        [a.path, a.kind, a.label, a.alt || "", a.width || null, a.height || null, a.duration_s || null, "Eigen schermopname/schermafbeelding van strakwerkk.nl (opgenomen met een datum na de actie)."]);
    }
  });
  seeded = true;
}

/** Afzender van alle campagnes: StrakWerk. Vaste gegevens uit de site, accounts uit HQ. */
export async function getBrand(db) {
  const r = (await (db || { query: q }).query("select value from hq.settings where key='brand'")).rows[0]?.value || {};
  return { ...SITE.brand, socials: { instagram: "", tiktok: "", ...(r.socials || {}) }, buffer_channels: { instagram: "", tiktok: "", ...(r.buffer_channels || {}) } };
}
export async function putBrand(body, auth) {
  const clean = (v) => String(v || "").trim().replace(/^@/, "").slice(0, 60);
  const cur = await getBrand();
  const next = { socials: { instagram: clean(body.socials?.instagram ?? cur.socials.instagram), tiktok: clean(body.socials?.tiktok ?? cur.socials.tiktok) },
    buffer_channels: { instagram: clean(body.buffer_channels?.instagram ?? cur.buffer_channels.instagram), tiktok: clean(body.buffer_channels?.tiktok ?? cur.buffer_channels.tiktok) } };
  for (const v of [...Object.values(next.socials), ...Object.values(next.buffer_channels)]) if (v && !/^[A-Za-z0-9._-]+$/.test(v)) throw new HttpError(400, "ongeldig", "Gebruik alleen letters, cijfers, punt, streepje of underscore.");
  await q("insert into hq.settings (key, value, updated_by, updated_at) values ('brand',$1,$2,now()) on conflict (key) do update set value=excluded.value, updated_by=excluded.updated_by, updated_at=now()", [next, auth.userId]);
  await audit(null, { actor: auth.userId, label: auth.email, action: "merk.accounts", details: next.socials });
  return getBrand();
}
export const brandMoments = (path) => (SITE.brand_assets || []).find(a => a.path === path)?.moments || null;

// ── Prijzen: uit hq.packages (gelijk aan CONFIG.bases, gecontroleerd in tests) ──
export async function prices(db) {
  const r = (await (db || { query: q }).query("select key, price_cents from hq.packages where active order by sort")).rows;
  const nieuw = r.find(x => x.key === "nieuw") || r.filter(x => x.key !== "redesign").sort((a, b) => a.price_cents - b.price_cents)[0];
  const from = nieuw ? Math.round(nieuw.price_cents / 100) : SITE.bases.nieuw.price_eur;
  // Afwijking tussen HQ (hq.packages) en de website (CONFIG.bases) = actie nodig, nooit stil kiezen.
  const mismatch = Object.entries(SITE.bases).filter(([k, b]) => { const x = r.find(y => y.key === k); return x && Math.round(x.price_cents / 100) !== b.price_eur; }).map(([k]) => k);
  return { from_eur: from, site_from_eur: SITE.bases.nieuw.price_eur, all: [...new Set([...r.map(x => Math.round(x.price_cents / 100)), ...Object.values(SITE.bases).map(b => b.price_eur)])], mismatch };
}

export async function contentSettings(db) {
  const r = (await (db || { query: q }).query("select value from hq.settings where key='content'")).rows[0];
  return { paused: false, monthly_budget_usd: 5, max_cost_per_video_usd: 0.5, render_cost_usd_per_min: 0, min_hours_ahead: 24, ...(r?.value || {}) };
}

// ── Projecten ─────────────────────────────────────────────────────────────
export async function listProjects() {
  await ensurePortfolio();
  return (await q(`select p.*, l.company,
      (select count(*)::int from hq.project_assets a where a.project_id=p.id) as asset_count,
      (select count(*)::int from hq.project_assets a where a.project_id=p.id and a.social_ok) as released_count,
      (select count(*)::int from hq.content_pieces c where c.project_id=p.id and c.status<>'gearchiveerd') as piece_count
    from hq.projects p left join hq.leads l on l.id=p.lead_id order by p.updated_at desc`)).rows;
}

export async function projectDetail(id) {
  assertUuid(id);
  await ensurePortfolio();
  const p = await one("select p.*, l.company from hq.projects p left join hq.leads l on l.id=p.lead_id where p.id=$1", [id]);
  if (!p) throw new HttpError(404, "niet_gevonden", "Project niet gevonden.");
  const [assets, history, pieces] = await Promise.all([
    q("select * from hq.project_assets where project_id=$1 order by kind, created_at", [id]),
    q("select * from hq.project_history where project_id=$1 order by at desc limit 50", [id]),
    q("select id, title, status, audience, goal, origin, created_at from hq.content_pieces where project_id=$1 order by created_at desc", [id]),
  ]);
  return { project: p, assets: assets.rows.map(a => ({ ...a, hint: assetInfo(a.path).hint || "", blocked: Boolean(assetInfo(a.path).block) })), history: history.rows, pieces: pieces.rows };
}

export async function createProject(body, auth) {
  const name = str(body.name, 160);
  if (!name) throw new HttpError(400, "ongeldig", "Projectnaam is verplicht.");
  const leadId = body.lead_id ? assertUuid(body.lead_id, "lead") : null;
  const slug = (str(body.slug, 60) || name).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
  return tx(async (db) => {
    if (leadId) {
      const dup = (await db.query("select id from hq.projects where lead_id=$1", [leadId])).rows[0];
      if (dup) throw new HttpError(409, "dubbel", "Deze klant heeft al een project.", { details: { id: dup.id } });
    }
    const p = (await db.query(
      `insert into hq.projects (slug, name, lead_id, status, sector, city, live_url, summary, features, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [slug || randomUUID().slice(0, 8), name, leadId, PROJECT_STATUS.includes(body.status) ? body.status : "intake", str(body.sector, 80), str(body.city, 80), str(body.live_url, 300),
       str(body.summary, 2000) || "", JSON.stringify((Array.isArray(body.features) ? body.features : []).map(x => str(x, 120)).filter(Boolean).slice(0, 12)), auth.userId])).rows[0];
    await db.query("insert into hq.project_history (project_id, actor, actor_label, to_status, note) values ($1,$2,$3,$4,'Project aangemaakt')", [p.id, auth.userId, auth.email, p.status]);
    await audit(db, { actor: auth.userId, label: auth.email, action: "project.aangemaakt", entity: "project", entityId: p.id });
    return p;
  });
}

/** Na een geaccepteerde offerte: project aanmaken (idempotent per klant). */
export async function projectFromQuote(db, leadId, actor) {
  const lead = (await db.query("select id, company, website, city from hq.leads where id=$1", [leadId])).rows[0];
  if (!lead) return null;
  const slug = `${lead.company}`.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) + "-" + leadId.slice(0, 4);
  const p = (await db.query(
    `insert into hq.projects (slug, name, lead_id, status, city, live_url, source, created_by) values ($1,$2,$3,'akkoord',$4,$5,'offerte',$6)
     on conflict (lead_id) where lead_id is not null do nothing returning id`, [slug, lead.company, leadId, lead.city, lead.website, actor?.userId || null])).rows[0];
  if (p) await db.query("insert into hq.project_history (project_id, actor, actor_label, to_status, note) values ($1,$2,$3,'akkoord','Offerte geaccepteerd: project aangemaakt')", [p.id, actor?.userId || null, actor?.email || "systeem"]);
  return p?.id || null;
}

export async function patchProject(id, body, auth) {
  assertUuid(id);
  const out = await tx(async (db) => {
    const cur = (await db.query("select * from hq.projects where id=$1 for update", [id])).rows[0];
    if (!cur) throw new HttpError(404, "niet_gevonden", "Project niet gevonden.");
    const sets = [], vals = [id];
    const add = (c, v) => { vals.push(v); sets.push(`${c}=$${vals.length}`); };
    for (const k of ["name", "sector", "city", "live_url", "summary"]) if (k in body) add(k, str(body[k], k === "summary" ? 2000 : 300) ?? (k === "summary" ? "" : null));
    if ("features" in body) add("features", JSON.stringify((Array.isArray(body.features) ? body.features : []).map(x => str(x, 120)).filter(Boolean).slice(0, 12)));
    let status = null;
    if (body.status && body.status !== cur.status) {
      if (!PROJECT_STATUS.includes(body.status)) throw new HttpError(400, "ongeldig", "Ongeldige projectstatus.");
      status = body.status; add("status", status);
      if (status === "opgeleverd") add("delivered_at", new Date());
    }
    if (!sets.length) return { project: cur };
    const p = (await db.query(`update hq.projects set ${sets.join(", ")}, updated_at=now() where id=$1 returning *`, vals)).rows[0];
    if (status) await db.query("insert into hq.project_history (project_id, actor, actor_label, from_status, to_status, note) values ($1,$2,$3,$4,$5,$6)", [id, auth.userId, auth.email, cur.status, status, str(body.note, 300)]);
    let piece = null;
    if (status === "opgeleverd") piece = await maybeDeliveryPiece(db, id, auth);
    await audit(db, { actor: auth.userId, label: auth.email, action: "project.gewijzigd", entity: "project", entityId: id, details: { status: status || undefined } });
    return { project: p, deliveryPiece: piece };
  });
  return out;
}

/**
 * Eerste contentopdracht bij oplevering. Idempotent: origin_key is uniek per project, dus
 * een herhaalde of gelijktijdige statuswijziging maakt nooit een tweede opdracht.
 */
export async function maybeDeliveryPiece(db, projectId, actor, { fromRelease = false } = {}) {
  const p = (await db.query("select * from hq.projects where id=$1", [projectId])).rows[0];
  if (!p || !["opgeleverd", "nazorg"].includes(p.status)) return null;
  const released = (await db.query("select id from hq.project_assets where project_id=$1 and social_ok and (valid_until is null or valid_until > now()) order by created_at", [projectId])).rows;
  if (released.length < 3) return { skipped: "te_weinig_beelden", released: released.length };
  const audience = guessAudience(p);
  // Lege beeldenlijst = alle vrijgegeven beelden op het moment van plannen. Bij vrijgeven
  // wacht de planner 5 minuten, zodat de rest van de beelden ook nog mee kan.
  const r = await createPieceTx(db, { project: p, audience, goal: "aanvragen", assetIds: [], origin: "oplevering", originKey: `oplevering:${projectId}`, planAfter: fromRelease ? new Date(Date.now() + 5 * 60_000) : null }, actor);
  // Bestaat de opdracht al (bijv. eerder door vrijgeven) en wordt het project nu opgeleverd: direct plannen.
  if (r.duplicate && !fromRelease) await db.query("update hq.tasks set run_after=now() where id=(select plan_task_id from hq.content_pieces where id=$1) and status='in_wachtrij' and run_after > now()", [r.id]);
  return r;
}

export function guessAudience(p) {
  const s = `${p.sector || ""} ${p.name}`.toLowerCase();
  if (/salon|beauty|laser|nagel|wimper/.test(s)) return "saloneigenaren";
  if (/kapper|kapsalon|barber/.test(s)) return "kappers";
  if (/auto|garage|vag|sleep|takel/.test(s)) return "garages";
  if (/horeca|restaurant|caf|lunch/.test(s)) return "horeca";
  if (/bouw|aannemer|klus/.test(s)) return "bouw";
  return "ondernemers";
}

export async function patchAsset(id, body, auth) {
  assertUuid(id);
  return tx(async (db) => {
    const a = (await db.query("select * from hq.project_assets where id=$1 for update", [id])).rows[0];
    if (!a) throw new HttpError(404, "niet_gevonden", "Beeld niet gevonden.");
    const info = assetInfo(a.path);
    const sets = [], vals = [id];
    const add = (c, v) => { vals.push(v); sets.push(`${c}=$${vals.length}`); };
    if ("social_ok" in body) {
      const ok = Boolean(body.social_ok);
      if (ok && info.block) throw new HttpError(409, "geblokkeerd", info.notes || "Dit beeld kan niet worden vrijgegeven.");
      add("social_ok", ok); add("released_by", ok ? auth.userId : null); add("released_at", ok ? new Date() : null);
    }
    if ("notes" in body) add("notes", str(body.notes, 500) || "");
    if ("valid_until" in body) add("valid_until", body.valid_until && !Number.isNaN(Date.parse(body.valid_until)) ? new Date(body.valid_until) : null);
    if (!sets.length) return a;
    const r = (await db.query(`update hq.project_assets set ${sets.join(", ")} where id=$1 returning *`, vals)).rows[0];
    await audit(db, { actor: auth.userId, label: auth.email, action: "beeld.gewijzigd", entity: "asset", entityId: id, details: { social_ok: r.social_ok } });
    // Een opgeleverd project kan nu genoeg beelden hebben voor de eerste opdracht.
    if (r.social_ok) await maybeDeliveryPiece(db, r.project_id, auth, { fromRelease: true });
    return r;
  });
}

// ── Contentopdrachten ─────────────────────────────────────────────────────
export async function createPieceTx(db, { project = null, topic = null, audience, goal, assetIds, origin, originKey = null, automationId = null, format = null, planAfter = null, slotAt = null }, actor) {
  if (!AUDIENCES[audience]) throw new HttpError(400, "ongeldig", "Onbekende doelgroep.");
  if (!GOALS[goal]) throw new HttpError(400, "ongeldig", "Onbekend doel.");
  if (!project && !BRAND_TOPICS[topic]) throw new HttpError(400, "ongeldig", "Kies een onderwerp of een project.");
  // Eén aanmaak tegelijk per project (of voor StrakWerk zelf): gelijktijdige triggers wachten op elkaar.
  if (project) await db.query("select 1 from hq.projects where id=$1 for update", [project.id]);
  else await db.query("select pg_advisory_xact_lock(hashtext('hq_brand_piece'))");
  if (originKey) {
    const ex = (await db.query("select id from hq.content_pieces where origin_key=$1", [originKey])).rows[0];
    if (ex) return { id: ex.id, duplicate: true };
  }
  const n = (await db.query(project ? "select count(*)::int n from hq.content_pieces where project_id=$1" : "select count(*)::int n from hq.content_pieces where project_id is null and topic_key=$1", [project ? project.id : topic])).rows[0].n + 1;
  const code = (project ? `${project.slug}-${audience}-${n}` : `strakwerk-${topic}-${n}`).slice(0, 60);
  const keyword = project ? AUDIENCES[audience].keyword : BRAND_TOPICS[topic].keyword;
  const title = project ? `${project.name} voor ${AUDIENCES[audience].label.toLowerCase()}` : `StrakWerk: ${BRAND_TOPICS[topic].title}`;
  const id = randomUUID();
  const ins = await db.query(
    `insert into hq.content_pieces (id, project_id, format_key, audience, goal, asset_ids, origin, origin_key, campaign_code, keyword, automation_id, title, created_by, kind, topic_key, slot_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) on conflict (origin_key) do nothing returning id`,
    [id, project?.id || null, format || (project ? "project_reel" : "merk_reel"), audience, goal, assetIds, origin, originKey, code, keyword, automationId,
     title, actor?.userId || null, project ? "portfolio" : "merk", project ? null : topic, slotAt]);
  if (!ins.rowCount) return { id: (await db.query("select id from hq.content_pieces where origin_key=$1", [originKey])).rows[0].id, duplicate: true };
  const t = await enqueue(db, { agent: "content", kind: "content_plan", title: `Contentplan: ${title}`, input: { piece_id: id }, pieceId: id, leadId: project?.lead_id || null, createdBy: actor?.userId || null, idempotencyKey: `plan:${id}:1`, runAfter: planAfter });
  await db.query("update hq.content_pieces set plan_task_id=$2 where id=$1", [id, t.id]);
  await audit(db, { actor: actor?.userId || null, label: actor?.email || "systeem", action: "content.opdracht", entity: "piece", entityId: id, details: { origin } });
  return { id, duplicate: false, taskId: t.id };
}

export async function createPiece(body, auth, idem) {
  // Zonder klantproject: campagne voor StrakWerk zelf met eigen beelden.
  if (!body.project_id) {
    await ensurePortfolio();
    return tx(db => createPieceTx(db, { topic: String(body.topic || "prijs"), audience: String(body.audience || "ondernemers"), goal: String(body.goal || "aanvragen"), assetIds: [], origin: "handmatig",
      originKey: idem ? `handmatig:${auth.userId}:${idem}` : null }, auth));
  }
  const projectId = assertUuid(body.project_id, "project");
  return tx(async (db) => {
    const p = (await db.query("select * from hq.projects where id=$1", [projectId])).rows[0];
    if (!p) throw new HttpError(404, "niet_gevonden", "Project niet gevonden.");
    let ids = Array.isArray(body.asset_ids) ? body.asset_ids.filter(x => /^[0-9a-f-]{36}$/i.test(x)) : [];
    const ok = (await db.query("select id from hq.project_assets where project_id=$1 and social_ok and (valid_until is null or valid_until > now())", [projectId])).rows.map(r => r.id);
    ids = ids.length ? ids.filter(x => ok.includes(x)) : ok;
    if (ids.length < 3) throw new HttpError(409, "te_weinig_beelden", "Kies minimaal 3 beelden die zijn vrijgegeven voor social media (en niet verlopen).");
    return createPieceTx(db, { project: p, audience: String(body.audience || ""), goal: String(body.goal || "aanvragen"), assetIds: ids, origin: "handmatig", originKey: idem ? `handmatig:${auth.userId}:${idem}` : null }, auth);
  });
}

export async function pieceRow(db, id) {
  const p = (await db.query("select c.*, coalesce(pr.name, 'StrakWerk') as project_name, coalesce(pr.slug, 'strakwerk') as project_slug, pr.lead_id from hq.content_pieces c left join hq.projects pr on pr.id=c.project_id where c.id=$1 for update of c", [id])).rows[0];
  if (!p) throw new HttpError(404, "niet_gevonden", "Contentstuk niet gevonden.");
  return p;
}
export const scriptHash = (script) => stableHash({ scenes: script?.scenes || [] });

export async function chooseAngle(id, index, auth) {
  assertUuid(id);
  return tx(async (db) => {
    const p = await pieceRow(db, id);
    if (!Array.isArray(p.angles) || !p.angles[index]) throw new HttpError(400, "ongeldig", "Kies een van de voorgestelde hoeken.");
    if (!["kiezen", "concept"].includes(p.status)) throw new HttpError(409, "ongeldige_overgang", "De hoek kan nu niet meer worden gewijzigd.");
    return applyAngle(db, p, index, auth);
  });
}

export async function applyAngle(db, p, index, actor) {
  const a = p.angles[index];
  const script = { angle: a.key, name: a.name, opening: a.opening, cta: a.cta, scenes: a.scenes, captions: a.captions, cover_footer: `${p.project_name}` };
  await db.query("update hq.content_pieces set angle_index=$2, script=$3, script_original=$3, script_version=script_version+1, status='concept', updated_at=now() where id=$1", [p.id, index, script]);
  const r = await enqueueRender(db, { ...p, script }, actor);
  await audit(db, { actor: actor?.userId || null, label: actor?.email || "systeem", action: "content.hoek_gekozen", entity: "piece", entityId: p.id, details: { hoek: a.key } });
  return { ok: true, render: r };
}

export async function enqueueRender(db, piece, actor) {
  const script = piece.script;
  if (!script?.scenes?.length) throw new HttpError(409, "geen_script", "Er is nog geen script om te renderen.");
  const busy = (await db.query("select id from hq.renders where piece_id=$1 and status in ('in_wachtrij','bezig')", [piece.id])).rows[0];
  if (busy) return { id: busy.id, duplicate: true };
  const version = (await db.query("select coalesce(max(version),0)+1 as v from hq.renders where piece_id=$1", [piece.id])).rows[0].v;
  const id = randomUUID();
  await db.query("insert into hq.renders (id, piece_id, version, script, script_hash, created_by) values ($1,$2,$3,$4,$5,$6)", [id, piece.id, version, script, scriptHash(script), actor?.userId || null]);
  const t = await enqueue(db, { agent: "video", kind: "video_render", title: `Video renderen: ${piece.project_name || "contentstuk"} (v${version})`, input: { piece_id: piece.id, render_id: id },
    pieceId: piece.id, leadId: piece.lead_id || null, createdBy: actor?.userId || null, idempotencyKey: `render:${id}`, timeoutS: 900, maxAttempts: 2 });
  await db.query("update hq.renders set task_id=$2 where id=$1", [id, t.id]);
  return { id, version, taskId: t.id };
}

export async function rerender(id, auth) {
  assertUuid(id);
  return tx(async (db) => {
    const p = await pieceRow(db, id);
    if (p.status === "gearchiveerd") throw new HttpError(409, "gearchiveerd", "Dit stuk is gearchiveerd.");
    return enqueueRender(db, p, auth);
  });
}

function validateSceneEdit(scene, patch, allowedAssets, priceFrom) {
  const next = { ...scene };
  if ("text" in patch) { const t = str(patch.text, 140); if (!t) throw new HttpError(400, "ongeldig", "Scènetekst mag niet leeg zijn."); next.text = t; }
  if ("sub" in patch) { const s = str(patch.sub, 140); if (s) next.sub = s; else delete next.sub; }
  if ("kicker" in patch) { const k = str(patch.kicker, 60); if (k) next.kicker = k; else delete next.kicker; }
  if ("seconds" in patch) { const s = Number(patch.seconds); if (!(s >= 1.5 && s <= 6)) throw new HttpError(400, "ongeldig", "Duur moet tussen 1,5 en 6 seconden liggen."); next.seconds = Math.round(s * 10) / 10; }
  if ("asset" in patch) {
    if (!["shot", "phone", "hook"].includes(scene.type)) throw new HttpError(400, "ongeldig", "Deze scène heeft geen beeld.");
    if (patch.asset && !allowedAssets.includes(patch.asset)) throw new HttpError(409, "niet_vrijgegeven", "Dit beeld is niet vrijgegeven voor social media.");
    if (!patch.asset && scene.type !== "hook") throw new HttpError(400, "ongeldig", "Deze scène heeft een beeld nodig.");
    next.asset = patch.asset || undefined;
  }
  const problems = contentGuard(`${next.kicker || ""} ${next.text} ${next.sub || ""}`, { allowedPrices: priceFrom });
  if (problems.length) throw new HttpError(422, "afgekeurd", `Niet toegestaan: ${problems.join(", ")}.`);
  return next;
}

export async function editScene(id, sceneId, body, auth) {
  assertUuid(id);
  return tx(async (db) => {
    const p = await pieceRow(db, id);
    if (!p.script) throw new HttpError(409, "geen_script", "Kies eerst een hoek.");
    const idx = p.script.scenes.findIndex(s => s.id === sceneId);
    if (idx < 0) throw new HttpError(404, "niet_gevonden", "Scène niet gevonden.");
    const assets = (await db.query("select path from hq.project_assets where (project_id is not distinct from $1 or project_id is null) and social_ok", [p.project_id])).rows.map(r => r.path);
    const pr = await prices(db);
    let scene;
    if (body.reset) {
      scene = p.script_original?.scenes?.find(s => s.id === sceneId);
      if (!scene) throw new HttpError(404, "niet_gevonden", "Originele scène niet gevonden.");
    } else scene = validateSceneEdit(p.script.scenes[idx], body, assets, pr.all);
    const scenes = p.script.scenes.slice(); scenes[idx] = scene;
    const total = scenes.reduce((s, x) => s + Number(x.seconds), 0) - 0.5 * (scenes.length - 1);
    if (total < 14 || total > 26) throw new HttpError(422, "duur", `De video zou ${total.toFixed(1)} s duren; houd het tussen 15 en 25 s.`);
    const script = { ...p.script, scenes };
    // Na een wijziging is een eerdere goedkeuring niet meer geldig (andere video).
    await db.query("update hq.content_pieces set script=$2, script_version=script_version+1, status=case when status='goedgekeurd' then 'concept' else status end, approved_render_id=case when status='goedgekeurd' then null else approved_render_id end, updated_at=now() where id=$1", [id, script]);
    await audit(db, { actor: auth.userId, label: auth.email, action: "content.scene", entity: "piece", entityId: id, details: { scene: sceneId, reset: Boolean(body.reset) } });
    return { scene, dirty: true };
  });
}

export async function editCaption(id, channel, body, auth) {
  assertUuid(id);
  if (!CHANNELS[channel]) throw new HttpError(400, "ongeldig", "Onbekend kanaal.");
  return tx(async (db) => {
    const p = await pieceRow(db, id);
    if (!p.script) throw new HttpError(409, "geen_script", "Kies eerst een hoek.");
    let text;
    if (body.reset) text = p.script_original?.captions?.[channel];
    else {
      text = str(body.text, channel === "tiktok" ? 2200 : 2200);
      if (!text) throw new HttpError(400, "ongeldig", "Caption mag niet leeg zijn.");
      const problems = contentGuard(text, { allowedPrices: (await prices(db)).all });
      if (problems.length) throw new HttpError(422, "afgekeurd", `Niet toegestaan: ${problems.join(", ")}.`);
      if ((text.match(/#/g) || []).length > 30) throw new HttpError(422, "afgekeurd", "Maximaal 30 hashtags.");
    }
    const script = { ...p.script, captions: { ...p.script.captions, [channel]: text } };
    await db.query("update hq.content_pieces set script=$2, updated_at=now() where id=$1", [id, script]);
    // Nog niet geplaatste publicaties krijgen de nieuwe tekst.
    const cap = await captionFor(db, script, channel, null);
    await db.query("update hq.publications set caption=$3, caption_hash=$4, updated_at=now() where piece_id=$1 and channel=$2 and status in ('ingepland','export_klaar')", [id, channel, cap, sha(cap)]);
    await audit(db, { actor: auth.userId, label: auth.email, action: "content.caption", entity: "piece", entityId: id, details: { kanaal: channel } });
    return { caption: text };
  });
}

/** Caption zoals hij geplaatst wordt: met actieregel alleen zolang de actie loopt. */
export async function captionFor(db, script, channel, at) {
  let cap = script.captions?.[channel] || "";
  const promo = script.captions?.promo_line, until = script.captions?.promo_until;
  const when = at ? new Date(at) : new Date();
  if (promo && until && when < new Date(until) && !cap.includes(promo)) cap = cap.replace(/\n\n(#[^\n]*)$/, `\n\n${promo}\n\n$1`);
  return cap;
}

export async function approve(id, renderId, auth) {
  assertUuid(id); assertUuid(renderId, "render");
  return tx(async (db) => {
    const p = await pieceRow(db, id);
    const r = (await db.query("select * from hq.renders where id=$1 and piece_id=$2", [renderId, id])).rows[0];
    if (!r || r.status !== "klaar") throw new HttpError(409, "niet_klaar", "Deze video is nog niet klaar.");
    if (r.script_hash !== scriptHash(p.script)) throw new HttpError(409, "verouderd", "Het script is gewijzigd na deze render. Maak eerst een nieuwe video.");
    await db.query("update hq.content_pieces set status='goedgekeurd', approved_render_id=$2, approved_by=$3, approved_at=now(), updated_at=now() where id=$1", [id, renderId, auth?.userId || null]);
    await audit(db, { actor: auth?.userId || null, label: auth?.email || "systeem", action: "content.goedgekeurd", entity: "piece", entityId: id, details: { render: renderId } });
    return { ok: true };
  });
}

/** Inplannen per kanaal. Instagram via de officiële koppeling als die er is; anders export. */
export async function schedule(id, body, auth) {
  assertUuid(id);
  const channel = String(body.channel || "");
  if (!CHANNELS[channel]) throw new HttpError(400, "ongeldig", "Onbekend kanaal.");
  // at_local = "JJJJ-MM-DDTUU:MM" in Nederlandse tijd (Europe/Amsterdam), zoals de telefoon het invoert.
  const loc = typeof body.at_local === "string" && body.at_local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  const at = loc ? amsToUtc(+loc[1], +loc[2], +loc[3], +loc[4], +loc[5]) : body.at ? new Date(body.at) : null;
  if (at && Number.isNaN(at.getTime())) throw new HttpError(400, "ongeldig", "Ongeldig tijdstip.");
  // Eén actieve route per kanaal (instelling van het kantoor); zonder koppeling: export.
  let route = body.method === "export" ? { method: "export", route: "export" } : await routeFor(channel);
  if (body.method === "api" && channel === "instagram" && route.method !== "api") {
    const ig = await instagramState();
    if (ig.connected) route = { method: "api", route: "instagram_api" };
  }
  const method = route.method;
  const plan = await getPlan();
  return tx(async (db) => {
    const p = await pieceRow(db, id);
    // Automatisch publiceren (kanaal op "automatisch"): de render die het systeem net maakte.
    const renderId = !auth && body.system_render_id ? body.system_render_id : p.approved_render_id;
    if (!renderId || (auth && p.status !== "goedgekeurd")) throw new HttpError(409, "niet_goedgekeurd", "Keur eerst de video goed.");
    if (!auth && body.system_render_id) {
      const ok = (await db.query("select 1 from hq.renders where id=$1 and piece_id=$2 and status='klaar' and script_hash=$3", [renderId, id, scriptHash(p.script)])).rows[0];
      if (!ok) throw new HttpError(409, "verouderd", "Deze render hoort niet (meer) bij het script.");
    }
    if (!at && p.slot_at) body.at = p.slot_at;
    const when = at || (p.slot_at ? new Date(p.slot_at) : new Date());
    if (method !== "export") {
      if (!at) throw new HttpError(400, "ongeldig", "Kies een tijdstip.");
      if (at < new Date(Date.now() + 2 * 60_000)) throw new HttpError(400, "ongeldig", "Kies een tijdstip minstens 2 minuten in de toekomst.");
    }
    // Beelden die een verlopen actie van de klant tonen, mogen niet meer geplaatst worden.
    const render = (await db.query("select script from hq.renders where id=$1", [renderId])).rows[0];
    const paths = [...new Set(render.script.scenes.flatMap(s => [s.asset, s.asset2]).filter(Boolean))];
    const expired = (await db.query("select label, valid_until from hq.project_assets where (project_id is not distinct from $1 or project_id is null) and path = any($2::text[]) and (valid_until <= $3 or not social_ok)", [p.project_id, paths, when])).rows;
    if (expired.length) throw new HttpError(409, "beeld_verlopen", `Niet meer bruikbaar op dat moment: ${expired.map(e => e.label).join(", ")} (vrijgave ingetrokken of geldig tot ${expired.map(e => e.valid_until ? new Date(e.valid_until).toLocaleDateString("nl-NL") : "nu").join(", ")}). Kies een ander beeld of een eerdere datum.`);
    const caption = await captionFor(db, p.script, channel, when);
    const existing = (await db.query("select id, status from hq.publications where piece_id=$1 and channel=$2 and status<>'geannuleerd'", [id, channel])).rows[0];
    if (existing) throw new HttpError(409, "dubbel", `Er staat al een publicatie voor ${CHANNELS[channel]} (${PUB_LABEL[existing.status]}). Annuleer die eerst.`, { details: { id: existing.id } });
    const pubId = randomUUID();
    await db.query(`insert into hq.publications (id, piece_id, render_id, channel, method, status, scheduled_at, caption, caption_hash, created_by, live)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [pubId, id, renderId, channel, method, method === "export" ? "export_klaar" : "ingepland", when, caption, sha(caption), auth?.userId || null, Boolean(plan.live_publishing)]);
    if (method !== "export") {
      // Buffer: tot 24 uur vooraf aanleveren (daarna kan de tijd nog in HQ worden gewijzigd). Instagram API: op het moment zelf.
      const runAfter = method === "buffer" ? new Date(Math.max(Date.now(), when.getTime() - 24 * 3600e3)) : when;
      const t = await enqueue(db, { agent: "publisher", kind: "publish", title: `Plaatsen op ${CHANNELS[channel]}: ${p.project_name}`, input: { publication_id: pubId }, pieceId: id, leadId: p.lead_id,
        createdBy: auth?.userId || null, idempotencyKey: `pub:${pubId}:1`, runAfter, timeoutS: 45, maxAttempts: 3 });
      await db.query("update hq.publications set task_id=$2 where id=$1", [pubId, t.id]);
    }
    await audit(db, { actor: auth?.userId || null, label: auth?.email || "systeem", action: "content.ingepland", entity: "publication", entityId: pubId, details: { kanaal: channel, methode: method, tijdstip: when } });
    return { id: pubId, method, status: method === "export" ? "export_klaar" : "ingepland", reason: route.reason };
  });
}

export async function publicationAction(pubId, action, body, auth) {
  assertUuid(pubId);
  return tx(async (db) => {
    const pub = (await db.query("select * from hq.publications where id=$1 for update", [pubId])).rows[0];
    if (!pub) throw new HttpError(404, "niet_gevonden", "Publicatie niet gevonden.");
    const done = async (status, extra = {}) => {
      await db.query("update hq.publications set status=$2, permalink=coalesce($3, permalink), published_at=coalesce($4, published_at), updated_at=now() where id=$1", [pubId, status, extra.permalink || null, extra.published_at || null]);
      await audit(db, { actor: auth.userId, label: auth.email, action: `publicatie.${action}`, entity: "publication", entityId: pubId });
      return { status };
    };
    if (action === "annuleren") {
      if (!["ingepland", "export_klaar", "mislukt"].includes(pub.status)) throw new HttpError(409, "ongeldige_overgang", pub.status === "onzeker" || pub.status === "bezig" ? "Deze publicatie wordt nog gecontroleerd; annuleren kan pas daarna." : "Deze publicatie kan niet meer worden geannuleerd.");
      if (pub.external_container_id && pub.status === "mislukt") { /* container blijft ongebruikt bij Instagram en verloopt vanzelf */ }
      if (pub.task_id) await db.query("update hq.tasks set status='geannuleerd', control=null, finished_at=now(), updated_at=now() where id=$1 and status in ('in_wachtrij','gepauzeerd','mislukt')", [pub.task_id]);
      return done("geannuleerd");
    }
    if (action === "zelf_geplaatst") {
      if (!["export_klaar", "mislukt", "ingepland"].includes(pub.status)) throw new HttpError(409, "ongeldige_overgang", "Deze publicatie is al geplaatst of wordt gecontroleerd.");
      if (pub.task_id) await db.query("update hq.tasks set status='geannuleerd', finished_at=now(), updated_at=now() where id=$1 and status in ('in_wachtrij','gepauzeerd','mislukt')", [pub.task_id]);
      const url = str(body.permalink, 300);
      if (url && !/^https:\/\/(www\.)?(instagram\.com|tiktok\.com|vm\.tiktok\.com)\//.test(url)) throw new HttpError(400, "ongeldig", "Plak een link naar Instagram of TikTok.");
      return done("handmatig_geplaatst", { permalink: url, published_at: new Date() });
    }
    if (action === "opnieuw") {
      if (pub.status !== "mislukt") throw new HttpError(409, "ongeldige_overgang", "Alleen een mislukte publicatie kan opnieuw.");
      if (pub.method !== "api") throw new HttpError(409, "ongeldige_overgang", "Dit kanaal wordt handmatig geplaatst.");
      // Altijd eerst de vorige poging controleren (publisher kijkt naar container en recente posts).
      const n = (await db.query("select count(*)::int n from hq.tasks where idempotency_key like $1", [`pub:${pubId}:%`])).rows[0].n + 1;
      const t = await enqueue(db, { agent: "publisher", kind: "publish", title: "Opnieuw plaatsen (eerst controleren)", input: { publication_id: pubId }, pieceId: pub.piece_id, createdBy: auth.userId, idempotencyKey: `pub:${pubId}:${n}`, timeoutS: 45, maxAttempts: 3 });
      await db.query("update hq.publications set status='ingepland', task_id=$2, last_error=null, scheduled_at=least(coalesce(scheduled_at, now()), now()), updated_at=now() where id=$1", [pubId, t.id]);
      await audit(db, { actor: auth.userId, label: auth.email, action: "publicatie.opnieuw", entity: "publication", entityId: pubId });
      return { status: "ingepland", taskId: t.id };
    }
    throw new HttpError(400, "ongeldig", "Onbekende actie.");
  });
}

// ── Werkvoorraad ──────────────────────────────────────────────────────────
function column(p) {
  const r = p.render, pubs = p.publications.filter(x => x.status !== "geannuleerd");
  const dirty = p.script && (!r || r.script_hash !== p.current_hash);
  const act = [];
  if (p.plan_status === "mislukt") act.push({ code: "plan_mislukt", text: `Plan mislukt: ${p.plan_error || "onbekende fout"}`, action: "plan_opnieuw" });
  if (p.plan_status === "gepauzeerd" && p.plan_pause === "budget") act.push({ code: "ai_budget", text: `Wacht op AI-budget: ${p.plan_error || "AI-taken staan op pauze"}. Pas je HQ-limiet of tegoedperiode aan.`, action: "budget" });
  if (r?.status === "in_wachtrij" && Date.now() - new Date(r.created_at) > 45 * 60_000) act.push({ code: "render_wacht", text: "Render wacht al lang op rendercapaciteit. Start de render-worker op je computer (npm run render-worker) of wacht op GitHub Actions.", action: "render_wacht" });
  if (p.status === "kiezen") act.push({ code: "kiezen", text: "Kies een van de drie hoeken.", action: "kiezen" });
  if (r?.status === "mislukt") act.push({ code: "render_mislukt", text: `Render mislukt: ${r.error || "onbekende fout"}`, action: "render_opnieuw" });
  if (p.status === "concept" && r?.status === "klaar" && dirty) act.push({ code: "script_gewijzigd", text: "Script gewijzigd sinds de laatste video. Maak een nieuwe versie.", action: "render_opnieuw" });
  for (const x of pubs) {
    if (x.status === "mislukt") act.push({ code: "publicatie_mislukt", text: `${CHANNELS[x.channel]}: ${x.last_error || "plaatsen mislukt"}`, action: "publicatie", id: x.id });
    if (x.status === "onzeker") act.push({ code: "publicatie_onzeker", text: `${CHANNELS[x.channel]}: uitkomst onduidelijk; HQ controleert eerst de eerdere poging.`, action: "wachten", id: x.id });
    if (x.status === "export_klaar") act.push({ code: "zelf_plaatsen", text: `${CHANNELS[x.channel]}: download de video en plaats hem zelf${x.scheduled_at ? ` (gepland ${new Date(x.scheduled_at).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "short", timeStyle: "short" })})` : ""}.`, action: "export", id: x.id });
  }
  if (p.blocked_assets?.length) act.push({ code: "beeld_verlopen", text: `Beeld niet meer bruikbaar: ${p.blocked_assets.join(", ")}.`, action: "scene" });
  let col;
  if (act.some(a => !["wachten"].includes(a.action))) col = "actie_nodig";
  else if (r && ["in_wachtrij", "bezig"].includes(r.status) || p.status === "plannen") col = p.status === "plannen" ? "concept" : "render_bezig";
  else if (r?.status === "klaar" && !dirty && p.status === "concept") col = "klaar_voor_review";
  else if (pubs.length && pubs.every(x => ["gepubliceerd", "handmatig_geplaatst"].includes(x.status))) col = "gepubliceerd";
  else if (p.status === "concept" && r?.status === "klaar" && !dirty) col = "klaar_voor_review";
  else if (pubs.some(x => ["ingepland", "bezig", "onzeker", "bij_dienst", "wachtrij_vol", "concept_klaar"].includes(x.status))) col = "ingepland";
  else if (p.status === "goedgekeurd") { col = "klaar_voor_review"; act.push({ code: "inplannen", text: "Goedgekeurd: plan Instagram en/of TikTok in.", action: "inplannen" }); }
  else col = "concept";
  if (p.status === "concept" && r?.status === "klaar" && !dirty) {
    act.push({ code: "review", text: "Bekijk de video en keur hem goed.", action: "review" });
    if (col === "concept") col = "klaar_voor_review";
  }
  if (col === "concept" && p.status === "plannen") act.push({ code: "plannen", text: "De planner werkt aan drie voorstellen.", action: "wachten" });
  return { column: col, actions: act, render_dirty: Boolean(dirty) };
}

async function piecesWithState(where = "c.status<>'gearchiveerd'", vals = []) {
  const rows = (await q(`select c.*, coalesce(pr.name, 'StrakWerk') as project_name, coalesce(pr.slug, 'strakwerk') as project_slug,
      t.status as plan_status, t.error as plan_error, t.cost_usd::float as plan_cost, t.pause_reason as plan_pause
    from hq.content_pieces c left join hq.projects pr on pr.id=c.project_id left join hq.tasks t on t.id=c.plan_task_id
    where ${where} order by c.updated_at desc limit 200`, vals)).rows;
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [renders, pubs, assets] = await Promise.all([
    q(`select distinct on (piece_id) r.id, r.piece_id, r.version, r.status, r.script_hash, r.error, r.duration_s::float as duration_s, r.bytes, r.render_ms, r.video_key, r.cover_key, r.created_at, r.finished_at,
         t.status as task_status, t.attempts, t.max_attempts
       from hq.renders r left join hq.tasks t on t.id=r.task_id where r.piece_id = any($1::uuid[]) order by piece_id, version desc`, [ids]),
    q("select id, piece_id, channel, method, status, scheduled_at, published_at, permalink, last_error, external_id, caption from hq.publications where piece_id = any($1::uuid[]) order by created_at", [ids]),
    q(`select c.id as piece_id, a.label from hq.content_pieces c join hq.project_assets a on a.project_id is not distinct from c.project_id
       where c.id = any($1::uuid[]) and c.script is not null and a.path in (select jsonb_array_elements(c.script->'scenes')->>'asset' union select jsonb_array_elements(c.script->'scenes')->>'asset2')
         and (not a.social_ok or a.valid_until <= now()) and not exists (select 1 from hq.publications p where p.piece_id=c.id and p.status in ('gepubliceerd','handmatig_geplaatst'))`, [ids]),
  ]);
  return rows.map(r => {
    const p = { ...r, render: renders.rows.find(x => x.piece_id === r.id) || null, publications: pubs.rows.filter(x => x.piece_id === r.id),
      current_hash: r.script ? scriptHash(r.script) : null, blocked_assets: assets.rows.filter(x => x.piece_id === r.id).map(x => x.label) };
    return { ...p, ...column(p) };
  });
}

export async function workqueue() {
  await ensurePortfolio();
  const pieces = await piecesWithState();
  const counts = Object.fromEntries(Object.keys(COLUMNS).map(k => [k, pieces.filter(p => p.column === k).length]));
  return { pieces: pieces.map(slim), counts, columns: COLUMNS };
}
const slim = (p) => ({ id: p.id, title: p.title, project_name: p.project_name, audience: p.audience, goal: p.goal, origin: p.origin, status: p.status, column: p.column, actions: p.actions,
  render: p.render && { id: p.render.id, version: p.render.version, status: p.render.status, error: p.render.error, duration_s: p.render.duration_s, attempts: p.render.attempts, has_cover: Boolean(p.render.cover_key) },
  publications: p.publications, updated_at: p.updated_at, campaign_code: p.campaign_code });

export async function pieceDetail(id) {
  assertUuid(id);
  const [p] = await piecesWithState("c.id=$1", [id]);
  if (!p) throw new HttpError(404, "niet_gevonden", "Contentstuk niet gevonden.");
  const [renders, assets, tasks, cost] = await Promise.all([
    q("select id, version, status, error, duration_s::float as duration_s, width, height, bytes, render_ms, created_at, finished_at, script_hash, (video_key is not null) as has_video from hq.renders where piece_id=$1 order by version desc", [id]),
    q("select id, path, kind, label, social_ok, valid_until, notes, width, height from hq.project_assets where project_id is not distinct from $1 or project_id is null order by (project_id is null), kind, created_at", [p.project_id]),
    q("select id, agent_key, title, status, error, attempts, max_attempts, created_at, finished_at, cost_usd::float as cost_usd from hq.tasks where piece_id=$1 order by created_at desc limit 30", [id]),
    pieceCost(id),
  ]);
  const settings = await contentSettings();
  const plan = await getPlan();
  const routes = { instagram: await routeFor("instagram", plan), tiktok: await routeFor("tiktok", plan) };
  return { office: { plan }, routes, routeLabels: { export: "Export (zelf plaatsen)", buffer: "Buffer (gratis plan)", instagram_api: "Instagram API", api: "Instagram API" }, brand: await getBrand(),
    piece: { ...p, script_hash: p.current_hash }, renders: renders.rows, assets: assets.rows.map(a => ({ ...a, hint: assetInfo(a.path).hint || "" })), tasks: tasks.rows, cost, settings,
    audiences: AUDIENCES, channels: CHANNELS, pubLabels: PUB_LABEL, instagram: await instagramState(), links: campaignLinks(p) };
}

export function campaignLinks(p) {
  const base = `https://www.${SITE.site}/`;
  return {
    instagram: `${base}?utm_source=instagram&utm_medium=social&utm_campaign=${encodeURIComponent(p.campaign_code)}`,
    tiktok: `${base}?utm_source=tiktok&utm_medium=social&utm_campaign=${encodeURIComponent(p.campaign_code)}`,
    whatsapp: SITE.whatsapp ? `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(p.keyword || "")}` : null,
    keyword: p.keyword,
  };
}

/** Kosten per video: gemeten taalmodelkosten + rendertijd × ingesteld tarief. */
export async function pieceCost(id) {
  const s = await contentSettings();
  const r = await one(`select coalesce(sum(t.cost_usd),0)::float as llm,
      coalesce((select sum(render_ms) from hq.renders where piece_id=$1 and status='klaar'),0)::float as render_ms
    from hq.tasks t where t.piece_id=$1`, [id]);
  const renderUsd = (r.render_ms / 60000) * (Number(s.render_cost_usd_per_min) || 0);
  return { llm_usd: r.llm, render_minutes: Math.round(r.render_ms / 600) / 100, render_usd: renderUsd, total_usd: r.llm + renderUsd, rate_usd_per_min: s.render_cost_usd_per_min };
}

export async function archivePiece(id, auth) {
  assertUuid(id);
  return tx(async (db) => {
    const p = await pieceRow(db, id);
    const live = (await db.query("select 1 from hq.publications where piece_id=$1 and status in ('ingepland','bezig','onzeker')", [id])).rows[0];
    if (live) throw new HttpError(409, "ingepland", "Annuleer eerst de geplande publicaties.");
    await db.query("update hq.content_pieces set status='gearchiveerd', updated_at=now() where id=$1", [p.id]);
    await db.query("update hq.tasks set status='geannuleerd', finished_at=now() where piece_id=$1 and status in ('in_wachtrij','gepauzeerd')", [p.id]);
    await audit(db, { actor: auth.userId, label: auth.email, action: "content.gearchiveerd", entity: "piece", entityId: id });
    return { ok: true };
  });
}

export async function replan(id, auth) {
  assertUuid(id);
  return tx(async (db) => {
    const p = await pieceRow(db, id);
    if (!["plannen", "kiezen"].includes(p.status)) throw new HttpError(409, "ongeldige_overgang", "Het plan is al gekozen; pas losse scènes aan.");
    const n = (await db.query("select count(*)::int n from hq.tasks where piece_id=$1 and kind='content_plan'", [id])).rows[0].n + 1;
    const t = await enqueue(db, { agent: "content", kind: "content_plan", title: `Contentplan opnieuw: ${p.project_name}`, input: { piece_id: id }, pieceId: id, createdBy: auth.userId, idempotencyKey: `plan:${id}:${n}` });
    await db.query("update hq.content_pieces set plan_task_id=$2, status='plannen', updated_at=now() where id=$1", [id, t.id]);
    return { taskId: t.id };
  });
}

// ── Kalender (Europe/Amsterdam) ─────────────────────────────────────────────
export async function calendar(fromIso, days = 28) {
  const from = fromIso && !Number.isNaN(Date.parse(fromIso)) ? new Date(fromIso) : new Date(Date.now() - 7 * 864e5);
  const to = new Date(from.getTime() + Math.min(Number(days) || 28, 92) * 864e5);
  const pubs = (await q(`select p.id, p.channel, p.method, p.status, p.scheduled_at, p.published_at, p.permalink, c.id as piece_id, c.title, pr.name as project_name
      from hq.publications p join hq.content_pieces c on c.id=p.piece_id join hq.projects pr on pr.id=c.project_id
      where p.status<>'geannuleerd' and coalesce(p.scheduled_at, p.published_at, p.created_at) between $1 and $2 order by coalesce(p.scheduled_at, p.published_at, p.created_at)`, [from, to])).rows;
  const slots = await automationSlots(from, to);
  return { from, to, tz: "Europe/Amsterdam", publications: pubs, slots, labels: PUB_LABEL, channels: CHANNELS };
}

// Datum/tijd in Europe/Amsterdam ↔ UTC zonder externe bibliotheek.
export function amsParts(d) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
  const o = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour, mm: +o.minute, wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(o.weekday) + 1 };
}
export function amsToUtc(y, m, d, hh, mm) {
  // Startgok in UTC, corrigeer met de werkelijke Amsterdamse tijd (werkt ook rond zomer-/wintertijd).
  let t = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 3; i++) {
    const p = amsParts(new Date(t));
    const diff = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - Date.UTC(y, m - 1, d, hh, mm);
    if (!diff) break;
    t -= diff;
  }
  return new Date(t);
}
export function isoWeekKey(d) {
  const p = amsParts(d);
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const day = p.wd;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return `${dt.getUTCFullYear()}-W${String(Math.ceil(((dt - y0) / 864e5 + 1) / 7)).padStart(2, "0")}`;
}

async function automationSlots(from, to) {
  const rules = (await q("select * from hq.content_automations where enabled")).rows;
  const s = await contentSettings();
  const out = [];
  for (const r of rules) {
    const [hh, mm] = r.post_time.split(":").map(Number);
    for (let t = from.getTime(); t < to.getTime(); t += 864e5) {
      const p = amsParts(new Date(t));
      if (!r.weekdays.includes(p.wd)) continue;
      out.push({ rule_id: r.id, channel: r.channel, format_key: r.format_key, at: amsToUtc(p.y, p.m, p.d, hh, mm), paused: Boolean(s.paused) });
    }
  }
  return out;
}

// ── Automatisering ────────────────────────────────────────────────────────
export async function automationOverview() {
  const [rules, formats, settings, spent] = await Promise.all([
    q("select * from hq.content_automations order by channel, format_key"),
    q("select * from hq.content_formats order by sort"),
    contentSettings(), monthSpend(),
  ]);
  return { rules: rules.rows, formats: formats.rows, settings, spent_month_usd: spent, instagram: await instagramState() };
}

export async function monthSpend(db) {
  const r = (await (db || { query: q }).query(`select coalesce(sum(t.cost_usd),0)::float as llm,
      coalesce((select sum(render_ms) from hq.renders where status='klaar' and finished_at >= date_trunc('month', now() at time zone 'Europe/Amsterdam') at time zone 'Europe/Amsterdam'),0)::float as render_ms
    from hq.tasks t where t.piece_id is not null and t.created_at >= date_trunc('month', now() at time zone 'Europe/Amsterdam') at time zone 'Europe/Amsterdam'`)).rows[0];
  const s = await contentSettings(db);
  return Math.round((r.llm + (r.render_ms / 60000) * (Number(s.render_cost_usd_per_min) || 0)) * 10000) / 10000;
}

export async function putContentSettings(body, auth) {
  const cur = await contentSettings();
  const next = { ...cur };
  if ("paused" in body) next.paused = Boolean(body.paused);
  const nums = { monthly_budget_usd: [0, 100], max_cost_per_video_usd: [0, 10], render_cost_usd_per_min: [0, 1], min_hours_ahead: [1, 168] };
  for (const [k, [lo, hi]] of Object.entries(nums)) if (k in body) {
    const v = Number(body[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new HttpError(400, "ongeldig", `${k} moet tussen ${lo} en ${hi} liggen.`);
    next[k] = Math.round(v * 1000) / 1000;
  }
  await q("insert into hq.settings (key, value, updated_by, updated_at) values ('content',$1,$2,now()) on conflict (key) do update set value=excluded.value, updated_by=excluded.updated_by, updated_at=now()", [next, auth.userId]);
  await audit(null, { actor: auth.userId, label: auth.email, action: next.paused !== cur.paused ? (next.paused ? "content.pauze" : "content.hervat") : "content.instellingen", details: { van: cur, naar: next } });
  return next;
}

export async function putFormat(key, body, auth) {
  const f = await one("select * from hq.content_formats where key=$1", [key]);
  if (!f) throw new HttpError(404, "niet_gevonden", "Format niet gevonden.");
  const rel = Boolean(body.released);
  const r = await one("update hq.content_formats set released=$2, released_by=$3, released_at=case when $2 then now() else null end where key=$1 returning *", [key, rel, rel ? auth.userId : null]);
  await audit(null, { actor: auth.userId, label: auth.email, action: rel ? "format.vrijgegeven" : "format.ingetrokken", entity: "format", entityId: key });
  return r;
}

export async function putAutomation(body, auth) {
  const channel = String(body.channel || ""), format = String(body.format_key || "");
  if (!CHANNELS[channel]) throw new HttpError(400, "ongeldig", "Onbekend kanaal.");
  if (!(await one("select 1 from hq.content_formats where key=$1", [format]))) throw new HttpError(400, "ongeldig", "Onbekend format.");
  const wl = Number(body.weekly_limit ?? 1);
  if (!(wl >= 0 && wl <= 7)) throw new HttpError(400, "ongeldig", "Weeklimiet moet tussen 0 en 7 liggen.");
  const days = (Array.isArray(body.weekdays) ? body.weekdays : [2, 4]).map(Number).filter(d => d >= 1 && d <= 7);
  const time = /^[0-2]\d:[0-5]\d$/.test(body.post_time || "") ? body.post_time : "18:30";
  const aud = AUDIENCES[body.audience] ? body.audience : "ondernemers";
  const r = await one(`insert into hq.content_automations (channel, format_key, enabled, weekly_limit, weekdays, post_time, audience, goal, updated_by, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) on conflict (channel, format_key) do update set enabled=excluded.enabled, weekly_limit=excluded.weekly_limit,
      weekdays=excluded.weekdays, post_time=excluded.post_time, audience=excluded.audience, goal=excluded.goal, updated_by=excluded.updated_by, updated_at=now() returning *`,
    [channel, format, Boolean(body.enabled), Math.round(wl), [...new Set(days)].sort(), time, aud, GOALS[body.goal] ? body.goal : "aanvragen", auth.userId]);
  await audit(null, { actor: auth.userId, label: auth.email, action: "automatisering.gewijzigd", entity: "automation", entityId: r.id, details: { aan: r.enabled, weeklimiet: r.weekly_limit } });
  return r;
}

/**
 * Eén ronde automatisering (cron/worker). Maakt binnen de weeklimiet nieuwe afleveringen
 * voor vrijgegeven formats met vrijgegeven projectmateriaal. Idempotent per week en slot.
 */
export async function automationTick(now = new Date()) {
  const s = await contentSettings();
  if (s.paused) return { skipped: "gepauzeerd" };
  if ((await monthSpend()) >= s.monthly_budget_usd) return { skipped: "kostenplafond" };
  const rules = (await q("select a.* from hq.content_automations a join hq.content_formats f on f.key=a.format_key where a.enabled and f.released and a.weekly_limit > 0")).rows;
  const made = [];
  for (const r of rules) {
    const week = isoWeekKey(now);
    const used = (await one("select count(*)::int n from hq.content_pieces where automation_id=$1 and origin_key like $2", [r.id, `auto:${r.id}:${week}:%`])).n;
    if (used >= r.weekly_limit) continue;
    // Project met genoeg vrijgegeven, geldige beelden en de langste tijd zonder video.
    const proj = await one(`select p.* from hq.projects p
        where p.status in ('opgeleverd','nazorg') and (select count(*) from hq.project_assets a where a.project_id=p.id and a.social_ok and (a.valid_until is null or a.valid_until > now() + interval '14 days')) >= 3
        order by (select max(created_at) from hq.content_pieces c where c.project_id=p.id) nulls first, p.updated_at limit 1`);
    if (!proj) { made.push({ rule: r.id, skipped: "geen_project_met_vrijgegeven_beelden" }); continue; }
    const out = await tx(db => createPieceTx(db, { project: proj, audience: r.audience, goal: r.goal, assetIds: [], origin: "automatisering", originKey: `auto:${r.id}:${week}:${used + 1}`, automationId: r.id, format: r.format_key }, null));
    made.push({ rule: r.id, piece: out.id, duplicate: out.duplicate });
  }
  return { made };
}

/** Volgende vrije slot voor een automatische aflevering (minstens min_hours_ahead vooruit). */
export async function nextSlot(db, rule, minHours) {
  const [hh, mm] = rule.post_time.split(":").map(Number);
  const taken = (await db.query("select scheduled_at from hq.publications where channel=$1 and status<>'geannuleerd' and scheduled_at > now()", [rule.channel])).rows.map(r => +new Date(r.scheduled_at));
  const start = Date.now() + minHours * 3600e3;
  for (let i = 0; i < 60; i++) {
    const p = amsParts(new Date(start + i * 864e5));
    if (!rule.weekdays.includes(p.wd)) continue;
    const at = amsToUtc(p.y, p.m, p.d, hh, mm);
    if (+at < start) continue;
    if (taken.some(t => Math.abs(t - at) < 6 * 3600e3)) continue;
    return at;
  }
  return null;
}

/** Na een geslaagde render van een automatische aflevering: goedkeuren en inplannen. */
export async function onAutoRendered(pieceId, renderId) {
  const p = await one("select c.*, a.channel, a.weekdays, a.post_time from hq.content_pieces c join hq.content_automations a on a.id=c.automation_id where c.id=$1 and c.origin='automatisering'", [pieceId]);
  if (!p) return null;
  const s = await contentSettings();
  if (s.paused) return { skipped: "gepauzeerd" };
  await approve(pieceId, renderId, null);
  const at = await tx(db => nextSlot(db, p, s.min_hours_ahead));
  if (!at) return { skipped: "geen_slot" };
  return schedule(pieceId, { channel: p.channel, at: at.toISOString() }, null);
}

// ── Resultaten en weekvoorstel ───────────────────────────────────────────────
export async function insights() {
  const pieces = (await q(`select c.id, c.title, c.campaign_code, c.keyword, c.audience, c.created_at, (c.script->>'angle') as angle, pr.name as project_name
    from hq.content_pieces c join hq.projects pr on pr.id=c.project_id where c.status<>'gearchiveerd' order by c.created_at desc limit 50`)).rows;
  if (!pieces.length) return { pieces: [], suggestion: suggestion([]) };
  const ids = pieces.map(p => p.id), codes = pieces.map(p => p.campaign_code);
  const [views, clicks, leads, won, pubs] = await Promise.all([
    q(`select p.piece_id, m.metric, max(m.value)::int as value from hq.content_metrics m join hq.publications p on p.id=m.publication_id where p.piece_id = any($1::uuid[]) group by 1, 2`, [ids]),
    q(`select utm_campaign, count(*)::int n from hq.analytics_events where env='production' and utm_campaign = any($1::text[]) and name='page_view' group by 1`, [codes]),
    q("select campaign_piece_id, count(*)::int n from hq.leads where campaign_piece_id = any($1::uuid[]) group by 1", [ids]),
    q("select l.campaign_piece_id, count(*)::int n, coalesce(sum(qq.price_cents),0)::int cents from hq.quotes qq join hq.leads l on l.id=qq.lead_id where qq.status='geaccepteerd' and l.campaign_piece_id = any($1::uuid[]) group by 1", [ids]),
    q("select piece_id, count(*) filter (where status in ('gepubliceerd','handmatig_geplaatst'))::int as live from hq.publications where piece_id = any($1::uuid[]) group by 1", [ids]),
  ]);
  const rows = pieces.map(p => {
    const v = views.rows.filter(x => x.piece_id === p.id);
    const live = pubs.rows.find(x => x.piece_id === p.id)?.live || 0;
    return { ...p, live,
      views: v.find(x => x.metric === "views")?.value ?? null,              // null = onbekend
      clicks: live ? (clicks.rows.find(x => x.utm_campaign === p.campaign_code)?.n ?? 0) : null,
      requests: live ? (leads.rows.find(x => x.campaign_piece_id === p.id)?.n ?? 0) : null,
      accepted: live ? (won.rows.find(x => x.campaign_piece_id === p.id)?.n ?? 0) : null,
      accepted_cents: live ? (won.rows.find(x => x.campaign_piece_id === p.id)?.cents ?? 0) : null };
  });
  return { pieces: rows, suggestion: suggestion(rows), note: "Views komen alleen uit de Instagram-koppeling of handmatige invoer. Klikken = bezoeken met de campagnelink. Aanvragen = leads die aan deze video zijn gekoppeld. Een klik is geen aanvraag." };
}

export function suggestion(rows) {
  const live = rows.filter(r => r.live);
  const angleName = { pijnpunt: "Van DM naar aanvraag", prijzen: "Prijzen vooraf zichtbaar", rondleiding: "Rondleiding door het project" };
  if (!live.length) return { text: "Nog geen geplaatste video's met resultaten. Plaats eerst de eerste video en koppel binnengekomen aanvragen aan de campagne.", basis: "geen gegevens" };
  const score = (r) => [r.accepted ?? -1, r.requests ?? -1, r.clicks ?? -1, r.views ?? -1];
  const best = live.slice().sort((a, b) => { const x = score(a), y = score(b); for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; })[0];
  const basis = best.accepted ? `${best.accepted} geaccepteerde offerte(s)` : best.requests ? `${best.requests} gekoppelde aanvraag/aanvragen` : best.clicks ? `${best.clicks} bezoek(en) via de campagnelink` : best.views != null ? `${best.views} views` : null;
  if (!basis) return { text: `Er zijn nog geen meetbare resultaten. Probeer volgende week een andere hoek dan "${angleName[best.angle] || best.angle}" voor dezelfde doelgroep, zodat je twee hoeken kunt vergelijken.`, basis: "geen resultaten (onbekend ≠ nul)" };
  const other = Object.keys(angleName).find(k => k !== best.angle);
  return { text: `Maak een nieuwe aflevering met de hoek "${angleName[best.angle] || best.angle}" voor ${AUDIENCES[best.audience]?.label.toLowerCase() || best.audience}, met een ander project. Test daarnaast één keer "${angleName[other]}".`, basis: `Beste resultaat: "${best.title}" met ${basis}. Weinig gegevens: behandel dit als richting, niet als bewijs.` };
}

export async function addMetric(pubId, body, auth) {
  assertUuid(pubId);
  const metric = String(body.metric || "");
  const v = Number(body.value);
  if (!["views", "reach", "likes", "comments", "shares", "saves"].includes(metric)) throw new HttpError(400, "ongeldig", "Onbekende meting.");
  if (!Number.isInteger(v) || v < 0) throw new HttpError(400, "ongeldig", "Vul een geheel getal in.");
  await q(`insert into hq.content_metrics (publication_id, metric, value, source, measured_at) values ($1,$2,$3,'handmatig',now())
    on conflict (publication_id, metric, source) do update set value=excluded.value, measured_at=now()`, [pubId, metric, v]);
  await audit(null, { actor: auth.userId, label: auth.email, action: "resultaat.ingevoerd", entity: "publication", entityId: pubId, details: { metric, v } });
  return { ok: true };
}

/** Lead aan een campagne koppelen (link, WhatsApp-zoekwoord of handmatig). */
export async function linkLead(leadId, body, auth) {
  assertUuid(leadId, "lead");
  let pieceId = body.piece_id ? assertUuid(body.piece_id, "contentstuk") : null;
  let via = ["link", "whatsapp_woord", "handmatig"].includes(body.via) ? body.via : "handmatig";
  if (!pieceId && body.keyword) {
    const kw = String(body.keyword).trim().toUpperCase().slice(0, 30);
    const p = await one("select c.id from hq.content_pieces c where upper(c.keyword)=$1 and exists (select 1 from hq.publications p where p.piece_id=c.id and p.status in ('gepubliceerd','handmatig_geplaatst')) order by c.created_at desc limit 1", [kw]);
    if (!p) throw new HttpError(404, "niet_gevonden", `Geen geplaatste video met zoekwoord ${kw}.`);
    pieceId = p.id; via = "whatsapp_woord";
  }
  const r = await one("update hq.leads set campaign_piece_id=$2, campaign_via=$3, updated_at=now() where id=$1 returning id", [leadId, pieceId, pieceId ? via : null]);
  if (!r) throw new HttpError(404, "niet_gevonden", "Lead niet gevonden.");
  await audit(null, { actor: auth.userId, label: auth.email, action: "lead.campagne", entity: "lead", entityId: leadId, details: { piece: pieceId, via } });
  return { ok: true, piece_id: pieceId, via };
}

export { hasRole, sha, event };
