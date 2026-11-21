// Uitvoerders voor de nieuwe taaksoorten van Scout (ontdekken) en Auditor (verkoopkans).
// De bestaande taaksoorten (lead_onderzoek, website_analyse) blijven ongewijzigd werken.
import { q, one } from "../db.js";
import { discover } from "./discover.js";
import { salesCheck, saveObservations, briefingFrom } from "./salescheck.js";
import { scoreLead } from "./discover.js";

export async function runDiscover({ task, ctx }) {
  const { segment, city, limit = 15 } = task.input || {};
  if (!segment || !city) throw Object.assign(new Error("Segment en plaats zijn verplicht."), { retryable: false });
  await ctx.step(`OpenStreetMap doorzoeken: ${segment} in ${city}`);
  const r = await discover({ segment, city, limit: Math.min(Number(limit) || 15, 40), isTest: Boolean(task.input?.is_test) });
  return { status: "afgerond", result: { ...r, segment, city }, message: `${r.new.length} nieuw, ${r.existing.length} al in HQ, ${r.skipped.length} overgeslagen (van ${r.found} gevonden).` };
}

export async function runSalesCheck({ task, lead, ctx }) {
  const url = task.input?.url || lead?.website;
  if (!url) throw Object.assign(new Error("Geen website om te controleren."), { retryable: false });
  const r = await salesCheck(url, { step: (m) => ctx.step(m) });
  if (r.skipped) return { status: "afgerond", result: r, message: r.skipped };
  if (lead) {
    await saveObservations(lead.id, task.id, r.observations);
    const concrete = r.observations.some(o => o.strength === "concreet");
    const briefing = briefingFrom(lead.company, r.observations);
    const seg = lead.segment ? await one("select active from hq.segments where key=$1", [lead.segment]) : null;
    const sc = scoreLead({ segmentActive: seg?.active ?? true, websiteStatus: lead.website_status || "gevonden", concrete, hasContact: Boolean(lead.contact_email || lead.contact_phone), active: true });
    await q("update hq.leads set fit_score=$2, priority=$3, priority_reason=$4, active_status=coalesce(nullif(active_status,'onzeker'),'actief'), updated_at=now() where id=$1",
      [lead.id, sc.score, sc.priority, briefing ? `${briefing.probleem} → ${briefing.dienst} (${sc.reason})` : `Geen concreet probleem gevonden (${sc.reason})`]);
    return { status: "afgerond", result: { ...r, briefing }, message: concrete ? `Concreet probleem gevonden: ${briefing.probleem}` : r.observations.length ? "Alleen zwakke signalen." : "Geen problemen in de mobiele klantroute gevonden." };
  }
  if (task.input?.project_id) {
    // Oplevercontrole: uitkomst bij het project (Rayan beslist over opleveren).
    const concrete = r.observations.filter(o => o.strength === "concreet");
    await q("insert into hq.project_history (project_id, actor_label, to_status, note) select id, 'agent:auditor', status, $2 from hq.projects where id=$1",
      [task.input.project_id, concrete.length ? `Oplevercontrole: ${concrete.length} punt(en) eerst oplossen: ${concrete.map(o => o.observation).join(" | ").slice(0, 600)}` : "Oplevercontrole: geen concrete problemen in de mobiele klantroute."]);
  }
  return { status: "afgerond", result: r, message: `${r.observations.length} observatie(s).` };
}
