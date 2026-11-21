// ACQUISITIE: zet geschikte kansen om in een concrete, toegestane benadering.
// Twee aparte vragen per bedrijf: past het bij ons (fit) en mogen we het via dit kanaal
// benaderen (contactgrond, afmeldingen, frequentie, route). Een handmatig verstuurd bericht
// verandert de contactregels niet. Zonder geldige route blijft het onderzoek bewaard en gaan
// terugkerende problemen (anoniem) als input naar Marketing.
import { q, one, tx, audit } from "../db.js";
import { HttpError, assertUuid } from "../http.js";
import { enqueue } from "../queue.js";
import { contactCheck, suppressedFor, getRoutes } from "./contact.js";
import { mailConfigured } from "./mail.js";

export async function fitCheck(lead, db) {
  const d = db || { query: q };
  const reasons = [], plus = [];
  const opp = (await d.query("select * from hq.opportunities where lead_id=$1 and verified<>'klopt_niet' order by (strength='concreet') desc, created_at desc limit 1", [lead.id])).rows[0];
  const inbound = (await d.query("select count(*)::int n from hq.interactions where lead_id=$1 and direction='in'", [lead.id])).rows[0].n;
  if (lead.active_status === "gesloten") reasons.push("bedrijf lijkt niet meer actief");
  if (["gewonnen", "afgemeld", "verloren"].includes(lead.status)) reasons.push(`status: ${lead.status}`);
  if (inbound) reasons.push("er loopt al een gesprek (Sales volgt op)");
  if (opp?.strength === "concreet") plus.push(`concreet probleem: ${opp.observation}`);
  else if (["geen_gevonden", "alleen_sociaal"].includes(lead.website_status)) plus.push(lead.website_status === "geen_gevonden" ? "geen eigen website gevonden" : "alleen een sociaal profiel");
  else reasons.push(opp ? "alleen zwakke signalen (bijv. oudere uitstraling)" : "nog geen concrete kans vastgesteld");
  return { fit: reasons.length === 0, reasons, plus, opportunity: opp || null };
}

/** Eerste bericht: één echte observatie, één bruikbare suggestie, één eenvoudige vraag. */
export function firstMessage(lead, opp, variant = "A") {
  const hi = lead.contact_name ? `Hoi ${lead.contact_name.split(" ")[0]},` : "Hoi,";
  const obs = opp ? opp.observation.replace(/\.$/, "") : `Ik zag dat ${lead.company} nog geen eigen website heeft (alleen ${lead.social_url ? "een sociaal profiel" : "vermeldingen elders"})`;
  const sugg = opp?.service_key === "booking" ? "Met een afspraakknop die op mobiel direct een tijd laat kiezen, kunnen klanten zelf boeken zonder te bellen."
    : opp?.service_key === "aanvraag" ? "Een vaste WhatsApp-knop met een kant-en-klaar bericht maakt contact opnemen op mobiel een stuk makkelijker."
    : opp?.service_key === "calculator" ? "Een overzichtelijke prijslijst of prijscalculator beantwoordt de meest gestelde vraag al op de site."
    : opp?.service_key === "redesign" ? "Een mobiele versie met duidelijke knoppen voor bellen en contact lost dat meestal snel op."
    : "Een eenvoudige eigen site met je diensten, openingstijden en een WhatsApp-knop helpt klanten je direct te vinden.";
  const question = variant === "B" ? "Heb je interesse in een korte schets van hoe dat er voor jou uit zou zien?"
    : opp?.service_key === "booking" ? "Zal ik je laten zien hoe ik die afspraakknop op mobiel zou oplossen?" : "Zal ik je een voorbeeld laten zien van hoe ik dat zou aanpakken?";
  return { subject: `Kleine observatie over ${lead.company}`, body: `${hi}\n\nIk ben Rayan van StrakWerk, webdesign uit Zoetermeer. ${obs} (bekeken op mijn telefoon${opp?.page_url ? `: ${opp.page_url}` : ""}).\n\n${sugg}\n\n${question}` };
}

