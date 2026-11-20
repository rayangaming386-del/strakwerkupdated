// Centrale goedkeuringsinbox. Een goedkeuring geldt voor precies het beoordeelde voorstel
// (vastgelegd met een hash) en wordt één keer gebruikt. Aanpassen = de aangepaste versie
// wordt het goedgekeurde voorstel; latere wijzigingen vragen een nieuwe goedkeuring.
import { q, one, tx, audit } from "./db.js";
import { HttpError, str, assertUuid } from "./http.js";
import { can } from "./auth.js";
import { enqueue, event } from "./queue.js";
import { stableHash } from "./worker.js";
import { guard } from "./agents/sales.js";

// Ervaringspunten: alleen na goedkeuring, voor bruikbare resultaten. Niet voor aantallen
// berichten, tokens of "actief zijn".
const XP = {
  onderzoek: { scout: 10, auditor: { ongewijzigd: 20, aangepast: 10 } },
  bericht: { sales: { ongewijzigd: 30, aangepast: 15 } },
};

async function award(db, agent, taskId, approvalId, points, reason) {
  if (!taskId || points <= 0) return;
  await db.query("insert into hq.xp_ledger (agent_key, task_id, approval_id, points, reason) values ($1,$2,$3,$4,$5) on conflict (agent_key, task_id) do nothing",
    [agent, taskId, approvalId, points, reason]);
}

export async function listApprovals(status = "open") {
  const st = ["open", "goedgekeurd", "afgewezen", "vervallen"].includes(status) ? status : "open";
  return (await q(`select a.*, l.company, m.email as decided_by_email, t.agent_key
    from hq.approvals a left join hq.leads l on l.id=a.lead_id left join hq.members m on m.user_id=a.decided_by left join hq.tasks t on t.id=a.task_id
    where a.status=$1 order by a.requested_at ${st === "open" ? "asc" : "desc"} limit 100`, [st])).rows;
}

export async function decide(id, body, auth) {
  assertUuid(id);
  const decision = String(body.decision || "");
  if (!["goedkeuren", "afwijzen"].includes(decision)) throw new HttpError(400, "ongeldig", "Kies goedkeuren of afwijzen.");
  const note = str(body.note, 1000);
  return tx(async (db) => {
    const a = (await db.query("select * from hq.approvals where id=$1 for update", [id])).rows[0];
    if (!a) throw new HttpError(404, "niet_gevonden", "Goedkeuring niet gevonden.");
    if (a.status !== "open") throw new HttpError(409, "al_besloten", "Over dit voorstel is al besloten.");
    if (!can(auth.role, a.kind === "offerte" ? "approvals.money" : "approvals.decide")) throw new HttpError(403, "onvoldoende_rechten", "Je rol mag dit voorstel niet beoordelen.");
    // Optimistische controle: de beoordelaar moet het voorstel hebben gezien dat nu in de database staat.
    if (body.proposal_hash && body.proposal_hash !== a.proposal_hash) throw new HttpError(409, "gewijzigd", "Het voorstel is intussen gewijzigd. Vernieuw de pagina.");

    let final = a.proposal, edited = false;
    if (decision === "goedkeuren" && body.edited && a.kind === "bericht") {
      const onderwerp = str(body.edited.onderwerp, 200), bericht = str(body.edited.bericht, 4000);
      if (!onderwerp || !bericht) throw new HttpError(400, "ongeldig", "Onderwerp en bericht zijn verplicht.");
      const problems = guard(`${onderwerp}\n${bericht}`);
      if (problems.length) throw new HttpError(400, "controle", `Aangepast bericht ${problems.join(", ")}.`);
      if (onderwerp !== a.proposal.onderwerp || bericht !== a.proposal.bericht) { final = { ...a.proposal, onderwerp, bericht }; edited = true; }
    }
    const status = decision === "goedkeuren" ? "goedgekeurd" : "afgewezen";
    await db.query(`update hq.approvals set status=$2, final_proposal=$3, final_hash=$4, edited=$5, decided_by=$6, decided_at=now(), decision_note=$7 where id=$1`,
      [id, status, status === "goedgekeurd" ? final : null, status === "goedgekeurd" ? stableHash(final) : null, edited, auth.userId, note]);

    if (a.task_id) {
      const t = (await db.query("select * from hq.tasks where id=$1 for update", [a.task_id])).rows[0];
      if (t && t.status === "wacht_op_goedkeuring") {
        await db.query("update hq.tasks set status='afgerond', finished_at=now(), updated_at=now() where id=$1", [t.id]);
        await event(db, t.id, "status", { from: "wacht_op_goedkeuring", to: "afgerond", toAgent: t.agent_key,
          message: status === "goedgekeurd" ? `Goedgekeurd${edited ? " (aangepast)" : ""} door ${auth.email}.` : `Afgewezen door ${auth.email}${note ? `: ${note}` : "."}` });
      }
      if (status === "goedgekeurd" && t) {
        const how = edited ? "aangepast" : "ongewijzigd";
        if (a.kind === "onderzoek") {
          const scoutTask = (await db.query("select id from hq.tasks where chain_id=$1 and agent_key='scout' and status='afgerond' limit 1", [t.chain_id])).rows[0];
          if (scoutTask) await award(db, "scout", scoutTask.id, id, XP.onderzoek.scout, "Lead-onderzoek bruikbaar bevonden");
          await award(db, "auditor", t.id, id, XP.onderzoek.auditor[how], "Website-analyse goedgekeurd");
          if (a.lead_id) {
            await db.query("update hq.leads set status='goedgekeurd', updated_at=now() where id=$1 and status in ('nieuw','onderzocht')", [a.lead_id]);
            await db.query("insert into hq.lead_history (lead_id, actor, actor_label, to_status, note) values ($1,$2,$3,'goedgekeurd','Onderzoek goedgekeurd voor benadering')", [a.lead_id, auth.userId, auth.email]);
          }
          // Overdracht naar Sales, alleen met het goedgekeurde onderzoek.
          await enqueue(db, { agent: "sales", kind: "bericht_concept", title: `Berichtconcept ${final.bedrijf || ""}`.trim(),
            input: { onderzoek: final, onderzoek_approval_id: id }, leadId: a.lead_id, chainId: t.chain_id, parentId: t.id, createdBy: auth.userId, idempotencyKey: `${id}:sales` });
        }
        if (a.kind === "bericht") await award(db, "sales", t.id, id, XP.bericht.sales[how], edited ? "Berichtconcept goedgekeurd na aanpassing" : "Berichtconcept ongewijzigd goedgekeurd");
      }
    }
    await audit(db, { actor: auth.userId, label: auth.email, action: `goedkeuring.${status}`, entity: "approval", entityId: id, details: { soort: a.kind, aangepast: edited, hash: a.proposal_hash } });
    return { status, edited, enqueuedSales: status === "goedgekeurd" && a.kind === "onderzoek" };
  });
}

