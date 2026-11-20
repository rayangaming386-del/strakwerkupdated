// Uitvoerproces voor de takenwachtrij. Draait binnen een Vercel-functie (na het inplannen
// via waitUntil, of via /api/worker door cron) en houdt zich aan een tijdsbudget.
import { randomUUID, createHash } from "node:crypto";
import { q, one, getPool } from "./db.js";
import { claimNext, finish, sweepStale, readControl, enqueue, event, ControlStop, LimitError, agentFilter } from "./queue.js";
import { EXECUTORS, connection } from "./agents/registry.js";
import { LlmError } from "./agents/llm.js";
import { FetchError } from "./agents/fetcher.js";

export function stableHash(obj) {
  const canon = (v) => Array.isArray(v) ? `[${v.map(canon).join(",")}]`
    : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`
    : JSON.stringify(v ?? null);
  return createHash("sha256").update(canon(obj)).digest("hex");
}

async function chainResults(task) {
  const r = await q("select agent_key, result from hq.tasks where chain_id=$1 and id<>$2 and result is not null order by created_at", [task.chain_id, task.id]);
  return Object.fromEntries(r.rows.map(x => [x.agent_key, x.result]));
}

async function runOne(claim, workerId) {
  const { task, runId, limits } = claim;
  const exec = EXECUTORS[task.agent_key];
  const conn = connection(task.agent_key);
  let cost = 0, steps = 0, usage = { input_tokens: 0, output_tokens: 0 };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("timeout")), task.timeout_s * 1000);
  const ctx = {
    signal: ac.signal,
    chain: await chainResults(task),
    async step(message, data = {}) {
      steps++;
      if (steps > limits.max_steps) throw new LimitError(`Stappenlimiet bereikt (${limits.max_steps}).`);
      if (ac.signal.aborted) throw new LimitError(`Tijdslimiet bereikt (${task.timeout_s} s).`);
      await event(getPool(), task.id, "stap", { toAgent: task.agent_key, message, data });
      await ctx.checkControl();
    },
    async checkControl() {
      const c = await readControl(task.id);
      if (c === "annulering_gevraagd") throw new ControlStop("annuleren");
      if (c === "pauze_gevraagd") throw new ControlStop("pauzeren");
    },
    async llm(promise) {
      try {
        const r = await promise;
        cost += r.costUsd || 0;
        usage.input_tokens += r.usage?.input_tokens || 0; usage.output_tokens += r.usage?.output_tokens || 0;
        if (cost > limits.max_cost_usd_per_task) throw new LimitError(`Kostenlimiet per taak bereikt ($${limits.max_cost_usd_per_task}).`);
        return r;
      } catch (e) {
        if (e instanceof LlmError && e.usage) { usage.input_tokens += e.usage.input_tokens || 0; usage.output_tokens += e.usage.output_tokens || 0; }
        throw e;
      }
    },
  };

  try {
    if (!exec || !conn.connected) throw new LimitError(`Agent ${task.agent_key} is niet gekoppeld${conn.missing?.length ? ` (ontbreekt: ${conn.missing.join(", ")})` : ""}.`);
    const lead = task.lead_id ? await one("select * from hq.leads where id=$1", [task.lead_id]) : null;
    const out = await exec.run({ task, lead, ctx });
    clearTimeout(timer);
    await finish(task, runId, workerId, {
      status: out.status, result: out.result, costUsd: cost, usage, steps, deferS: out.deferS || 0,
      message: out.message || (out.status === "wacht_op_goedkeuring" ? "Resultaat klaar; wacht op goedkeuring." : "Afgerond."),
      after: async (db) => {
        if (out.afterTx) await out.afterTx(db);
        for (const n of out.next || []) {
          await enqueue(db, { agent: n.agent, kind: n.kind, title: n.title, input: n.input, leadId: task.lead_id, chainId: task.chain_id, parentId: task.id, createdBy: task.created_by, idempotencyKey: `${task.id}:${n.agent}` });
        }
        if (out.approval) {
          const a = out.approval;
          await db.query(
            "insert into hq.approvals (kind, task_id, lead_id, title, proposal, proposal_hash, rationale) values ($1,$2,$3,$4,$5,$6,$7)",
            [a.kind, task.id, task.lead_id, a.title, a.proposal, stableHash(a.proposal), a.rationale || {}]);
        }
        if (task.agent_key === "auditor" && task.lead_id) {
          await db.query("update hq.leads set status='onderzocht', updated_at=now() where id=$1 and status='nieuw'", [task.lead_id]);
          await db.query("insert into hq.lead_history (lead_id, actor_label, from_status, to_status, note) select $1, 'agent:auditor', 'nieuw', 'onderzocht', 'Website onderzocht' where exists (select 1 from hq.leads where id=$1 and status='onderzocht')", [task.lead_id]);
        }
      },
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof ControlStop) {
      const status = e.kind === "annuleren" ? "geannuleerd" : "gepauzeerd";
      await finish(task, runId, workerId, { status, costUsd: cost, usage, steps, message: `${status === "geannuleerd" ? "Annulering" : "Pauze"} bevestigd door de uitvoerder.`,
        after: async (db) => { if (status === "gepauzeerd") await db.query("update hq.tasks set attempts=greatest(attempts-1,0) where id=$1", [task.id]); } });
      return;
    }
    const retryable = !(e instanceof LimitError) && e.retryable !== false &&
      (e instanceof FetchError ? ["timeout", "net", "ECONNRESET", "ETIMEDOUT"].includes(e.code) : e instanceof LlmError ? /Limiet|niet bereikbaar|API-fout 5/.test(e.message) : e.retryable === true);
    const retry = retryable && task.attempts < task.max_attempts;
    const msg = String(e.message || e).slice(0, 500);
    await finish(task, runId, workerId, { status: "mislukt", error: msg, costUsd: cost, usage, steps, retry, message: retry ? `Mislukt: ${msg} Opnieuw ingepland.` : `Mislukt: ${msg}`,
      after: async (db) => { if (exec?.onFailure) await exec.onFailure(db, task, { message: msg, retry }); } });
  }
}

let lastKick = 0;
/** Verwerkt taken tot de wachtrij leeg is of het tijdsbudget op is. */
// De serverloze worker pakt nooit video-taken op: die vragen ffmpeg/Chromium (render-worker).
export const SERVERLESS_FILTER = { exclude: ["video"] };

export async function runWorker({ budgetMs = 50_000, source = "onbekend", filter = SERVERLESS_FILTER } = {}) {
  const workerId = `${source}:${randomUUID().slice(0, 8)}`;
  const started = Date.now();
  let processed = 0, reason = "leeg";
  await sweepStale();
  while (Date.now() - started < budgetMs) {
    const remaining = budgetMs - (Date.now() - started);
    const f = agentFilter(filter);
    const peek = await one(`select timeout_s from hq.tasks where status='in_wachtrij' and control is null and run_after<=now() ${f.sql} order by run_after, created_at limit 1`, f.vals);
    if (!peek) { reason = "leeg"; break; }
    if (peek.timeout_s * 1000 > remaining) { reason = "tijdsbudget"; break; }
    const claim = await claimNext(workerId, filter);
    if (!claim.task) { reason = claim.reason; break; }
    await runOne(claim, workerId);
    processed++;
  }
  return { workerId, processed, reason, ms: Date.now() - started };
}

/** Licht "aanstoten" vanuit een HQ-poll: alleen als er werk ligt, hooguit eens per 10 s per instantie. */
export async function kickIfNeeded(waitUntil) {
  if (Date.now() - lastKick < 10_000) return false;
  const pending = await one("select 1 from hq.tasks where agent_key<>'video' and ((status='in_wachtrij' and run_after<=now() and control is null) or (status='bezig' and lease_until < now())) limit 1");
  if (!pending) return false;
  lastKick = Date.now();
  waitUntil(runWorker({ source: "poll", budgetMs: 50_000 }).catch(e => console.error(`[worker] ${e.message}`)));
  return true;
}