/**
 * Benadering voorbereiden. Uitkomst per kanaal: automatisch inplannen (route aan en
 * toegestaan), klaarzetten voor handmatig versturen, of niet benaderen (met reden).
 */
export async function prepareApproach(leadId, actor = null) {
  assertUuid(leadId, "klant");
  return tx(async (db) => {
    const lead = (await db.query("select * from hq.leads where id=$1 for update", [leadId])).rows[0];
    if (!lead) throw new HttpError(404, "niet_gevonden", "Klant niet gevonden.");
    const fit = await fitCheck(lead, db);
    const allowed = await contactCheck(lead, "email", { kind: "eerste_contact", db });
    const result = { lead_id: leadId, fit, contact: { allowed: allowed.allowed, reasons: allowed.reasons, consent: allowed.consent }, outreach: null, marketing_input: null };
    if (!fit.fit) return { ...result, decision: "niet_benaderen", why: fit.reasons };
    if (await suppressedFor(lead, db)) return { ...result, decision: "niet_benaderen", why: ["afgemeld of bezwaar"] };
    if (!allowed.consent || !lead.contact_email) {
      // Geen geldige contactroute: onderzoek bewaren, probleem anoniem naar Marketing.
      result.marketing_input = { segment: lead.segment, probleem: fit.opportunity?.goal || lead.website_status };
      await db.query("update hq.leads set priority_reason=$2, updated_at=now() where id=$1", [leadId, `Geschikt, maar geen geldige contactgrond voor e-mail. Onderzoek bewaard; probleem telt mee als input voor Marketing.`]);
      return { ...result, decision: "geen_contactgrond", why: allowed.reasons };
    }
    // Experiment: variant volgens het lopende experiment (één wijziging tegelijk).
    const exp = (await db.query("select * from hq.experiments where status='loopt' and department='acquisitie' order by started_at desc limit 1")).rows[0];
    const variant = exp ? ((await db.query("select count(*)::int n from hq.outreach where experiment_id=$1", [exp.id])).rows[0].n % 2 === 0 ? "A" : "B") : "A";
    const pv = (await db.query("select key, version from hq.prompt_versions where key='acquisitie_eerste_mail' and active order by version desc limit 1")).rows[0];
    const msg = firstMessage(lead, fit.opportunity, variant);
    const routes = await getRoutes(db);
    const auto = routes.email.auto && !routes.email.paused && allowed.allowed;
    const status = auto ? "gepland" : "klaar_handmatig";
    const r = (await db.query(`insert into hq.outreach (lead_id, channel, kind, status, subject, body, to_address, scheduled_at, idempotency_key, prompt_version, experiment_id, variant, is_test)
      values ($1,'email','eerste_contact',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (idempotency_key) do nothing returning *`,
      [leadId, status, msg.subject, msg.body, lead.contact_email, auto ? new Date() : null, `eerste_contact:${leadId}`, pv ? `${pv.key}@v${pv.version}` : null, exp?.id || null, exp ? variant : null, lead.is_test])).rows[0];
    result.outreach = r || (await db.query("select * from hq.outreach where idempotency_key=$1", [`eerste_contact:${leadId}`])).rows[0];
    await audit(db, { actor: actor?.userId || null, label: actor?.email || "agent:acquisitie", action: "acquisitie.voorbereid", entity: "lead", entityId: leadId, details: { besluit: status } });
    return { ...result, decision: auto ? "automatisch_ingepland" : allowed.allowed ? "klaar_om_handmatig_te_versturen" : "klaar_maar_niet_toegestaan", why: allowed.reasons };
  });
}

