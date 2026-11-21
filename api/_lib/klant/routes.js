// Routes voor "klanten winnen" onder /api/hq/: vandaag, opdracht, klanten, offertes,
// afspraken, kantoor (overleg, acties, scorekaarten, routes, fouten, experimenten),
// scout, partners, bewijs, projecten en resultaten. Rechten worden per route gecontroleerd.
import { q, one, tx, audit } from "../db.js";
import { json, route, HttpError, assertUuid, str } from "../http.js";
import { assertPerm } from "../auth.js";
import { enqueue } from "../queue.js";
import * as sales from "./sales.js";
import * as contact from "./contact.js";
import * as acq from "./acquisition.js";
import * as plan from "./planning.js";
import * as proj from "./project.js";
import { runCommand } from "./command.js";
import { budgetOverview } from "../budget.js";
import { mailConfigured } from "./mail.js";

const PREFIXES = ["vandaag", "opdracht", "klanten", "offertes", "outreach", "agenda", "kantoor", "acties", "fouten", "scout", "segmenten", "experimenten", "promptversies", "partners", "bewijs", "projecten", "resultaten", "voorstellen", "observaties"];
export const isKlantPath = (path) => PREFIXES.some(p => path === p || path.startsWith(`${p}/`));

async function putSetting(key, value, auth) {
  await q("insert into hq.settings (key, value, updated_by, updated_at) values ($1,$2,$3,now()) on conflict (key) do update set value=excluded.value, updated_by=excluded.updated_by, updated_at=now()", [key, value, auth.userId]);
  await audit(null, { actor: auth.userId, label: auth.email, action: `instelling.${key}`, details: value });
}
const getSetting = async (key) => (await one("select value from hq.settings where key=$1", [key]))?.value || {};

/** Startscherm (mobiel): wat vraagt nu aandacht, en welke keuzes liggen bij Rayan. */
export async function today(env = "productie") {
  const T = env === "test";
  const [requests, quotes, projects, decisions, briefing, actions, manual] = await Promise.all([
    q(`select id, company, need_summary, awaiting_reply_since, priority, status, is_test from hq.leads where awaiting_reply_since is not null and status not in ('afgemeld','verloren') and is_test=$1 order by awaiting_reply_since limit 20`, [T]),
    q(`select q.id, q.lead_id, l.company, q.status, q.price_cents, q.interest, q.sent_at, q.extras, q.created_at from hq.quotes q join hq.leads l on l.id=q.lead_id
       where q.is_test=$1 and (q.status='concept' or (q.status='verstuurd' and (q.interest or q.sent_at < now() - interval '5 days'))) order by q.created_at desc limit 20`, [T]),
    q(`select p.id, p.name, p.status, p.intake_complete_at, p.briefing_at, p.price_cents, p.lead_id from hq.projects p where p.status in ('akkoord','intake','in_aanbouw','websitecontrole') and p.is_test=$1 order by p.updated_at desc`, [T]),
    q(`select 'feedback' as soort, f.id, p.name as titel, f.scope_note as waarom from hq.project_feedback f join hq.projects p on p.id=f.project_id where f.status='voorstel' and p.is_test=$1
       union all select 'review', o.id, l.company, 'Reviewverzoek staat klaar (jij verstuurt)' from hq.outreach o join hq.leads l on l.id=o.lead_id where o.kind='review_verzoek' and o.status='concept' and o.is_test=$1
       union all select 'onzeker', o.id, l.company, coalesce(o.last_error,'Uitkomst onduidelijk: eerst controleren') from hq.outreach o join hq.leads l on l.id=o.lead_id where o.status='onzeker' and o.is_test=$1
       union all select 'fout', e.id, e.kind, e.description from hq.agent_errors e where e.resolved_at is null and e.is_test=$1`, [T]),
    one("select * from hq.briefings where env=$1 order by day desc limit 1", [env]),
    q("select a.*, l.company from hq.actions a left join hq.leads l on l.id=a.lead_id where a.status in ('open','opgepakt') and a.is_test=$1 order by a.day desc, a.rank limit 10", [T]),
    q(`select o.id, o.lead_id, l.company, o.kind, o.channel, o.subject, o.body, o.to_address from hq.outreach o join hq.leads l on l.id=o.lead_id where o.status in ('klaar_handmatig') and o.is_test=$1 order by o.updated_at desc limit 10`, [T]),
  ]);
  const k = await plan.kantoorSettings();
  return { env, requests: requests.rows, quotes: quotes.rows, projects: projects.rows, decisions: decisions.rows, briefing, actions: actions.rows, manual: manual.rows,
    capacity: await sales.capacity(null, { test: T }), paused: Boolean(k.paused), routes: await contact.getRoutes(), mail: mailConfigured() };
}

