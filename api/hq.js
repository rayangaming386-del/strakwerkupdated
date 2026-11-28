// /api/hq/* — alle gegevens van StrakWerk HQ. Elke route controleert sessie, lidmaatschap,
// MFA (voor eigenaars) en de rechten van de rol aan de serverkant.
import { waitUntil, isWorkers } from "./_lib/runtime.js";
import { q, one, tx, audit } from "./_lib/db.js";
import { env, missingCore } from "./_lib/env.js";
import { json, errorResponse, readJson, assertSameOrigin, route, HttpError, assertUuid, str } from "./_lib/http.js";
import { getAuth, assertPerm, ROLES, ROLE_LABEL } from "./_lib/auth.js";
import * as analytics from "./_lib/analytics/index.js";
import * as crm from "./_lib/crm.js";
import * as approvals from "./_lib/approvals.js";
import { enqueue, requestControl, getLimits, spentTodayUsd, STATUS_LABEL } from "./_lib/queue.js";
import { runWorker, kickIfNeeded } from "./_lib/worker.js";
import { connection, TOOLS } from "./_lib/agents/registry.js";
import { llmConfigured, llmModel } from "./_lib/agents/llm.js";
import * as vercelSrc from "./_lib/analytics/vercel.js";
import * as sb from "./_lib/supabase.js";
import { handleStudio } from "./_lib/content/routes.js";
import { handleKlant, isKlantPath } from "./_lib/klant/routes.js";
import { dispatchRenderWorker, dispatchConfigured } from "./_lib/content/dispatch.js";
import { driver as storageDriver } from "./_lib/content/storage.js";
import { missingIg } from "./_lib/content/instagram.js";

// Cloudflare: werk na het antwoord mag max. 30 s duren; daarna pakt de cron (elke minuut) het op.
const startWorker = () => waitUntil(runWorker({ source: "api", budgetMs: isWorkers ? 25_000 : 50_000 }));

// ── Agentwereld ──────────────────────────────────────────────────────────
async function world() {
  const [agents, active, recent, prog, cost] = await Promise.all([
    q("select * from hq.agents order by sort"),
    q(`select id, agent_key, title, status, control, lead_id, chain_id, parent_task_id, created_at, started_at, updated_at, attempts, max_attempts, error, cost_usd::float as cost_usd
       from hq.tasks where status in ('in_wachtrij','bezig','wacht_op_goedkeuring','gepauzeerd') order by created_at`),
    q(`select distinct on (agent_key) agent_key, id, title, status, error, finished_at, updated_at, cost_usd::float as cost_usd
       from hq.tasks where status in ('afgerond','mislukt','geannuleerd') and updated_at > now() - interval '24 hours' order by agent_key, updated_at desc`),
    approvals.progress(),
    q("select agent_key, coalesce(sum(cost_usd),0)::float as usd, count(*)::int as n from hq.tasks where created_at > now() - interval '30 days' group by 1"),
  ]);
  const byAgent = (k) => active.rows.filter(t => t.agent_key === k);
  const costs = Object.fromEntries(cost.rows.map(r => [r.agent_key, r]));
  const list = agents.rows.map(a => {
    const conn = connection(a.key);
    const mine = byAgent(a.key);
    const last = recent.rows.find(r => r.agent_key === a.key) || null;
    let status = "beschikbaar";
    if (!conn.connected) status = "niet_gekoppeld";
    else if (mine.some(t => t.status === "bezig")) status = "bezig";
    else if (mine.some(t => t.status === "in_wachtrij")) status = "in_wachtrij";
    else if (mine.some(t => t.status === "wacht_op_goedkeuring")) status = "wacht_op_goedkeuring";
    else if (mine.some(t => t.status === "gepauzeerd")) status = "gepauzeerd";
    else if (last?.status === "mislukt") status = "mislukt";
    else if (last?.status === "afgerond") status = "afgerond";
    return {
      ...a, status, statusLabel: STATUS_LABEL[status], connection: conn, tools: TOOLS[a.key] || [],
      current: mine.find(t => t.status === "bezig") || mine[0] || null, queue: mine.length, last,
      xp: prog.agents[a.key] || { xp: 0, level: 1, awards: 0 }, cost30d: costs[a.key] || { usd: 0, n: 0 },
    };
  });
  return { agents: list, active: active.rows, missions: prog.missions, serverTime: new Date().toISOString() };
}