/** Geplande berichten waarvan het moment is aangebroken: één verzendtaak per bericht. */
export async function enqueueDueOutreach() {
  const due = (await q("select id, lead_id from hq.outreach where status='gepland' and scheduled_at <= now() and task_id is null order by scheduled_at limit 25")).rows;
  let n = 0;
  for (const o of due) {
    await tx(async (db) => {
      const t = await enqueue(db, { agent: "acquisitie", kind: "send_outreach", title: "Bericht versturen", input: { outreach_id: o.id }, leadId: o.lead_id, idempotencyKey: `send:${o.id}`, timeoutS: 30, maxAttempts: 2 });
      await db.query("update hq.outreach set task_id=$2 where id=$1 and task_id is null", [o.id, t.id]);
      n++;
    });
  }
  return n;
}

/** Terugkerende problemen (anoniem, per segment) als input voor Marketing. */
export async function marketingInsights(days = 60, { test = false } = {}) {
  const r = (await q(`select coalesce(l.segment,'onbekend') as segment, o.goal, count(distinct o.lead_id)::int as bedrijven, min(o.observation) as voorbeeld
     from hq.opportunities o join hq.leads l on l.id=o.lead_id where o.strength='concreet' and o.verified<>'klopt_niet' and o.created_at > now() - make_interval(days => $1) and l.is_test=$2
     group by 1, 2 having count(distinct o.lead_id) >= 2 order by 3 desc limit 10`, [days, test])).rows;
  const nosite = (await q(`select coalesce(segment,'onbekend') as segment, count(*)::int as bedrijven from hq.leads where website_status in ('geen_gevonden','alleen_sociaal') and is_test=$1 group by 1 having count(*) >= 2`, [test])).rows;
  return { problemen: r.map(x => ({ segment: x.segment, doel: x.goal, bedrijven: x.bedrijven })), zonder_website: nosite };
}

