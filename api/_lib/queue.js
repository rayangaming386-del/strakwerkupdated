// Persistente takenwachtrij in Postgres. Geen afhankelijkheid van een open browsertab:
// taken staan in hq.tasks en worden opgepakt door runWorker(), dat draait na het
// inplannen (waitUntil), bij elke HQ-poll als er werk ligt, en via /api/worker (cron).
//
// Garanties:
// - claimen met een advisory lock + FOR UPDATE SKIP LOCKED: nooit twee uitvoerders tegelijk;
// - lease (lease_owner/lease_until): een vastgelopen uitvoering wordt na de time-out
//   als "time_out" afgesloten en eventueel opnieuw ingepland;
// - afronden alleen als de lease nog van deze uitvoerder is (geen dubbele resultaten);
// - beperkte herhaalpogingen, grenzen voor gelijktijdigheid, stappen, kosten en dagbudget;
// - pauzeren/annuleren van een lopende taak pas "gepauzeerd"/"geannuleerd" als de
//   uitvoerder het heeft bevestigd.
import { randomUUID } from "node:crypto";
import { q, one, tx, getPool } from "./db.js";
import { HttpError } from "./http.js";

export const STATUS_LABEL = {
  niet_gekoppeld: "Niet gekoppeld", beschikbaar: "Beschikbaar", in_wachtrij: "In wachtrij", bezig: "Bezig",
  wacht_op_goedkeuring: "Wacht op goedkeuring", afgerond: "Afgerond", gepauzeerd: "Gepauzeerd", mislukt: "Mislukt", geannuleerd: "Geannuleerd",
};

export async function getLimits(db = getPool()) {
  const r = (await db.query("select value from hq.settings where key='limits'")).rows[0];
  return { max_concurrent: 2, task_timeout_s: 45, max_steps: 8, max_attempts: 2, max_cost_usd_per_task: 0.25, daily_budget_usd: 2, ...(r?.value || {}) };
}