async function timeline(limit = 60, after = null) {
  const vals = [Math.min(Number(limit) || 60, 200)];
  let w = "";
  if (after && /^\d+$/.test(after)) { vals.push(after); w = "where e.id > $2"; }
  return (await q(`select e.id, e.task_id, e.at, e.type, e.from_status, e.to_status, e.from_agent, e.to_agent, e.message, t.title, t.lead_id
    from hq.task_events e join hq.tasks t on t.id=e.task_id ${w} order by e.id desc limit $1`, vals)).rows;
}

async function taskDetail(id) {
  assertUuid(id);
  const t = await one(`select t.*, t.cost_usd::float as cost_usd, l.company from hq.tasks t left join hq.leads l on l.id=t.lead_id where t.id=$1`, [id]);
  if (!t) throw new HttpError(404, "niet_gevonden", "Taak niet gevonden.");
  const [events, runs, appr] = await Promise.all([
    q("select * from hq.task_events where task_id=$1 order by at, id", [id]),
    q("select id, attempt, worker_id, started_at, finished_at, outcome, error, cost_usd::float as cost_usd from hq.task_runs where task_id=$1 order by attempt", [id]),
    q("select id, kind, status, title from hq.approvals where task_id=$1", [id]),
  ]);
  return { task: t, events: events.rows, runs: runs.rows, approvals: appr.rows };
}

async function startChain(body, auth, idem) {
  const leadId = assertUuid(body.lead_id, "lead");
  const lead = await one("select id, company, website from hq.leads where id=$1", [leadId]);
  if (!lead) throw new HttpError(404, "niet_gevonden", "Lead niet gevonden.");
  if (!lead.website) throw new HttpError(409, "ontbreekt", "Deze lead heeft geen website. Vul eerst een website in.");
  for (const k of ["scout", "auditor", "sales"]) {
    const c = connection(k);
    if (!c.connected) throw new HttpError(409, "niet_gekoppeld", `Agent ${k} is niet gekoppeld.`, { missing: c.missing });
  }
  const r = await tx(db => enqueue(db, { agent: "scout", kind: "lead_onderzoek", title: `Lead-onderzoek ${lead.company}`, input: {}, leadId, createdBy: auth.userId,
    idempotencyKey: idem ? `start:${auth.userId}:${idem}` : null }));
  await audit(null, { actor: auth.userId, label: auth.email, action: "keten.gestart", entity: "task", entityId: r.id, details: { lead: leadId } });
  startWorker();
  return r;
}

// ── Overzicht ────────────────────────────────────────────────────────────
async function overview(envName) {
  const [a, c, t, appr, spend] = await Promise.all([
    analytics.overview(envName),
    crm.crmMetrics(),
    one("select count(*) filter (where status='bezig')::int as running, count(*) filter (where status='in_wachtrij')::int as queued, count(*) filter (where status='mislukt' and updated_at > now() - interval '7 days')::int as failed7d from hq.tasks"),
    one("select count(*)::int as n from hq.approvals where status='open'"),
    one(`select coalesce(sum(cost_usd) filter (where started_at >= date_trunc('day', now() at time zone 'Europe/Amsterdam') at time zone 'Europe/Amsterdam'),0)::float as today,
                coalesce(sum(cost_usd) filter (where started_at >= date_trunc('month', now() at time zone 'Europe/Amsterdam') at time zone 'Europe/Amsterdam'),0)::float as month
         from hq.task_runs`),
  ]);
  const limits = await getLimits();
  return { ...a, crm: c, tasks: t, approvalsOpen: appr.n, agentCost: { ...spend, dailyBudget: limits.daily_budget_usd, llm: llmConfigured() }, generatedAt: new Date().toISOString() };
}