/** Uitvoerder (agent acquisitie): verstuurt één gepland bericht, met controle vlak ervoor. */
export const KIND = "send_outreach";
export async function run({ task, ctx }) {
  const { sendMail, mailConfigured: mc, MailError } = await import("./mail.js");
  const id = task.input?.outreach_id;
  const o = await one("select * from hq.outreach where id=$1", [id]);
  if (!o) throw Object.assign(new Error("Bericht niet gevonden."), { retryable: false });
  if (o.status !== "gepland") return { status: "afgerond", result: { overgeslagen: o.status }, message: `Niets te doen (${o.status}).` };
  const lead = await one("select * from hq.leads where id=$1", [o.lead_id]);
  await ctx.step("Controleren of er intussen iets veranderd is");
  const cancel = async (why) => { await q("update hq.outreach set status='geannuleerd', cancel_reason=$2, updated_at=now() where id=$1 and status='gepland'", [id, why]); return { status: "afgerond", result: { geannuleerd: why }, message: `Niet verstuurd: ${why}` }; };
  if (["opvolging", "offerte_opvolging", "eerste_contact"].includes(o.kind)) {
    // Reactie na ons laatste verstuurde bericht (of na het inplannen): standaardopvolging vervalt.
    const replied = await one(`select 1 from hq.interactions where lead_id=$1 and direction='in' and at > least($2::timestamptz,
        coalesce((select max(sent_at) from hq.outreach where lead_id=$1 and id<>$3 and status in ('verzonden','test_verzonden','handmatig_verzonden')), $2::timestamptz)) limit 1`, [o.lead_id, o.created_at, o.id]);
    if (replied) return cancel("klant reageerde intussen");
  }
  if (o.quote_id) {
    const qu = await one("select status from hq.quotes where id=$1", [o.quote_id]);
    if (qu && qu.status !== "verstuurd") return cancel(`offerte is ${qu.status}`);
  }
  const check = await contactCheck(lead, o.channel, { kind: o.kind });
  if (!check.allowed) {
    if (check.reasons.some(r => /afgemeld|geblokkeerd|contactgrond/.test(r))) return cancel(check.reasons.join("; "));
    return { deferS: 3 * 3600, message: `Nog niet: ${check.reasons.join("; ")}` };
  }
  // Claim: van gepland naar verzenden (precies één uitvoerder).
  const claim = await q("update hq.outreach set status='verzenden', updated_at=now() where id=$1 and status='gepland'", [id]);
  if (!claim.rowCount) return { status: "afgerond", message: "Al door een andere uitvoering opgepakt." };
  const routes = await getRoutes();
  if (o.channel !== "email") {
    // WhatsApp/telefoon: geen gratis automatische route. Klaarzetten met kopieerknop en link.
    await q("update hq.outreach set status='klaar_handmatig', updated_at=now() where id=$1", [id]);
    return { status: "afgerond", result: { handmatig: true }, message: "Klaargezet om zelf te versturen (geen automatische route voor dit kanaal)." };
  }
  const live = o.channel === "email" && routes.email.live && mc() && !lead.is_test && !o.is_test;
  if (!live) {
    // Proef of testgegevens: niets verstuurd, wel vastgelegd en als TEST zichtbaar.
    await q("update hq.outreach set status='test_verzonden', sent_at=now(), provider_id=$2, updated_at=now() where id=$1", [id, `<test-${id}@hq.strakwerkk.nl>`]);
    await afterSent(o, lead, `<test-${id}@hq.strakwerkk.nl>`, true);
    return { status: "afgerond", result: { test: true }, message: "TEST: niet echt verstuurd (live staat uit of testgegevens)." };
  }
  try {
    const r = await sendMail({ outreachId: id, leadId: lead.id, to: o.to_address, subject: o.subject, text: o.body });
    await q("update hq.outreach set status='verzonden', sent_at=now(), provider_id=$2, updated_at=now() where id=$1", [id, r.messageId]);
    await afterSent(o, lead, r.messageId, false);
    return { status: "afgerond", result: { message_id: r.messageId }, message: "Verstuurd." };
  } catch (e) {
    if (e instanceof MailError && e.ambiguous) {
      // Onduidelijk: niet automatisch opnieuw (risico op dubbele mail). Rayan controleert de map Verzonden.
      await q("update hq.outreach set status='onzeker', last_error=$2, updated_at=now() where id=$1", [id, `${e.message} Controleer in Verzonden op Message-ID ${`<${id}@hq.strakwerkk.nl>`}.`]);
      return { status: "afgerond", message: "Uitkomst onduidelijk; eerst controleren voordat er opnieuw wordt verstuurd." };
    }
    await q("update hq.outreach set status=$3, last_error=$2, updated_at=now() where id=$1", [id, e.message, e.retryable ? "gepland" : "mislukt"]);
    throw Object.assign(new Error(e.message), { retryable: Boolean(e.retryable) });
  }
}

async function afterSent(o, lead, messageId, test) {
  await q("insert into hq.interactions (lead_id, direction, channel, kind, subject, body, outreach_id, quote_id, is_test, created_label) values ($1,'uit',$2,'bericht',$3,$4,$5,$6,$7,$8)",
    [lead.id, o.channel, (test ? "[TEST] " : "") + (o.subject || o.kind), o.body, o.id, o.quote_id, test || lead.is_test, "agent:acquisitie"]);
  await q("update hq.leads set last_outbound_at=now(), status=case when $2 and status in ('nieuw','onderzocht','goedgekeurd') then 'benaderd' else status end, updated_at=now() where id=$1", [lead.id, o.kind === "eerste_contact"]);
  // Na het eerste contact: hooguit één opvolging, alleen als er geen reactie komt (gecontroleerd vlak voor verzenden).
  if (o.kind === "eerste_contact") {
    await q(`insert into hq.outreach (lead_id, channel, kind, sequence, status, subject, body, to_address, scheduled_at, idempotency_key, is_test)
      values ($1,$2,'opvolging',1,'gepland',$3,$4,$5,now() + interval '7 days',$6,$7) on conflict (idempotency_key) do nothing`,
      [lead.id, o.channel, `Re: ${o.subject}`, `Hoi${lead.contact_name ? ` ${lead.contact_name.split(" ")[0]}` : ""},\n\nIk stuurde je vorige week een korte observatie over je website. Is het handig als ik het in twee minuten laat zien? Zo niet, dan hoor je verder niets van me.\n\nGroet,\nRayan`,
       o.to_address, `opvolging:${lead.id}:1`, o.is_test]);
  }
}
export { mailConfigured };