export async function event(db, taskId, type, { from = null, to = null, fromAgent = null, toAgent = null, message = "", data = {} } = {}) {
  await db.query(
    "insert into hq.task_events (task_id, type, from_status, to_status, from_agent, to_agent, message, data) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [taskId, type, from, to, fromAgent, toAgent, message, data]);
}

export async function enqueue(db, { agent, kind, title, input = {}, leadId = null, chainId = null, parentId = null, createdBy = null, idempotencyKey = null, pieceId = null, timeoutS = null, runAfter = null, maxAttempts = null }) {
  const limits = await getLimits(db);
  const id = randomUUID();
  const ins = await db.query(
    `insert into hq.tasks (id, agent_key, kind, title, input, lead_id, chain_id, parent_task_id, created_by, idempotency_key, max_attempts, timeout_s, piece_id, run_after)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,coalesce($14::timestamptz, now())) on conflict (idempotency_key) do nothing returning id`,
    [id, agent, kind, title, input, leadId, chainId || id, parentId, createdBy, idempotencyKey, maxAttempts || limits.max_attempts, timeoutS || limits.task_timeout_s, pieceId, runAfter]);
  if (!ins.rowCount) {
    // Zelfde verzoek nogmaals (dubbelklik, herhaald verzoek): bestaande taak teruggeven.
    return { id: (await db.query("select id from hq.tasks where idempotency_key=$1", [idempotencyKey])).rows[0].id, duplicate: true };
  }
  await event(db, id, "status", { to: "in_wachtrij", toAgent: agent, message: "Taak ingepland." });
  if (parentId) {
    const p = (await db.query("select agent_key from hq.tasks where id=$1", [parentId])).rows[0];
    await event(db, id, "overdracht", { fromAgent: p?.agent_key, toAgent: agent, message: `Overgedragen van ${p?.agent_key} naar ${agent}.`, data: { parent_task_id: parentId } });
  }
  return { id, duplicate: false };
}

// Afsluiten van uitvoeringen waarvan de lease verlopen is (worker gecrasht of time-out).
export async function sweepStale() {
  const stale = await q(
    `select id, attempts, max_attempts, agent_key from hq.tasks where status='bezig' and lease_until < now() - interval '5 seconds' limit 20`);
  for (const t of stale.rows) {
    await tx(async (db) => {
      const cur = (await db.query("select status, lease_until, attempts, max_attempts from hq.tasks where id=$1 for update", [t.id])).rows[0];
      if (!cur || cur.status !== "bezig" || new Date(cur.lease_until) > new Date(Date.now() - 5000)) return;
      const retry = cur.attempts < cur.max_attempts;
      await db.query(
        `update hq.tasks set status=$2, lease_owner=null, lease_until=null, run_after=now() + interval '30 seconds',
           error=$3, updated_at=now(), finished_at=case when $2='mislukt' then now() else null end where id=$1`,
        [t.id, retry ? "in_wachtrij" : "mislukt", "Time-out: de uitvoering reageerde niet binnen de tijdslimiet."]);
      await db.query("update hq.task_runs set finished_at=now(), outcome='time_out', error='lease verlopen' where task_id=$1 and finished_at is null", [t.id]);
      await event(db, t.id, "fout", { from: "bezig", to: retry ? "in_wachtrij" : "mislukt", toAgent: t.agent_key, message: retry ? "Time-out; opnieuw ingepland." : "Time-out; maximaal aantal pogingen bereikt." });
    });
  }
  return stale.rowCount;
}

export async function spentTodayUsd(db = getPool()) {
  const r = (await db.query(`select coalesce(sum(cost_usd),0)::float as s from hq.task_runs where started_at >= date_trunc('day', now() at time zone 'Europe/Amsterdam') at time zone 'Europe/Amsterdam'`)).rows[0];
  return r.s;
}

// Welke agents een uitvoerder mag oppakken: de serverloze worker doet alles behalve video
// (renderen vraagt ffmpeg en Chromium); de render-worker doet alleen video.
export function agentFilter({ only = null, exclude = null } = {}, startAt = 1) {
  if (only?.length) return { sql: `and agent_key = any($${startAt}::text[])`, vals: [only] };
  if (exclude?.length) return { sql: `and agent_key <> all($${startAt}::text[])`, vals: [exclude] };
  return { sql: "", vals: [] };
}

export async function claimNext(workerId, filter = {}) {
  return tx(async (db) => {
    await db.query("select pg_advisory_xact_lock(hashtext('hq_task_claim'))");
    const limits = await getLimits(db);
    const f = agentFilter(filter);
    // Renders tellen apart: ze draaien op een eigen machine en houden serverloze taken niet op.
    const running = (await db.query(`select count(*)::int n from hq.tasks where status='bezig' and lease_until > now() ${f.sql}`, f.vals)).rows[0].n;
    if (running >= limits.max_concurrent) return { reason: "gelijktijdigheid" };
    if ((await spentTodayUsd(db)) >= limits.daily_budget_usd) return { reason: "dagbudget" };
    const t = (await db.query(
      `select * from hq.tasks where status='in_wachtrij' and control is null and run_after <= now() ${f.sql}
       order by run_after, created_at limit 1 for update skip locked`, f.vals)).rows[0];
    if (!t) return { reason: "leeg" };
    const upd = (await db.query(
      `update hq.tasks set status='bezig', attempts=attempts+1, lease_owner=$2, lease_until=now() + make_interval(secs => timeout_s + 15),
         started_at=coalesce(started_at, now()), updated_at=now(), error=null where id=$1 returning *`, [t.id, workerId])).rows[0];
    const run = (await db.query("insert into hq.task_runs (task_id, attempt, worker_id) values ($1,$2,$3) returning id", [t.id, upd.attempts, workerId])).rows[0];
    await event(db, t.id, "status", { from: "in_wachtrij", to: "bezig", toAgent: t.agent_key, message: `Uitvoering gestart (poging ${upd.attempts}).`, data: { run_id: run.id } });
    return { task: upd, runId: run.id, limits };
  });
}

export class ControlStop extends Error {
  constructor(kind) { super(kind); this.kind = kind; }
}
export class LimitError extends Error {
  constructor(message) { super(message); this.retryable = false; }
}

// Afronden: alleen als deze uitvoerder de lease nog heeft.
export async function finish(task, runId, workerId, outcome) {
  return tx(async (db) => {
    const cur = (await db.query("select status, lease_owner, control from hq.tasks where id=$1 for update", [task.id])).rows[0];
    if (!cur || cur.status !== "bezig" || cur.lease_owner !== workerId) return false; // lease kwijt: resultaat niet opslaan
    const { status, result = null, error = null, costUsd = 0, usage = null, steps = 0, retry = false, message = "", after, deferS = 0 } = outcome;
    // deferS: de taak wacht op iets buiten HQ (bijv. verwerking bij Instagram). Opnieuw
    // inplannen zonder dat het als mislukte poging telt.
    if (deferS > 0) {
      await db.query(`update hq.tasks set status='in_wachtrij', result=coalesce($2, result), cost_usd=cost_usd+$3, steps=steps+$4, max_attempts=max_attempts+1,
          lease_owner=null, lease_until=null, run_after=now() + make_interval(secs => $5), updated_at=now() where id=$1`, [task.id, result, costUsd || 0, steps, deferS]);
      await db.query("update hq.task_runs set finished_at=now(), outcome='opnieuw', cost_usd=$2 where id=$1", [runId, costUsd || 0]);
      await event(db, task.id, "status", { from: "bezig", to: "in_wachtrij", toAgent: task.agent_key, message: message || `Wacht ${deferS} s op een externe verwerking.` });
      if (after) await after(db);
      return true;
    }
    const finalStatus = retry ? "in_wachtrij" : status;
    await db.query(
      `update hq.tasks set status=$2, result=coalesce($3, result), error=$4, cost_usd=cost_usd+$5, input_tokens=input_tokens+$6, output_tokens=output_tokens+$7,
         steps=steps+$8, lease_owner=null, lease_until=null, control=null, updated_at=now(),
         run_after=case when $9 then now() + make_interval(secs => 30 * attempts) else run_after end,
         finished_at=case when $2 in ('afgerond','mislukt','geannuleerd') then now() else null end
       where id=$1`,
      [task.id, finalStatus, result, error, costUsd || 0, usage?.input_tokens || 0, usage?.output_tokens || 0, steps, retry]);
    const runOutcome = retry ? "opnieuw" : status;
    await db.query("update hq.task_runs set finished_at=now(), outcome=$2, error=$3, cost_usd=$4 where id=$1", [runId, runOutcome, error, costUsd || 0]);
    await event(db, task.id, error ? "fout" : "status", { from: "bezig", to: finalStatus, toAgent: task.agent_key, message: message || (error ? error : "Afgerond.") });
    if (costUsd) await event(db, task.id, "kosten", { toAgent: task.agent_key, message: `Gemeten kosten: $${Number(costUsd).toFixed(4)}`, data: { cost_usd: costUsd, usage } });
    if (after) await after(db);
    return true;
  });
}

export async function readControl(taskId) {
  return (await one("select control from hq.tasks where id=$1", [taskId]))?.control || null;
}

// Besturing vanuit de interface.
export async function requestControl(taskId, action, actor) {
  return tx(async (db) => {
    const t = (await db.query("select * from hq.tasks where id=$1 for update", [taskId])).rows[0];
    if (!t) throw new HttpError(404, "niet_gevonden", "Taak niet gevonden.");
    const label = actor?.email || "onbekend";
    const set = async (status, msg) => {
      await db.query("update hq.tasks set status=$2, control=null, updated_at=now(), finished_at=case when $2='geannuleerd' then now() else finished_at end where id=$1", [taskId, status]);
      await event(db, taskId, "besturing", { from: t.status, to: status, toAgent: t.agent_key, message: `${msg} door ${label}.` });
      return { status, confirmed: true };
    };
    if (action === "annuleren") {
      if (["in_wachtrij", "gepauzeerd", "wacht_op_goedkeuring", "mislukt"].includes(t.status)) {
        if (t.status === "wacht_op_goedkeuring") await db.query("update hq.approvals set status='vervallen', decided_at=now(), decision_note='Taak geannuleerd' where task_id=$1 and status='open'", [taskId]);
        return set("geannuleerd", "Geannuleerd");
      }
      if (t.status === "bezig") {
        await db.query("update hq.tasks set control='annulering_gevraagd', updated_at=now() where id=$1", [taskId]);
        await event(db, taskId, "besturing", { toAgent: t.agent_key, message: `Annulering gevraagd door ${label}; wacht op bevestiging van de uitvoerder.` });
        return { status: "bezig", control: "annulering_gevraagd", confirmed: false };
      }
    }
    if (action === "pauzeren") {
      if (t.status === "in_wachtrij") return set("gepauzeerd", "Gepauzeerd");
      if (t.status === "bezig") {
        await db.query("update hq.tasks set control='pauze_gevraagd', updated_at=now() where id=$1", [taskId]);
        await event(db, taskId, "besturing", { toAgent: t.agent_key, message: `Pauze gevraagd door ${label}; wacht op bevestiging van de uitvoerder.` });
        return { status: "bezig", control: "pauze_gevraagd", confirmed: false };
      }
    }
    if (action === "hervatten" && t.status === "gepauzeerd") return set("in_wachtrij", "Hervat");
    if (action === "opnieuw" && t.status === "mislukt") {
      await db.query("update hq.tasks set max_attempts=attempts+1, run_after=now(), error=null where id=$1", [taskId]);
      return set("in_wachtrij", "Opnieuw ingepland");
    }
    throw new HttpError(409, "ongeldige_overgang", `Actie "${action}" kan niet bij status "${STATUS_LABEL[t.status] || t.status}".`);
  });
}

/** Lease verlengen tijdens een lange uitvoering (render). Geeft false als de lease kwijt is. */
export async function heartbeat(taskId, workerId, seconds) {
  const r = await q("update hq.tasks set lease_until=now() + make_interval(secs => $3), updated_at=now() where id=$1 and status='bezig' and lease_owner=$2", [taskId, workerId, seconds]);
  return r.rowCount === 1;
}