// ── Instellingen ─────────────────────────────────────────────────────────
function integrations() {
  const vm = vercelSrc.missing();
  return [
    { key: "database", label: "Database (Supabase Postgres)", state: env.databaseUrl ? "gekoppeld" : "niet_gekoppeld", missing: env.databaseUrl ? [] : ["DATABASE_URL"] },
    { key: "auth", label: "Supabase Auth", state: env.supabaseUrl && env.supabasePublicKey ? "gekoppeld" : "niet_gekoppeld", missing: missingCore().filter(m => m.startsWith("SUPABASE")) },
    { key: "auth_admin", label: "Uitnodigen (Supabase admin-sleutel)", state: env.supabaseSecretKey ? "gekoppeld" : "niet_gekoppeld", missing: env.supabaseSecretKey ? [] : ["SUPABASE_SECRET_KEY"] },
    { key: "eigen_meting", label: "Eigen bezoekersmeting", state: env.databaseUrl ? "gekoppeld" : "niet_gekoppeld", missing: env.databaseUrl ? [] : ["DATABASE_URL"] },
    { key: "vercel", label: "Vercel Web Analytics API", state: vm.length ? "niet_gekoppeld" : "gekoppeld", missing: vm, note: "Optioneel. Hobby: 1 maand historie; eigen events en UTM vragen een duurder abonnement." },
    { key: "claude", label: `Claude API (${llmModel()})`, state: llmConfigured() ? "gekoppeld" : "niet_gekoppeld", missing: llmConfigured() ? [] : ["ANTHROPIC_API_KEY"], note: "Optioneel. Zonder sleutel: alleen metingen en sjabloonconcepten." },
    { key: "pagespeed", label: "Google PageSpeed Insights", state: env.pagespeedKey ? "gekoppeld" : "beperkt", missing: env.pagespeedKey ? [] : ["PAGESPEED_API_KEY"], note: "Werkt zonder sleutel met een lage limiet." },
    { key: "cron", label: "Geplande uitvoering (cron)", state: env.cronSecret ? "gekoppeld" : "niet_gekoppeld", missing: env.cronSecret ? [] : ["CRON_SECRET"], note: "Dagelijkse opruiming en vangnet voor vastgelopen taken. Voor publiceren op tijd: roep /api/worker elke 5 minuten aan (Vercel Pro-cron of een externe planner)." },
    { key: "opslag", label: "Video-opslag (Supabase Storage)", state: storageDriver() === "supabase" ? "gekoppeld" : storageDriver() === "local" ? "beperkt" : "niet_gekoppeld", missing: storageDriver() === "supabase" ? [] : ["SUPABASE_SECRET_KEY"], note: "Privé-bucket hq-media; afspelen via kortlevende links." },
    { key: "instagram", label: "Instagram API (professioneel account)", state: missingIg().length ? "niet_gekoppeld" : "beperkt", missing: missingIg(), note: "Na instellen: koppel je account in Contentstudio › Automatisering. Zonder koppeling: export." },
    { key: "render", label: "Render-worker direct starten (GitHub Actions)", state: dispatchConfigured() ? "gekoppeld" : "beperkt", missing: dispatchConfigured() ? [] : ["GITHUB_RENDER_TOKEN", "GITHUB_RENDER_REPO"], note: "Zonder: de workflow draait 3× per dag, of start npm run render-worker zelf." },
    { key: "tiktok", label: "TikTok-publicatie", state: "niet_gekoppeld", missing: [], note: "Export (MP4, cover, caption). Een publicatiedienst vraagt eerst jouw akkoord over prijs en voorwaarden." },
  ];
}

async function settings(auth) {
  const [limits, recurring, packages, members, spent] = await Promise.all([
    getLimits(), one("select value from hq.settings where key='recurring'"), q("select * from hq.packages order by sort"),
    auth.role === "eigenaar" ? q("select user_id, email, role, status, created_at, last_login_at from hq.members order by created_at") : { rows: [] },
    spentTodayUsd(),
  ]);
  return { limits, recurring: recurring?.value || { enabled: false }, packages: packages.rows, members: members.rows, roles: ROLES.map(r => ({ key: r, label: ROLE_LABEL[r] })),
    integrations: integrations(), spentTodayUsd: spent, mfaRoles: env.mfaRoles };
}

