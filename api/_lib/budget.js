// Centraal AI-budget voor alle afdelingen (Marketing, Scout, Auditor, Sales).
// Het tegoed komt uit de maandelijkse API-credits van het Claude Max-abonnement. HQ:
//  - doet pas AI-aanroepen als de eigenaar het tegoed heeft bevestigd én AI heeft aangezet;
//  - reserveert vóór elke aanroep de maximale prijs (ook bij gelijktijdige taken);
//  - verrekent na afloop de gemeten prijs; bij twijfel blijft de maximale prijs staan;
//  - pauzeert AI-taken bij het plafond of bij "onvoldoende saldo" en hervat ze later zonder
//    dubbele uitvoer (dezelfde taak, geen nieuwe).
// Video's die al gemaakt zijn, publiceren gewoon door: die vragen geen AI.
import { q, one, tx, audit } from "./db.js";
import { env } from "./env.js";
import { HttpError } from "./http.js";

export const DEPARTMENTS = { marketing: "Marketing", scout: "Scout", auditor: "Auditor", sales: "Sales", overig: "Overig" };

// Budgetposten: het tegoed gaat zoveel mogelijk naar het binnenhalen en overtuigen van
// betalende klanten. Elke post heeft een plafond (deel van de HQ-limiet). Posten die
// aantoonbaar betaalde opdrachten opleveren krijgen meer (zie postShares).
export const POSTS = {
  voorbeeldsite: "Voorbeeldsites (overtuigen)",
  acquisitie: "Acquisitie en bellen (belcoach, persoonlijke berichten)",
  websitecheck: "Gratis websitecheck (warme aanvragen)",
  sales: "Sales (antwoorden, offertes, opvolging)",
  controle: "Controle op verzonnen claims",
  overig: "Overig (content, overleg) en buffer",
};
const POST_DEFAULTS = { voorbeeldsite: 25, acquisitie: 20, websitecheck: 20, sales: 15, controle: 5, overig: 15 };
const LEARNABLE = ["websitecheck", "voorbeeldsite", "acquisitie"];
export const postOf = (department) => ({ scout: "acquisitie", auditor: "acquisitie", sales: "sales", marketing: "overig" })[department] || "overig";

const SALES_AI_DEFAULTS = { posts: POST_DEFAULTS, models: { overtuigen: "claude-opus-5-5", werk: "claude-sonnet-5-5", snel: "claude-haiku-5-5" }, learn_min_paid: 3, checks_per_day: 40, calls_per_day: 5, visits_per_day: 5, notify_email: null };
export async function salesAiSettings(db) {
  const r = (await (db || { query: q }).query("select value from hq.settings where key='sales_ai'")).rows[0]?.value || {};
  return { ...SALES_AI_DEFAULTS, ...r, posts: { ...POST_DEFAULTS, ...(r.posts || {}) }, models: { ...SALES_AI_DEFAULTS.models, ...(r.models || {}) } };
}

/**
 * Verdeling van de HQ-limiet over de posten. Zonder genoeg bewijs (minder dan learn_min_paid
 * betalende klanten in 90 dagen): de basisverdeling. Daarna gaat de helft van het budget van
 * de lerende posten (websitecheck, voorbeeldsite, acquisitie) naar wat betaalde klanten opleverde.
 */
export async function postShares(db) {
  const d = db || { query: q };
  const s = await salesAiSettings(d);
  const base = s.posts;
  const r = (await d.query(`with paid as (
        select distinct p.lead_id from hq.payments p join hq.leads l on l.id = p.lead_id
         where not p.is_test and not l.is_test and p.created_at > now() - interval '90 days')
      select (select count(*)::int from paid) as total,
        (select count(*)::int from paid join hq.leads l on l.id = paid.lead_id where l.sales_channel = 'websitecheck') as websitecheck,
        (select count(*)::int from paid where exists (select 1 from hq.previews v where v.lead_id = paid.lead_id and not v.is_test)) as voorbeeldsite,
        (select count(*)::int from paid join hq.leads l on l.id = paid.lead_id where l.sales_channel in ('bellen','bezoek','acquisitie')) as acquisitie`)).rows[0];
  const paid = { websitecheck: r.websitecheck, voorbeeldsite: r.voorbeeldsite, acquisitie: r.acquisitie };
  const shares = { ...base };
  const paidSum = LEARNABLE.reduce((n, k) => n + paid[k], 0);
  const learned = r.total >= s.learn_min_paid && paidSum > 0;
  if (learned) {
    const baseSum = LEARNABLE.reduce((n, k) => n + base[k], 0);
    for (const k of LEARNABLE) shares[k] = Math.round((0.5 * base[k] + 0.5 * baseSum * paid[k] / paidSum) * 10) / 10;
  }
  return { shares, base, learned, paid, total_paid: r.total, min_paid: s.learn_min_paid,
    note: learned ? `Verdeling past zich aan op ${r.total} betalende klanten in 90 dagen.` : `Nog onvoldoende bewijs: ${r.total} van de ${s.learn_min_paid} betalende klanten die nodig zijn om de verdeling aan te passen. Tot dan geldt de basisverdeling.` };
}