export async function kantoor(env = "productie") {
  const [briefings, scores, routes, errors, experiments, prompts, segments, partners, proposals, settings] = await Promise.all([
    q("select * from hq.briefings where env=$1 order by day desc limit 7", [env]),
    plan.scorecards({ env }),
    contact.getRoutes(),
    q("select * from hq.agent_errors where is_test=$1 order by (resolved_at is null) desc, at desc limit 30", [env === "test"]),
    q("select * from hq.experiments order by started_at desc limit 20"),
    q("select id, key, version, active, note, created_at from hq.prompt_versions order by key, version desc"),
    q("select * from hq.segments order by key"),
    proj.partners(),
    q("select * from hq.proposals order by created_at desc limit 20"),
    Promise.all(["kantoor", "sales", "availability", "scout"].map(getSetting)),
  ]);
  const exps = [];
  for (const e of experiments.rows) exps.push(await plan.experimentResults(e.id));
  return { briefings: briefings.rows, scorecards: scores, routes, errors: errors.rows, experiments: exps, prompts: prompts.rows, segments: segments.rows, partners, proposals: proposals.rows,
    settings: { kantoor: settings[0], sales: settings[1], availability: settings[2], scout: settings[3] }, capacity: await sales.capacity(), ai: await budgetOverview(), mail: mailConfigured(),
    results: await proj.results({ env }), consent_bases: contact.BASIS_LABEL,
    cron: (await q("select key, updated_at from hq.settings where key like 'cron:%' order by key")).rows.map(r => ({ part: r.key.slice(5), at: r.updated_at })) };
}

async function listKlanten(url) {
  const f = url.searchParams.get("filter") || "alle", s = url.searchParams.get("q");
  const T = url.searchParams.get("env") === "test";
  const vals = [T]; const w = ["is_test=$1"];
  if (f === "wacht") w.push("awaiting_reply_since is not null");
  if (f === "aanvragen") w.push("status in ('aanvraag','gekwalificeerd','gesprek','afspraak')");
  if (f === "offerte") w.push("status='offerte'");
  if (f === "scout") w.push("source='scout_osm'");
  if (f === "klant") w.push("status='gewonnen'");
  if (s) { vals.push(`%${s}%`); w.push(`(company ilike $${vals.length} or contact_email ilike $${vals.length})`); }
  return (await q(`select id, company, status, segment, priority, priority_reason, website_status, awaiting_reply_since, need_summary, source, city, updated_at, is_test from hq.leads where ${w.join(" and ")} order by (awaiting_reply_since is not null) desc, updated_at desc limit 200`, vals)).rows;
}