const LIMIT_RULES = { max_concurrent: [1, 4], task_timeout_s: [15, 55], max_steps: [3, 20], max_attempts: [1, 3], max_cost_usd_per_task: [0, 2], daily_budget_usd: [0, 25] };

async function putLimits(body, auth) {
  const cur = await getLimits();
  const next = { ...cur };
  for (const [k, [lo, hi]] of Object.entries(LIMIT_RULES)) {
    if (k in body) {
      const v = Number(body[k]);
      if (!Number.isFinite(v) || v < lo || v > hi) throw new HttpError(400, "ongeldig", `${k} moet tussen ${lo} en ${hi} liggen.`);
      next[k] = k.includes("usd") ? Math.round(v * 100) / 100 : Math.round(v);
    }
  }
  await q("insert into hq.settings (key, value, updated_by, updated_at) values ('limits',$1,$2,now()) on conflict (key) do update set value=excluded.value, updated_by=excluded.updated_by, updated_at=now()", [next, auth.userId]);
  await audit(null, { actor: auth.userId, label: auth.email, action: "instellingen.limieten", details: { van: cur, naar: next } });
  return next;
}

async function putPackage(key, body, auth) {
  const pkg = await one("select * from hq.packages where key=$1", [key]);
  if (!pkg) throw new HttpError(404, "niet_gevonden", "Pakket niet gevonden.");
  const price = body.price_eur != null ? Math.round(Number(body.price_eur) * 100) : pkg.price_cents;
  if (!Number.isFinite(price) || price < 0 || price > 10_000_000) throw new HttpError(400, "ongeldig", "Ongeldige prijs.");
  const terms = body.terms != null ? String(body.terms).slice(0, 5000) : pkg.terms;
  const active = body.active != null ? Boolean(body.active) : pkg.active;
  const r = await one("update hq.packages set price_cents=$2, terms=$3, active=$4, updated_by=$5, updated_at=now() where key=$1 returning *", [key, price, terms, active, auth.userId]);
  await audit(null, { actor: auth.userId, label: auth.email, action: "pakket.gewijzigd", entity: "package", entityId: key, details: { prijs_van: pkg.price_cents, prijs_naar: price, voorwaarden_gewijzigd: terms !== pkg.terms } });
  return r;
}