async function postUsage(d, b) {
  const r = (await d.query(`select post, coalesce(sum(actual_usd) filter (where status='verrekend'),0)::float + coalesce(sum(max_usd) filter (where status='gereserveerd'),0)::float as used,
      coalesce(sum(actual_usd) filter (where status='verrekend'),0)::float as settled, count(*)::int as calls
    from hq.ai_reservations where created_at >= $1 and created_at < $2 group by 1`, [b.period_start, b.period_end])).rows;
  return Object.fromEntries(r.map(x => [x.post, x]));
}
export const departmentOf = (agentKey) => ({ content: "marketing", scout: "scout", auditor: "auditor", sales: "sales", acquisitie: "sales", teamleider: "overig" })[agentKey] || "overig";

export class BudgetError extends Error {
  constructor(message, reason = "plafond") { super(message); this.reason = reason; this.retryable = false; this.budget = true; }
}

const DEFAULTS = { enabled: false, confirmed: false, granted_usd: null, hq_limit_usd: null, period_start: null, period_end: null, paused_reason: null, console_used_usd: null };

export async function getBudget(db) {
  const r = (await (db || { query: q }).query("select value from hq.settings where key='ai_budget'")).rows[0];
  return { ...DEFAULTS, ...(r?.value || {}) };
}

/** Toestand voor AI-aanroepen. Alleen "actief" als alles klopt. */
export async function aiState(db) {
  const b = await getBudget(db);
  const now = new Date();
  const inPeriod = b.period_start && b.period_end && now >= new Date(b.period_start) && now < new Date(b.period_end);
  let reason = null;
  if (!env.anthropicKey) reason = "geen_sleutel";
  else if (!b.enabled) reason = "uit";
  else if (!b.confirmed) reason = "niet_bevestigd";
  else if (!(b.hq_limit_usd > 0)) reason = "geen_limiet";
  else if (!inPeriod) reason = "periode";
  else if (b.paused_reason) reason = b.paused_reason;
  const used = inPeriod ? await usage(db, b) : { settled: 0, reserved: 0, byDept: {} };
  return { active: !reason, reason, budget: b, used, remaining: inPeriod ? Math.max(0, (b.hq_limit_usd || 0) - used.settled - used.reserved) : 0 };
}

export const REASON_LABEL = {
  geen_sleutel: "AI staat uit: geen ANTHROPIC_API_KEY ingesteld. HQ werkt met vaste voorbeeldteksten.",
  uit: "AI staat uit. HQ werkt met vaste voorbeeldteksten tot je AI aanzet.",
  niet_bevestigd: "AI wacht tot je het beschikbare tegoed hebt bevestigd.",
  geen_limiet: "Stel eerst een HQ-limiet in voor deze tegoedperiode.",
  periode: "Geen actieve tegoedperiode. Vul de periode van je tegoed in.",
  plafond: "HQ-limiet van deze periode bereikt: AI-taken staan op pauze.",
  post: "Budget van deze post is op voor deze periode: HQ gebruikt hier vaste teksten tot de volgende periode.",
  saldo: "Anthropic meldt onvoldoende tegoed: AI-taken staan op pauze.",
};

async function usage(db, b) {
  const r = (await (db || { query: q }).query(`select department,
      coalesce(sum(actual_usd) filter (where status='verrekend'),0)::float as settled,
      coalesce(sum(max_usd) filter (where status='gereserveerd'),0)::float as reserved,
      count(*)::int as calls
    from hq.ai_reservations where created_at >= $1 and created_at < $2 group by 1`, [b.period_start, b.period_end])).rows;
  const byDept = Object.fromEntries(r.map(x => [x.department, x]));
  return { settled: r.reduce((s, x) => s + x.settled, 0), reserved: r.reduce((s, x) => s + x.reserved, 0), byDept };
}