/**
 * Testmail naar de eigenaar zelf (echte verzending, ook als "live" uit staat): bewijst dat
 * versturen, antwoord koppelen en opvolging stoppen werken. Alleen naar het e-mailadres van
 * de ingelogde eigenaar; de testklant is gemarkeerd als testgegevens.
 */
export async function sendSelfTest(auth) {
  const { sendMail, mailConfigured: mc, mailRoute, replyTo } = await import("./mail.js");
  if (!mc()) throw new HttpError(409, "niet_gekoppeld", "E-mail is nog niet gekoppeld.", { missing: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"] });
  const to = String(auth?.email || "").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(to)) throw new HttpError(400, "ongeldig", "Je account heeft geen geldig e-mailadres.");
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const { lead, o } = await tx(async (db) => {
    let lead = (await db.query("select * from hq.leads where lower(contact_email)=$1 and is_test and company like 'Mailtest%' order by created_at desc limit 1", [to])).rows[0];
    if (!lead) lead = (await db.query(`insert into hq.leads (company, company_key, source, contact_name, contact_email, status, is_test, notes) values ('Mailtest StrakWerk HQ','mailtest-strakwerk-hq','handmatig','Rayan',$1,'benaderd',true,'Testklant voor de e-mailkoppeling (eigen adres).') returning *`, [to])).rows[0];
    await db.query("update hq.outreach set status='geannuleerd', cancel_reason='Nieuwe mailtest' where lead_id=$1 and status in ('gepland','concept')", [lead.id]);
    const has = (await db.query("select 1 from hq.consents where lead_id=$1 and channel='email' and revoked_at is null", [lead.id])).rows[0];
    if (!has) await db.query("insert into hq.consents (lead_id, channel, basis, source, scope, evidence, recorded_by) values ($1,'email','toestemming','Eigen adres van de eigenaar','Testberichten van HQ','Eigenaar start zelf de mailtest vanuit HQ.',$2)", [lead.id, auth.userId]);
    const o = (await db.query(`insert into hq.outreach (lead_id, channel, kind, status, subject, body, to_address, idempotency_key, is_test) values ($1,'email','eerste_contact','verzenden',$2,$3,$4,$5,true) returning *`,
      [lead.id, `Mailtest StrakWerk HQ (${stamp})`, `Hoi Rayan,\n\nDit is een test van de e-mailkoppeling van HQ. Antwoord met een korte tekst (bijv. "Wat kost dat?"): dat antwoord hoort op de klantkaart "Mailtest StrakWerk HQ" te verschijnen, en de geplande opvolging hoort dan vanzelf te stoppen.\n\nGroet,\nHQ`, to, `mailtest:${lead.id}:${Date.now()}`])).rows[0];
    return { lead, o };
  });
  try {
    const r = await sendMail({ outreachId: o.id, leadId: lead.id, to, subject: o.subject, text: o.body });
    await q("update hq.outreach set status='verzonden', sent_at=now(), provider_id=$2, updated_at=now() where id=$1", [o.id, r.messageId]);
    await afterSent(o, lead, r.messageId, false);
    await audit(null, { actor: auth.userId, label: auth.email, action: "mailtest.verstuurd", entity: "lead", entityId: lead.id, details: { route: mailRoute() } });
    return { ok: true, lead_id: lead.id, outreach_id: o.id, message_id: r.messageId, route: mailRoute(), reply_to: replyTo(), followup: "gepland (stopt als je antwoordt)" };
  } catch (e) {
    await q("update hq.outreach set status=$2, last_error=$3, updated_at=now() where id=$1", [o.id, e.ambiguous ? "onzeker" : "mislukt", String(e.message).slice(0, 300)]);
    throw new HttpError(502, "mail", e.message);
  }
}