export async function handleKlant({ m, path, url, body, auth, startWorker }) {
  let p;
  const env = url.searchParams.get("env") === "test" ? "test" : "productie";
  if (m === "GET" && path === "vandaag") return json(await today(env));
  if (m === "POST" && path === "opdracht") { assertPerm(auth, "leads.write"); const r = await runCommand(body, auth); return json(r); }

  // ── Klanten ──
  if (m === "GET" && path === "klanten") return json({ klanten: await listKlanten(url) });
  if (m === "POST" && path === "klanten") { assertPerm(auth, "leads.write"); return json(await sales.intakeRequest({ ...body, channel: body.channel || "gesprek" }, auth), 201); }
  if ((p = route(path, "klanten/:id")) && m === "GET") return json(await sales.customerCard(p.id));
  if ((p = route(path, "klanten/:id/reactie")) && m === "POST") { assertPerm(auth, "leads.write"); return json(await sales.registerReply({ ...body, lead_id: p.id }, auth)); }
  if ((p = route(path, "klanten/:id/offerte")) && m === "POST") { assertPerm(auth, "quotes.write"); return json(await sales.prepareQuote(p.id, body, auth), 201); }
  if ((p = route(path, "klanten/:id/afspraak")) && m === "POST") { assertPerm(auth, "leads.write"); return json(await sales.book(p.id, body, auth), 201); }
  if ((p = route(path, "klanten/:id/beantwoord")) && m === "POST") { assertPerm(auth, "leads.write"); return json(await sales.markAnswered(p.id, body, auth)); }
  if ((p = route(path, "klanten/:id/toestemming")) && m === "POST") { assertPerm(auth, "leads.write"); return json(await contact.recordConsent(p.id, body, auth), 201); }
  if ((p = route(path, "klanten/:id/betaling")) && m === "POST") { assertPerm(auth, "payments.write"); return json(await sales.registerPayment(p.id, body, auth), 201); }
  if ((p = route(path, "klanten/:id/benaderen")) && m === "POST") { assertPerm(auth, "leads.write"); const r = await acq.prepareApproach(p.id, auth); return json(r); }
  if ((p = route(path, "klanten/:id/afmelden")) && m === "POST") {
    assertPerm(auth, "leads.write"); assertUuid(p.id);
    const lead = await one("select * from hq.leads where id=$1", [p.id]);
    if (!lead) throw new HttpError(404, "niet_gevonden", "Klant niet gevonden.");
    await tx(async (db) => {
      await contact.suppress({ lead, reason: body.reason === "bezwaar" ? "bezwaar" : "afmelding", note: str(body.note, 300) || "Handmatig vastgelegd" }, db);
      await db.query("update hq.leads set status='afgemeld', awaiting_reply_since=null, updated_at=now() where id=$1", [p.id]);
      await db.query("insert into hq.interactions (lead_id, direction, channel, kind, body, is_test, created_by, created_label) values ($1,'in','systeem',$2,$3,$4,$5,$6)", [p.id, body.reason === "bezwaar" ? "bezwaar" : "afmelding", str(body.note, 300) || "Afgemeld (handmatig vastgelegd)", lead.is_test, auth.userId, auth.email]);
    });
    return json({ ok: true });
  }
  if (m === "GET" && path === "agenda/vrij") return json({ slots: await sales.freeSlots({ days: Math.min(Number(url.searchParams.get("dagen")) || 7, 21) }) });

  // ── Offertes en berichten ──
  if ((p = route(path, "offertes/:id/versturen")) && m === "POST") { assertPerm(auth, "approvals.money"); return json(await sales.sendQuote(p.id, body, auth)); }
  if ((p = route(path, "offertes/:id/belangstelling")) && m === "POST") { assertPerm(auth, "quotes.write"); return json(await sales.markInterest(p.id, auth)); }
  if ((p = route(path, "offertes/:id/akkoord")) && m === "POST") { assertPerm(auth, "approvals.money"); return json(await sales.acceptQuote(p.id, auth)); }
  if ((p = route(path, "outreach/:id/verstuurd")) && m === "POST") {
    assertPerm(auth, "leads.write"); assertUuid(p.id);
    const o = await one("select lead_id from hq.outreach where id=$1", [p.id]);
    if (!o) throw new HttpError(404, "niet_gevonden", "Bericht niet gevonden.");
    return json(await sales.markAnswered(o.lead_id, { outreach_id: p.id }, auth));
  }
  if ((p = route(path, "outreach/:id/annuleren")) && m === "POST") {
    assertPerm(auth, "leads.write"); assertUuid(p.id);
    const r = await q("update hq.outreach set status='geannuleerd', cancel_reason=$2, updated_at=now() where id=$1 and status in ('concept','gepland','klaar_handmatig','onzeker')", [p.id, str(body.reason, 200) || "Geannuleerd door Rayan"]);
    return json({ ok: r.rowCount > 0 });
  }
  if ((p = route(path, "outreach/:id/onzeker")) && m === "POST") {
    // Na controle in "Verzonden": wel verstuurd → verzonden; niet verstuurd → opnieuw inplannen.
    assertPerm(auth, "leads.write"); assertUuid(p.id);
    const st = body.sent ? "verzonden" : "gepland";
    const r = await q(`update hq.outreach set status=$2, sent_at=case when $2='verzonden' then coalesce(sent_at, now()) else sent_at end, scheduled_at=case when $2='gepland' then now() else scheduled_at end, task_id=null, last_error=null, updated_at=now() where id=$1 and status='onzeker'`, [p.id, st]);
    return json({ ok: r.rowCount > 0, status: st });
  }

  // ── Kantoor ──
  if (m === "GET" && path === "kantoor") return json(await kantoor(env));
  if (m === "POST" && path === "kantoor/overleg") { assertPerm(auth, "tasks.start"); return json(await plan.runMeeting({ env, force: true })); }
  if (m === "POST" && path === "kantoor/mailtest") { assertPerm(auth, "settings.write"); return json(await acq.sendSelfTest(auth)); }
  if (m === "PUT" && path === "kantoor/routes") { assertPerm(auth, "settings.write"); return json({ routes: await contact.putRoutes(body, auth) }); }
  if (m === "PUT" && path === "kantoor/pauze") {
    assertPerm(auth, "tasks.control");
    const k = await getSetting("kantoor"); k.paused = Boolean(body.paused);
    await putSetting("kantoor", k, auth);
    return json({ paused: k.paused });
  }
  if ((p = route(path, "kantoor/instellingen/:key")) && m === "PUT") {
    assertPerm(auth, "settings.write");
    if (!["kantoor", "sales", "availability", "scout"].includes(p.key)) throw new HttpError(404, "niet_gevonden", "Onbekende instelling.");
    const cur = await getSetting(p.key);
    const v = { ...cur };
    if (p.key === "kantoor") {
      if (body.meeting_time != null) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.meeting_time)) throw new HttpError(400, "ongeldig", "Tijd als UU:MM."); v.meeting_time = body.meeting_time; }
      if (body.max_actions != null) v.max_actions = Math.max(1, Math.min(5, Number(body.max_actions) || 5));
    }
    if (p.key === "sales") {
      if (body.followup) v.followup = { ...(cur.followup || {}), enabled: body.followup.enabled ?? cur.followup?.enabled ?? true, max: Math.max(0, Math.min(2, Number(body.followup.max ?? cur.followup?.max ?? 2))),
        days: Array.isArray(body.followup.days) ? body.followup.days.map(Number).filter(n => n >= 1 && n <= 30).slice(0, 2) : cur.followup?.days || [3, 7], only_with_interest: body.followup.only_with_interest ?? cur.followup?.only_with_interest ?? true };
      if (body.capacity) v.capacity = { max_projects: Math.max(1, Math.min(20, Number(body.capacity.max_projects) || 3)), days_per_project: Math.max(1, Math.min(90, Number(body.capacity.days_per_project) || 14)) };
    }
    if (p.key === "availability") {
      if (Array.isArray(body.weekdays)) v.weekdays = body.weekdays.map(Number).filter(d => d >= 1 && d <= 7);
      for (const k of ["from", "to", "quiet_from", "quiet_to"]) if (body[k] != null) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body[k])) throw new HttpError(400, "ongeldig", "Tijd als UU:MM."); v[k] = body[k]; }
      if (body.slot_min != null) v.slot_min = [15, 30, 45, 60].includes(Number(body.slot_min)) ? Number(body.slot_min) : 30;
    }
    if (p.key === "scout") {
      if ("enabled" in body) v.enabled = Boolean(body.enabled);
      if (Array.isArray(body.cities)) v.cities = body.cities.map(c => str(c, 60)).filter(Boolean).slice(0, 6);
      if (body.per_week != null) v.per_week = Math.max(0, Math.min(100, Number(body.per_week) || 0));
    }
    await putSetting(p.key, v, auth);
    return json({ [p.key]: v });
  }
  if ((p = route(path, "acties/:id")) && m === "POST") {
    assertPerm(auth, "tasks.control"); assertUuid(p.id);
    const st = ["opgepakt", "klaar", "vervallen", "open"].includes(body.status) ? body.status : null;
    if (!st) throw new HttpError(400, "ongeldig", "Ongeldige status.");
    const r = await one("update hq.actions set status=$2, picked_at=case when $2='opgepakt' then now() else picked_at end, done_at=case when $2='klaar' then now() else done_at end, result=coalesce($3,result) where id=$1 returning *", [p.id, st, str(body.result, 300)]);
    return json({ action: r });
  }
  if ((p = route(path, "fouten/:id/hersteld")) && m === "POST") { assertPerm(auth, "settings.write"); assertUuid(p.id); return json(await plan.resolveError(p.id, str(body.note, 300), auth)); }

  // ── Scout en segmenten ──
  if (m === "POST" && path === "scout/ontdekken") {
    assertPerm(auth, "tasks.start");
    const seg = await one("select * from hq.segments where key=$1", [String(body.segment || "")]);
    if (!seg) throw new HttpError(400, "ongeldig", "Onbekend segment.");
    const city = str(body.city, 60);
    if (!city) throw new HttpError(400, "ongeldig", "Plaats is verplicht.");
    const t = await tx((db) => enqueue(db, { agent: "scout", kind: "ontdekken", title: `Ontdekken: ${seg.name} in ${city}`, input: { segment: seg.key, city, limit: Math.min(Number(body.limit) || 15, 40) }, createdBy: auth.userId, idempotencyKey: `ontdekken:${seg.key}:${city.toLowerCase()}:${new Date().toISOString().slice(0, 10)}` }));
    startWorker();
    return json({ task_id: t.id, duplicate: Boolean(t.duplicate) }, 201);
  }
  if ((p = route(path, "segmenten/:key")) && m === "PUT") {
    assertPerm(auth, "settings.write");
    const r = await one("update hq.segments set active=coalesce($2,active), hypothesis=coalesce($3,hypothesis), cities=coalesce($4::text[],cities), updated_at=now() where key=$1 returning *",
      [p.key, typeof body.active === "boolean" ? body.active : null, str(body.hypothesis, 500), Array.isArray(body.cities) ? body.cities.map(c => str(c, 60)).filter(Boolean) : null]);
    if (!r) throw new HttpError(404, "niet_gevonden", "Segment niet gevonden.");
    return json({ segment: r });
  }
  if ((p = route(path, "observaties/:id")) && m === "POST") {
    // Rayan controleert een observatie van de Auditor: telt mee in de scorekaart.
    assertPerm(auth, "leads.write"); assertUuid(p.id);
    if (!["klopt", "klopt_niet"].includes(body.verified)) throw new HttpError(400, "ongeldig", "klopt of klopt_niet");
    const r = await one("update hq.opportunities set verified=$2, verified_by=$3, verified_at=now() where id=$1 returning *", [p.id, body.verified, auth.userId]);
    if (r && body.verified === "klopt_niet") await plan.recordError({ department: "auditor", kind: "onjuiste_observatie", description: `Observatie klopte niet: ${r.observation}`, lead_id: r.lead_id });
    return json({ observation: r });
  }

  // ── Experimenten en promptversies ──
  if (m === "POST" && path === "experimenten") {
    assertPerm(auth, "settings.write");
    const f = (k, n = 500) => { const v = str(body[k], n); if (!v) throw new HttpError(400, "ongeldig", `${k} is verplicht.`); return v; };
    const running = await one("select id from hq.experiments where status='loopt' and department=$1", [f("department", 40)]);
    if (running) throw new HttpError(409, "loopt_al", "Er loopt al een experiment voor deze afdeling: één wijziging tegelijk.");
    return json({ experiment: await one("insert into hq.experiments (name, department, change, variant_a, variant_b, metric, min_samples) values ($1,$2,$3,$4,$5,$6,$7) returning *",
      [f("name", 120), f("department", 40), f("change"), f("variant_a"), f("variant_b"), f("metric"), Math.max(5, Math.min(500, Number(body.min_samples) || 20))]) }, 201);
  }
  if ((p = route(path, "experimenten/:id")) && m === "GET") return json(await plan.experimentResults(p.id));
  if ((p = route(path, "experimenten/:id/afronden")) && m === "POST") {
    assertPerm(auth, "settings.write");
    const st = body.rollback ? "teruggedraaid" : "afgerond";
    return json({ experiment: await one("update hq.experiments set status=$2, decision=$3, ended_at=now() where id=$1 returning *", [p.id, st, str(body.decision, 500) || (st === "teruggedraaid" ? "Teruggedraaid naar A" : "Afgerond")]) });
  }
  if ((p = route(path, "promptversies/:id/activeer")) && m === "POST") {
    assertPerm(auth, "settings.write"); assertUuid(p.id);
    const v = await one("select * from hq.prompt_versions where id=$1", [p.id]);
    if (!v) throw new HttpError(404, "niet_gevonden", "Versie niet gevonden.");
    await tx(async (db) => { await db.query("update hq.prompt_versions set active=false where key=$1", [v.key]); await db.query("update hq.prompt_versions set active=true where id=$1", [p.id]); });
    await audit(null, { actor: auth.userId, label: auth.email, action: "promptversie.actief", details: { key: v.key, version: v.version } });
    return json({ ok: true, key: v.key, version: v.version });
  }

  // ── Partners, bewijs ──
  if (m === "GET" && path === "partners") return json({ partners: await proj.partners() });
  if (m === "POST" && path === "partners") { assertPerm(auth, "leads.write"); return json({ partner: await proj.addPartner(body, auth) }, 201); }
  if (m === "POST" && path === "bewijs") { assertPerm(auth, "settings.write"); return json({ evidence: await proj.addEvidence(body, auth) }, 201); }

  // ── Projecten ──
  if ((p = route(path, "projecten/:id/intake-link")) && m === "POST") { assertPerm(auth, "content.write"); return json(await proj.newIntakeLink(p.id, auth)); }
  if ((p = route(path, "projecten/:id/feedback")) && m === "POST") { assertPerm(auth, "content.write"); return json({ feedback: await proj.addFeedback(p.id, body.text, auth) }, 201); }
  if ((p = route(path, "projecten/:id/opleverkandidaat")) && m === "POST") { assertPerm(auth, "content.write"); const r = await proj.deliveryCandidate(p.id, body.url, auth); startWorker(); return json(r, 201); }
  if ((p = route(path, "projecten/:id/status")) && m === "POST") { assertPerm(auth, "content.write"); const r = await proj.setProjectStatus(p.id, String(body.status || ""), auth); startWorker(); return json(r); }
  if ((p = route(path, "projecten/:id/briefing")) && m === "GET") { assertUuid(p.id); const r = await one("select name, briefing, briefing_at, intake, scope, intake_complete_at from hq.projects where id=$1", [p.id]); if (!r) throw new HttpError(404, "niet_gevonden", "Project niet gevonden."); return json({ ...r, completeness: proj.completeness(r.intake, r.scope) }); }

  // ── Resultaten en voorstellen ──
  if (m === "GET" && path === "resultaten") return json(await proj.results({ env, days: Math.min(Number(url.searchParams.get("dagen")) || 30, 365) }));
  if (m === "POST" && path === "voorstellen/maken") { assertPerm(auth, "settings.write"); return json(await proj.weeklyProposals()); }
  if ((p = route(path, "voorstellen/:id")) && m === "POST") {
    assertPerm(auth, "settings.write"); assertUuid(p.id);
    const st = ["goedgekeurd", "afgewezen", "teruggedraaid", "gepubliceerd"].includes(body.status) ? body.status : null;
    if (!st) throw new HttpError(400, "ongeldig", "Ongeldige status.");
    return json({ proposal: await one("update hq.proposals set status=$2 where id=$1 returning *", [p.id, st]) });
  }
  return null;
}