/**
 * Reserveer ruimte voor de maximale prijs van één aanroep. Gelijktijdige reserveringen
 * worden achter elkaar beoordeeld (advisory lock), dus samen nooit boven de limiet.
 */
export async function reserve({ department, taskId = null, maxUsd, model, post = null }) {
  const p = POSTS[post] ? post : postOf(department);
  const out = await tx(async (db) => {
    await db.query("select pg_advisory_xact_lock(hashtext('hq_ai_budget'))");
    const st = await aiState(db);
    if (!st.active) return { blocked: st.reason };
    if (st.used.settled + st.used.reserved + maxUsd > st.budget.hq_limit_usd + 1e-9) {
      // Plafond: pauze vastleggen (blijft staan na deze transactie) en niets reserveren.
      await setPaused(db, "plafond");
      return { over: true, remaining: st.remaining };
    }
    // Plafond per post: zo kan bijvoorbeeld de openbare websitecheck nooit het hele tegoed opmaken.
    const { shares } = await postShares(db);
    const cap = (st.budget.hq_limit_usd * (shares[p] || 0)) / 100;
    const usedPost = (await postUsage(db, st.budget))[p]?.used || 0;
    if (usedPost + maxUsd > cap + 1e-9) return { postOver: true, post: p, remaining: Math.max(0, cap - usedPost) };
    const r = (await db.query("insert into hq.ai_reservations (task_id, department, max_usd, model, post) values ($1,$2,$3,$4,$5) returning id", [taskId, department, maxUsd, model, p])).rows[0];
    return { id: r.id };
  });
  if (out.blocked) throw new BudgetError(REASON_LABEL[out.blocked] || "AI niet beschikbaar.", out.blocked);
  if (out.over) throw new BudgetError(`HQ-limiet bereikt: nog $${out.remaining.toFixed(4)} beschikbaar, deze aanroep kan tot $${maxUsd.toFixed(4)} kosten.`, "plafond");
  if (out.postOver) throw new BudgetError(`Budget voor ${POSTS[out.post]} is op voor deze periode (nog $${out.remaining.toFixed(4)}).`, "post");
  return out.id;
}

export async function settle(id, actualUsd, note = null) {
  await q("update hq.ai_reservations set status='verrekend', actual_usd=$2, settled_at=now(), note=$3 where id=$1 and status='gereserveerd'", [id, actualUsd, note]);
}
export async function release(id, note) {
  await q("update hq.ai_reservations set status='vrijgegeven', actual_usd=0, settled_at=now(), note=$2 where id=$1 and status='gereserveerd'", [id, note]);
}

async function setPaused(db, reason) {
  await db.query(`update hq.settings set value = jsonb_set(value, '{paused_reason}', to_jsonb($1::text)), updated_at=now() where key='ai_budget'`, [reason]);
}
export async function markInsufficientCredit() {
  await setPaused({ query: q }, "saldo");
  await audit(null, { label: "systeem", action: "ai.saldo_onvoldoende" });
}

/** Wachtende AI-taken weer in de wachtrij (dezelfde taken; geen nieuwe, dus geen dubbele uitvoer). */
export async function resumeBudgetTasks(db) {
  const st = await aiState(db);
  // Hervatten als AI weer mag, of als AI bewust uit staat (dan werkt de taak met voorbeelddata).
  if (!st.active && !["uit", "geen_sleutel"].includes(st.reason)) return 0;
  const d = db || { query: q };
  let n = (await d.query("update hq.tasks set status='in_wachtrij', pause_reason=null, run_after=now(), updated_at=now() where status='gepauzeerd' and pause_reason='budget' returning id")).rowCount;
  // Post vol: pas hervatten in een nieuwe tegoedperiode (anders pauzeert de taak meteen weer).
  if (st.budget.period_start) n += (await d.query("update hq.tasks set status='in_wachtrij', pause_reason=null, run_after=now(), updated_at=now() where status='gepauzeerd' and pause_reason='budget_post' and updated_at < $1 returning id", [st.budget.period_start])).rowCount;
  return n;
}