async function invite(body, auth) {
  const email = str(body.email, 254)?.toLowerCase();
  const role = String(body.role || "");
  if (!email || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new HttpError(400, "ongeldig", "Ongeldig e-mailadres.");
  // Nieuwe accounts krijgen nooit automatisch eigenaarsrechten.
  if (!["medewerker", "alleen_lezen"].includes(role)) throw new HttpError(400, "ongeldig", "Uitnodigen kan alleen als medewerker of alleen-lezen. Eigenaar maken is een aparte stap.");
  const existing = await one("select user_id from hq.members where lower(email)=$1", [email]);
  if (existing) throw new HttpError(409, "dubbel", "Dit e-mailadres heeft al toegang of een uitnodiging.");
  let user;
  try { user = await sb.inviteUser(email, `${env.siteUrl}/login?type=invite`); }
  catch (e) {
    if (e.status === 401 || e.status === 422) { user = await sb.findUserByEmail(email); if (!user) throw e; } else throw e;
  }
  await q("insert into hq.members (user_id, email, role, status, invited_by) values ($1,$2,$3,'uitgenodigd',$4)", [user.id, email, role, auth.userId]);
  await audit(null, { actor: auth.userId, label: auth.email, action: "lid.uitgenodigd", entity: "member", entityId: user.id, details: { rol: role } });
  return { ok: true };
}

async function patchMember(id, body, auth) {
  assertUuid(id);
  return tx(async (db) => {
    const m = (await db.query("select * from hq.members where user_id=$1 for update", [id])).rows[0];
    if (!m) throw new HttpError(404, "niet_gevonden", "Lid niet gevonden.");
    const owners = (await db.query("select count(*)::int n from hq.members where role='eigenaar' and status='actief'")).rows[0].n;
    let role = m.role, status = m.status;
    if (body.role) {
      if (!ROLES.includes(body.role)) throw new HttpError(400, "ongeldig", "Ongeldige rol.");
      if (body.role === "eigenaar" && m.role !== "eigenaar") {
        if (body.confirm !== "EIGENAAR") throw new HttpError(400, "bevestiging", 'Typ "EIGENAAR" om eigenaarsrechten te geven.');
        if (m.status !== "actief") throw new HttpError(409, "niet_actief", "Alleen een actief account kan eigenaar worden.");
      }
      if (m.role === "eigenaar" && body.role !== "eigenaar" && owners <= 1) throw new HttpError(409, "laatste_eigenaar", "Er moet minimaal één eigenaar blijven.");
      role = body.role;
    }
    if (body.status) {
      if (!["actief", "geblokkeerd"].includes(body.status)) throw new HttpError(400, "ongeldig", "Ongeldige status.");
      if (id === auth.userId && body.status === "geblokkeerd") throw new HttpError(409, "zelf", "Je kunt jezelf niet blokkeren.");
      if (m.role === "eigenaar" && body.status === "geblokkeerd" && owners <= 1) throw new HttpError(409, "laatste_eigenaar", "Er moet minimaal één eigenaar blijven.");
      status = body.status;
    }
    await db.query("update hq.members set role=$2, status=$3, updated_at=now() where user_id=$1", [id, role, status]);
    if (status !== m.status && env.supabaseSecretKey) { try { await sb.banUser(id, status === "geblokkeerd"); } catch {} }
    await audit(db, { actor: auth.userId, label: auth.email, action: "lid.gewijzigd", entity: "member", entityId: id, details: { rol: [m.role, role], status: [m.status, status] } });
    return { ok: true };
  });
}

// ── Router ───────────────────────────────────────────────────────────────
export async function handle(request) {
  try {
    const url = new URL(request.url);
    const path = (url.searchParams.get("p") ?? url.pathname.replace(/^\/api\/hq\/?/, "")).replace(/^\/+|\/+$/g, "");
    const m = request.method;
    if (m !== "GET") assertSameOrigin(request);
    const auth = await getAuth(request);
    const body = ["POST", "PUT", "PATCH"].includes(m) ? await readJson(request) : {};
    const envName = ["production", "preview", "test", "development"].includes(url.searchParams.get("env")) ? url.searchParams.get("env") : "production";
    let p;

    if (m === "GET" && path === "overview") return json(await overview(envName));
    if (m === "GET" && path === "visitors") return json(await analytics.visitors(url.searchParams.get("period") || "vandaag", envName));
    if (m === "GET" && path === "world") { const w = await world(); kickIfNeeded(waitUntil).catch(() => {}); return json(w); }
    if (m === "GET" && path === "timeline") return json({ events: await timeline(url.searchParams.get("limit"), url.searchParams.get("after")) });

    if (m === "GET" && path === "tasks") {
      const st = url.searchParams.get("status");
      const vals = []; let w = "";
      if (st && STATUS_LABEL[st]) { vals.push(st); w = "where t.status=$1"; }
      return json({ tasks: (await q(`select t.id, t.agent_key, t.title, t.status, t.control, t.lead_id, t.chain_id, t.attempts, t.max_attempts, t.error, t.created_at, t.updated_at, t.finished_at, t.cost_usd::float as cost_usd, l.company
        from hq.tasks t left join hq.leads l on l.id=t.lead_id ${w} order by t.created_at desc limit 200`, vals)).rows, labels: STATUS_LABEL });
    }
    if (m === "POST" && path === "tasks") { assertPerm(auth, "tasks.start"); return json(await startChain(body, auth, request.headers.get("x-idempotency-key")), 201); }
    if ((p = route(path, "tasks/:id")) && m === "GET") return json(await taskDetail(p.id));
    if ((p = route(path, "tasks/:id/control")) && m === "POST") {
      assertPerm(auth, "tasks.control"); assertUuid(p.id);
      const r = await requestControl(p.id, String(body.action || ""), auth);
      if (r.status === "in_wachtrij") startWorker();
      return json(r);
    }

    if (m === "GET" && path === "leads") return json({ leads: await crm.listLeads({ status: url.searchParams.get("status"), search: url.searchParams.get("q") }), statuses: crm.LEAD_STATUS_LABEL, sources: crm.SOURCES });
    if (m === "POST" && path === "leads") { assertPerm(auth, "leads.write"); return json({ lead: await crm.createLead(body, auth) }, 201); }
    if ((p = route(path, "leads/:id"))) {
      if (m === "GET") return json(await crm.leadDetail(p.id));
      if (m === "PATCH") { assertPerm(auth, "leads.write"); return json({ lead: await crm.updateLead(p.id, body, auth) }); }
      if (m === "DELETE") { assertPerm(auth, "data.delete"); if (body.confirm !== "VERWIJDEREN" && url.searchParams.get("confirm") !== "VERWIJDEREN") throw new HttpError(400, "bevestiging", 'Bevestig met "VERWIJDEREN".'); return json(await crm.deleteLead(p.id, auth)); }
    }
    if ((p = route(path, "leads/:id/quotes")) && m === "POST") { assertPerm(auth, "quotes.write"); return json({ quote: await crm.createQuote(p.id, body, auth) }, 201); }
    if ((p = route(path, "leads/:id/payments")) && m === "POST") { assertPerm(auth, "payments.write"); return json({ payment: await crm.addPayment(p.id, body, auth) }, 201); }
    if ((p = route(path, "quotes/:id/approval")) && m === "POST") { assertPerm(auth, "quotes.write"); return json(await crm.requestQuoteApproval(p.id, auth), 201); }
    if ((p = route(path, "quotes/:id/status")) && m === "POST") { assertPerm(auth, "quotes.write"); return json(await crm.setQuoteStatus(p.id, String(body.status || ""), auth)); }

    if (m === "GET" && path === "approvals") return json({ approvals: await approvals.listApprovals(url.searchParams.get("status") || "open") });
    if ((p = route(path, "approvals/:id/decide")) && m === "POST") {
      assertPerm(auth, "approvals.decide");
      const r = await approvals.decide(p.id, body, auth);
      if (r.enqueuedSales) startWorker();
      return json(r);
    }
    if ((p = route(path, "approvals/:id/use")) && m === "POST") { assertPerm(auth, "approvals.decide"); return json(await approvals.markUsed(p.id, auth)); }

    if (m === "GET" && path === "settings") return json(await settings(auth));
    if (m === "PUT" && path === "settings/limits") { assertPerm(auth, "settings.write"); return json({ limits: await putLimits(body, auth) }); }
    if ((p = route(path, "packages/:key")) && m === "PUT") { assertPerm(auth, "packages.write"); return json({ package: await putPackage(p.key, body, auth) }); }
    if (m === "POST" && path === "members/invite") { assertPerm(auth, "members.manage"); return json(await invite(body, auth), 201); }
    if ((p = route(path, "members/:id")) && m === "PATCH") { assertPerm(auth, "members.manage"); return json(await patchMember(p.id, body, auth)); }
    if (m === "GET" && path === "audit") { assertPerm(auth, "settings.write"); return json({ entries: (await q("select * from hq.audit_log order by at desc limit 200")).rows }); }

    if (isKlantPath(path)) {
      const r = await handleKlant({ m, path, url, body, auth, startWorker });
      if (r) return r;
    }
    if (path.startsWith("studio/") || path.startsWith("ai/") || path.startsWith("media/") || path.startsWith("integrations/") || /^leads\/[^/]+\/campaign$/.test(path)) {
      const kick = () => { startWorker(); waitUntil(dispatchRenderWorker()); };
      if (m === "GET" && path === "studio/overview") kickIfNeeded(waitUntil).catch(() => {});
      const r = await handleStudio({ m, path, url, body, auth, request, startWorker: kick });
      if (r) return r;
    }
    return json({ error: "niet_gevonden", message: "Onbekende route." }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}

export const GET = handle, POST = handle, PUT = handle, PATCH = handle, DELETE = handle;