// "Gebruiken" van een goedkeuring: precies één keer, voor de goedgekeurde versie.
export async function markUsed(id, auth) {
  assertUuid(id);
  return tx(async (db) => {
    const a = (await db.query("select * from hq.approvals where id=$1 for update", [id])).rows[0];
    if (!a) throw new HttpError(404, "niet_gevonden", "Goedkeuring niet gevonden.");
    if (a.status !== "goedgekeurd") throw new HttpError(409, "niet_goedgekeurd", "Alleen een goedgekeurd voorstel kan worden gebruikt.");
    if (a.used_at) throw new HttpError(409, "al_gebruikt", "Deze goedkeuring is al gebruikt. Voor een nieuwe actie is een nieuwe goedkeuring nodig.");
    if (!can(auth.role, a.kind === "offerte" ? "approvals.money" : "approvals.decide")) throw new HttpError(403, "onvoldoende_rechten", "Je rol mag dit niet.");
    await db.query("update hq.approvals set used_at=now() where id=$1", [id]);
    if (a.kind === "bericht" && a.lead_id) {
      const r = (await db.query("update hq.leads set status='benaderd', updated_at=now() where id=$1 and status in ('nieuw','onderzocht','goedgekeurd') returning id", [a.lead_id])).rows[0];
      if (r) await db.query("insert into hq.lead_history (lead_id, actor, actor_label, to_status, note) values ($1,$2,$3,'benaderd','Goedgekeurd bericht handmatig verstuurd')", [a.lead_id, auth.userId, auth.email]);
    }
    if (a.kind === "offerte") {
      await db.query("update hq.quotes set status='verstuurd', sent_at=now() where id=$1 and status='concept'", [a.final_proposal?.quote_id || a.proposal.quote_id]);
      if (a.lead_id) await db.query("update hq.leads set status='offerte', updated_at=now() where id=$1 and status not in ('gewonnen','verloren','offerte')", [a.lead_id]);
    }
    await audit(db, { actor: auth.userId, label: auth.email, action: "goedkeuring.gebruikt", entity: "approval", entityId: id, details: { soort: a.kind, hash: a.final_hash } });
    return { ok: true };
  });
}

// Missies en mijlpalen: afgeleid van echte, goedgekeurde resultaten.
export async function progress() {
  const [xp, counts] = await Promise.all([
    q("select agent_key, sum(points)::int as xp, count(*)::int as n from hq.xp_ledger group by 1"),
    one(`select
      (select count(*)::int from hq.approvals where kind='onderzoek' and status='goedgekeurd') as onderzoek_ok,
      (select count(*)::int from hq.approvals where kind='bericht' and status='goedgekeurd') as bericht_ok,
      (select count(*)::int from hq.approvals where kind='bericht' and status='goedgekeurd' and not edited) as bericht_ongewijzigd,
      (select count(distinct l.id)::int from hq.leads l join hq.tasks t on t.lead_id=l.id where l.status='gewonnen') as gewonnen_na_keten`),
  ]);
  const missions = [
    { key: "eerste_keten", title: "Eerste complete keten", detail: "Scout → Auditor → Sales, met goedgekeurd bericht", goal: 1, value: counts.bericht_ok },
    { key: "vijf_onderzoeken", title: "Vijf goedgekeurde onderzoeken", detail: "Onderzoek dat bruikbaar is bevonden", goal: 5, value: counts.onderzoek_ok },
    { key: "foutloos", title: "Drie berichten zonder aanpassing", detail: "Concept in één keer goed", goal: 3, value: counts.bericht_ongewijzigd },
    { key: "opdracht", title: "Eerste opdracht na een agentketen", detail: "Lead met agenttaken die gewonnen is", goal: 1, value: counts.gewonnen_na_keten },
  ].map(m => ({ ...m, done: m.value >= m.goal }));
  const level = (x) => x >= 500 ? 4 : x >= 250 ? 3 : x >= 100 ? 2 : 1;
  return { agents: Object.fromEntries(xp.rows.map(r => [r.agent_key, { xp: r.xp, level: level(r.xp), awards: r.n }])), missions };
}