const NUM = (v, lo, hi) => { if (v === null || v === "" || v === undefined) return null; const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(400, "ongeldig", `Waarde moet tussen ${lo} en ${hi} liggen.`); return Math.round(n * 100) / 100; };

export async function putBudget(body, auth) {
  const cur = await getBudget();
  const next = { ...cur };
  if ("granted_usd" in body) next.granted_usd = NUM(body.granted_usd, 0, 10000);
  if ("hq_limit_usd" in body) next.hq_limit_usd = NUM(body.hq_limit_usd, 0, 10000);
  if ("console_used_usd" in body) next.console_used_usd = NUM(body.console_used_usd, 0, 10000);
  if (next.granted_usd != null && next.hq_limit_usd != null && next.hq_limit_usd > next.granted_usd) throw new HttpError(400, "ongeldig", "De HQ-limiet mag niet hoger zijn dan het toegekende tegoed.");
  for (const k of ["period_start", "period_end"]) if (k in body) next[k] = body[k] && !Number.isNaN(Date.parse(body[k])) ? new Date(body[k]).toISOString() : null;
  if (next.period_start && next.period_end && new Date(next.period_end) <= new Date(next.period_start)) throw new HttpError(400, "ongeldig", "Het einde van de periode moet na het begin liggen.");
  if ("confirmed" in body) next.confirmed = Boolean(body.confirmed);
  if ("enabled" in body) next.enabled = Boolean(body.enabled);
  // Bevestigen, een hogere limiet of een nieuwe periode heft een pauze op; het systeem pauzeert opnieuw als het nodig is.
  if (body.resume || "hq_limit_usd" in body || "period_end" in body || ("confirmed" in body && next.confirmed)) next.paused_reason = null;
  if (next.enabled && !next.confirmed) next.enabled = false;
  await q("insert into hq.settings (key, value, updated_by, updated_at) values ('ai_budget',$1,$2,now()) on conflict (key) do update set value=excluded.value, updated_by=excluded.updated_by, updated_at=now()", [next, auth.userId]);
  await audit(null, { actor: auth.userId, label: auth.email, action: "ai.budget", details: { van: cur, naar: next } });
  const resumed = await resumeBudgetTasks();
  return { budget: next, resumed };
}

/** Overzicht: gemeten HQ-verbruik per afdeling, apart van onbekend verbruik door andere apps. */
export async function budgetOverview() {
  const st = await aiState();
  const b = st.budget;
  const hq = st.used.settled;
  const other = b.console_used_usd != null ? Math.max(0, Math.round((b.console_used_usd - hq) * 10000) / 10000) : null;
  const waiting = (await one("select count(*)::int n from hq.tasks where status='gepauzeerd' and pause_reason='budget'")).n;
  return {
    active: st.active, reason: st.reason, reasonLabel: st.reason ? REASON_LABEL[st.reason] : "AI actief binnen je HQ-limiet.",
    budget: b, hq_settled_usd: hq, hq_reserved_usd: st.used.reserved, remaining_usd: st.remaining,
    byDepartment: Object.fromEntries(Object.keys(DEPARTMENTS).map(k => [k, { label: DEPARTMENTS[k], usd: st.used.byDept[k]?.settled || 0, calls: st.used.byDept[k]?.calls || 0 }])),
    other_usd: other, other_note: other == null ? "Onbekend: vul het verbruik uit de Anthropic Console in om ander verbruik (andere apps) te zien." : "Verbruik volgens de Console min wat HQ zelf heeft gemeten.",
    waiting_tasks: waiting, key_present: Boolean(env.anthropicKey),
    posts: await postsOverview(b),
  };
}

async function postsOverview(b) {
  const sh = await postShares();
  const used = b.period_start && b.period_end ? await postUsage({ query: q }, b) : {};
  return { learned: sh.learned, note: sh.note, total_paid: sh.total_paid, min_paid: sh.min_paid,
    items: Object.keys(POSTS).map(k => ({ post: k, label: POSTS[k], base_pct: sh.base[k], share_pct: sh.shares[k], cap_usd: b.hq_limit_usd ? Math.round(b.hq_limit_usd * sh.shares[k]) / 100 : null,
      used_usd: Math.round((used[k]?.settled || 0) * 10000) / 10000, calls: used[k]?.calls || 0, paid_clients: sh.paid[k] ?? null })) };
}
