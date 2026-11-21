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
export async function reserve({ department, taskId = null, maxUsd, model }) {
  const out = await tx(async (db) => {
    await db.query("select pg_advisory_xact_lock(hashtext('hq_ai_budget'))");
    const st = await aiState(db);
    if (!st.active) return { blocked: st.reason };
    if (st.used.settled + st.used.reserved + maxUsd > st.budget.hq_limit_usd + 1e-9) {
      // Plafond: pauze vastleggen (blijft staan na deze transactie) en niets reserveren.
      await setPaused(db, "plafond");
      return { over: true, remaining: st.remaining };
    }
    const r = (await db.query("insert into hq.ai_reservations (task_id, department, max_usd, model) values ($1,$2,$3,$4) returning id", [taskId, department, maxUsd, model])).rows[0];
    return { id: r.id };
  });
  if (out.blocked) throw new BudgetError(REASON_LABEL[out.blocked] || "AI niet beschikbaar.", out.blocked);
  if (out.over) throw new BudgetError(`HQ-limiet bereikt: nog $${out.remaining.toFixed(4)} beschikbaar, deze aanroep kan tot $${maxUsd.toFixed(4)} kosten.`, "plafond");
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
  return (await (db || { query: q }).query("update hq.tasks set status='in_wachtrij', pause_reason=null, run_after=now(), updated_at=now() where status='gepauzeerd' and pause_reason='budget' returning id")).rowCount;
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
  };
}
