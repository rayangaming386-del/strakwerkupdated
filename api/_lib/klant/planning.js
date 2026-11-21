// TEAMLEIDER + GROEI & PLANNING: elke ochtend één overleg (standaard 08:30 Nederlandse tijd).
// Gewone code verzamelt de feiten van alle afdelingen, kiest maximaal vijf acties (de drie
// belangrijkste bovenaan), wijst ze toe en kijkt wat er met de acties van gisteren gebeurde.
// Hooguit één AI-samenvatting, alleen als er bevestigd tegoed is. Zonder AI draait alles door.
import { q, one, tx } from "../db.js";
import { amsParts, amsToUtc } from "../content/studio.js";
import { capacity } from "./sales.js";
import { getRoutes } from "./contact.js";
import { marketingInsights } from "./acquisition.js";
import { structured, llmConfigured, refreshAi, aiContext } from "../agents/llm.js";

export const DEPT = { sales: "Sales", acquisitie: "Acquisitie", scout: "Scout", auditor: "Auditor", marketing: "Marketing", project: "Projectbeheer", care: "Nazorg", vertrouwen: "Vertrouwen", seo: "Vindbaarheid & SEO", conversie: "Conversie", resultaten: "Resultaten", rayan: "Rayan" };

export async function kantoorSettings(db) {
  const r = (await (db || { query: q }).query("select value from hq.settings where key='kantoor'")).rows[0]?.value || {};
  return { paused: false, meeting_time: "08:30", max_actions: 5, ...r };
}

const amsDay = (d = new Date()) => { const p = amsParts(d); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };

/** Feiten per afdeling (alleen gewone code). env 'test' telt alleen testgegevens, 'productie' alleen echte. */
export async function facts({ env = "productie", now = new Date() } = {}) {
  const T = env === "test";
  const p = amsParts(now);
  const today = amsToUtc(p.y, p.m, p.d, 0, 0), yesterday = new Date(today.getTime() - 864e5);
  const W = (alias = "") => `${alias}is_test=${T}`;
  const c = async (sql, vals = []) => (await q(sql, vals)).rows[0];
  const y = [yesterday, today];
  const gisteren = await c(`select
      (select count(*)::int from hq.interactions where kind='aanvraag' and ${W()} and at >= $1 and at < $2) as aanvragen,
      (select count(*)::int from hq.leads where qualified_at >= $1 and qualified_at < $2 and ${W()}) as gekwalificeerd,
      (select count(*)::int from hq.interactions where direction='in' and kind in ('antwoord','aanvraag') and ${W()} and at >= $1 and at < $2) as gesprekken,
      (select count(*)::int from hq.quotes where sent_at >= $1 and sent_at < $2 and ${W()}) as offertes_verstuurd,
      (select count(*)::int from hq.quotes where accepted_at >= $1 and accepted_at < $2 and ${W()}) as akkoord,
      (select count(*)::int from hq.payments where created_at >= $1 and created_at < $2 and ${W()}) as betalingen,
      (select coalesce(sum(amount_cents),0)::int from hq.payments where created_at >= $1 and created_at < $2 and ${W()}) as betaald_cents`, y);
  const waiting = (await q(`select id, company, awaiting_reply_since, priority_reason from hq.leads where awaiting_reply_since is not null and status not in ('afgemeld','verloren') and ${W()} order by awaiting_reply_since limit 10`)).rows;
  const blockers = [];
  const failed = (await q(`select t.title, t.error, t.updated_at from hq.tasks t left join hq.leads l on l.id=t.lead_id where t.status='mislukt' and t.updated_at > now() - interval '3 days' and coalesce(l.is_test,false)=${T} order by t.updated_at desc limit 5`)).rows;
  for (const f of failed) blockers.push({ waar: f.title, bewijs: f.error });
  const unsure = (await q(`select o.id, l.company, o.last_error from hq.outreach o join hq.leads l on l.id=o.lead_id where o.status='onzeker' and ${W("o.")}`)).rows;
  for (const u of unsure) blockers.push({ waar: `Bericht aan ${u.company}`, bewijs: u.last_error || "uitkomst onduidelijk" });
  const routes = await getRoutes();
  for (const [ch, r] of Object.entries(routes)) if (r.paused) blockers.push({ waar: `Verzendroute ${ch} gepauzeerd`, bewijs: r.pause_reason });
  const budgetWait = (await one("select count(*)::int n from hq.tasks where status='gepauzeerd' and pause_reason='budget'")).n;
  if (budgetWait) blockers.push({ waar: "AI-taken wachten op budget", bewijs: `${budgetWait} taak/taken gepauzeerd` });
  const stuckIntake = (await q(`select p.id, p.name, p.updated_at from hq.projects p where p.status='intake' and p.intake_complete_at is null and p.updated_at < now() - interval '3 days' and ${W("p.")}`)).rows;
  for (const s of stuckIntake) blockers.push({ waar: `Intake ${s.name}`, bewijs: `sinds ${new Date(s.updated_at).toLocaleDateString("nl-NL")} niet compleet` });
  const openQuotes = (await q(`select id, lead_id, price_cents, interest, sent_at from hq.quotes where status='verstuurd' and ${W()} order by sent_at`)).rows;
  return { env, gisteren, wachtend: waiting, vastgelopen: blockers, open_offertes: { aantal: openQuotes.length, waarde_cents: openQuotes.reduce((s, x) => s + x.price_cents, 0), met_belangstelling: openQuotes.filter(x => x.interest).length },
    capaciteit: await capacity(null, { test: T }), marketing_input: await marketingInsights(60, { test: T }) };
}

/** Kandidaat-acties met een prioriteit (hoger = belangrijker). Warme aanvragen gaan voor. */
async function candidates(env, now = new Date()) {
  const T = env === "test";
  const out = [];
  const add = (a) => out.push(a);
  for (const l of (await q(`select id, company, awaiting_reply_since from hq.leads where awaiting_reply_since is not null and status not in ('afgemeld','verloren') and is_test=${T} order by awaiting_reply_since limit 10`)).rows) {
    const h = Math.max(0, Math.round((now - new Date(l.awaiting_reply_since)) / 3600e3));
    add({ score: 100 + Math.min(h, 48), department: "sales", title: `Beantwoord ${l.company}`, reason: `Klant wacht al ${h} uur op antwoord`, expected: "Warme aanvraag: grootste kans op een opdracht", next_step: "Open de klantkaart, controleer het klaargezette antwoord en verstuur", lead_id: l.id, key: `antwoord:${l.id}` });
  }
  for (const qu of (await q(`select q.id, q.lead_id, q.interest, q.sent_at, l.company from hq.quotes q join hq.leads l on l.id=q.lead_id where q.status='concept' and q.is_test=${T}`)).rows)
    add({ score: 90, department: "sales", title: `Offerte ${qu.company} versturen`, reason: "Offerteconcept staat klaar", expected: "Van aanvraag naar offerte", next_step: "Controleer prijs en eventuele extra wensen, verstuur", lead_id: qu.lead_id, quote_id: qu.id, key: `offerte:${qu.id}` });
  for (const qu of (await q(`select q.id, q.lead_id, q.sent_at, l.company from hq.quotes q join hq.leads l on l.id=q.lead_id where q.status='verstuurd' and q.interest and q.sent_at < now() - interval '5 days' and q.is_test=${T}
      and not exists (select 1 from hq.outreach o where o.quote_id=q.id and o.status in ('gepland'))`)).rows)
    add({ score: 70, department: "sales", title: `Bel ${qu.company} over de offerte`, reason: "Belangstelling getoond, al 5 dagen geen beslissing", expected: "Offerte naar akkoord", next_step: "Kort bellen of appen; afspraak voorstellen", lead_id: qu.lead_id, quote_id: qu.id, key: `offerte_bellen:${qu.id}` });
  for (const p of (await q(`select id, name, lead_id from hq.projects where status='intake' and intake_complete_at is null and is_test=${T}`)).rows)
    add({ score: 60, department: "project", title: `Intake ${p.name} afronden`, reason: "Materiaal nog niet compleet", expected: "Project kan starten", next_step: "Herinnering versturen of samen invullen", lead_id: p.lead_id, key: `intake:${p.id}` });
  for (const p of (await q(`select id, name, lead_id from hq.projects where status='websitecontrole' and is_test=${T}`)).rows)
    add({ score: 55, department: "auditor", title: `Oplevercontrole ${p.name}`, reason: "Project staat op websitecontrole", expected: "Oplevering zonder verrassingen", next_step: "Controleresultaat bekijken en punten afvinken", lead_id: p.lead_id, key: `controle:${p.id}` });
  for (const o of (await q(`select o.id, o.lead_id, l.company from hq.outreach o join hq.leads l on l.id=o.lead_id where o.status='klaar_handmatig' and o.is_test=${T} limit 5`)).rows)
    add({ score: 45, department: "acquisitie", title: `Bericht aan ${o.company} versturen`, reason: "Benadering staat klaar (toegestaan, handmatig kanaal)", expected: "Nieuw gesprek", next_step: "Kopieer het bericht en verstuur via het juiste kanaal", lead_id: o.lead_id, key: `handmatig:${o.id}` });
  for (const l of (await q(`select id, company from hq.leads where priority='hoog' and status='nieuw' and is_test=${T} and (contact_email is not null or exists (select 1 from hq.consents c where c.lead_id=hq.leads.id and c.revoked_at is null)) and not exists (select 1 from hq.outreach o where o.lead_id=hq.leads.id) limit 3`)).rows)
    add({ score: 35, department: "acquisitie", title: `Benadering voorbereiden: ${l.company}`, reason: "Kansrijk bedrijf zonder benadering", expected: "Concrete contactmogelijkheid", next_step: "Contactgrond controleren, bericht klaarzetten", lead_id: l.id, key: `benaderen:${l.id}` });
  {
    const mi = await marketingInsights(60, { test: T });
    const top = mi.problemen[0];
    const nosite = mi.zonder_website[0];
    if (!top && nosite) add({ score: 30, department: "marketing", title: `Video voor ${nosite.segment} zonder eigen website`, reason: `${nosite.bedrijven} onderzochte bedrijven zonder eigen website en zonder contactgrond (anoniem)`, expected: "Herleidbare aanvragen uit een doelgroep die we niet mogen mailen", next_step: "Contentstudio: video over wat een eigen site met WhatsApp-knop oplevert, met campagnelink", key: `marketing:${nosite.segment}:geen_website` });
    if (top) add({ score: 30, department: "marketing", title: `Video voor ${top.segment}: ${top.doel}`, reason: `${top.bedrijven} onderzochte bedrijven hebben hetzelfde probleem (${top.doel})`, expected: "Herleidbare aanvragen uit een doelgroep", next_step: "Contentstudio: nieuw onderwerp voor deze doelgroep", key: `marketing:${top.segment}:${top.doel}` });
  }
  return out;
}

/**
 * Het ochtendoverleg. Idempotent per dag: tweede keer op dezelfde dag geeft het bestaande
 * verslag. Maakt echte acties aan (hq.actions) en kijkt naar de acties van het vorige overleg.
 */
export async function runMeeting({ env = "productie", now = new Date(), force = false } = {}) {
  const day = amsDay(now);
  const existing = await one("select * from hq.briefings where day=$1 and env=$2", [day, env]);
  if (existing && !force) return { briefing: existing, duplicate: true };
  const s = await kantoorSettings();
  const F = await facts({ env, now });
  const cap = F.capaciteit;
  let cands = await candidates(env, now);
  // Capaciteit vol: geen nieuwe acquisitie of marketing; eerst lopend werk afronden.
  if (cap.free <= 0) cands = cands.map(c => ["acquisitie", "marketing", "scout"].includes(c.department) ? { ...c, score: c.score - 50, reason: `${c.reason} (capaciteit vol: ${cap.active}/${cap.max} projecten)` } : c);
  // Bewezen aanpak krijgt voorrang bij gelijke stand (bonus uit de scorekaart).
  const sc = await scorecards({ env });
  cands.forEach(c => { c.score += Math.min(5, Math.max(-5, Math.round((sc[c.department]?.bonus || 0) / 10))); });
  cands.sort((a, b) => b.score - a.score);
  const chosen = cands.slice(0, s.max_actions);
  const prev = (await q("select title, department, status, result from hq.actions where day=(select max(day) from hq.actions where day < $1::date and is_test=$2) and is_test=$2 order by rank", [day, env === "test"])).rows;
  const top3 = chosen.slice(0, 3);
  const g = F.gisteren;
  let summary = [
    `Gisteren: ${g.aanvragen} aanvraag/aanvragen, ${g.gekwalificeerd} gekwalificeerd, ${g.gesprekken} gesprek(ken), ${g.offertes_verstuurd} offerte(s) verstuurd, ${g.akkoord} akkoord, ${g.betalingen} betaling(en)${g.betaald_cents ? ` (€${g.betaald_cents / 100})` : ""}.`,
    F.wachtend.length ? `Wacht op ons: ${F.wachtend.slice(0, 3).map(w => w.company).join(", ")}${F.wachtend.length > 3 ? ` en ${F.wachtend.length - 3} meer` : ""}.` : "Niemand wacht op antwoord.",
    F.vastgelopen.length ? `Vastgelopen: ${F.vastgelopen.slice(0, 2).map(b => `${b.waar} (${String(b.bewijs || "").slice(0, 80)})`).join("; ")}.` : "Niets vastgelopen.",
    top3.length ? `Vandaag: ${top3.map((a, i) => `${i + 1}) ${a.title} (${DEPT[a.department]})`).join(" ")}.` : "Geen acties nodig.",
    prev.length ? `Vorig overleg: ${prev.filter(p => p.status === "klaar").length} van ${prev.length} acties klaar.` : "",
    `Capaciteit: ${cap.active}/${cap.max} projecten.`,
  ].filter(Boolean).join(" ");
  let by = "code";
  // Eén gezamenlijke AI-samenvatting, alleen met bevestigd tegoed (anders blijft de code-tekst staan).
  if (env !== "test" && await refreshAi() && llmConfigured()) {
    try {
      const r = await aiContext.run({ department: "overig" }, () => structured({ system: "Je bent de teamleider van StrakWerk. Vat het ochtendoverleg samen in maximaal 5 korte zinnen, Nederlands, zonder nieuwe feiten.", instruction: "Vat samen.", untrusted: { feiten: F, acties: top3 }, schema: { type: "object", additionalProperties: false, required: ["samenvatting"], properties: { samenvatting: { type: "string" } } }, maxTokens: 600 }));
      summary = r.data.samenvatting; by = "Claude";
    } catch { /* budget op of fout: code-samenvatting blijft */ }
  }
  return tx(async (db) => {
    const b = (await db.query(`insert into hq.briefings (day, env, facts, summary, summary_by, previous) values ($1,$2,$3,$4,$5,$6)
       on conflict (day, env) do update set facts=excluded.facts, summary=excluded.summary, summary_by=excluded.summary_by, previous=excluded.previous, at=now() returning *`, [day, env, F, summary, by, JSON.stringify(prev)])).rows[0];
    const due = new Date(now.getTime() + 8 * 3600e3);
    for (const [i, a] of chosen.entries()) {
      await db.query(`insert into hq.actions (briefing_id, day, rank, department, title, reason, expected, next_step, lead_id, quote_id, due_at, source_key, is_test)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict (day, source_key) do update set briefing_id=excluded.briefing_id, rank=excluded.rank, reason=excluded.reason, expected=excluded.expected, next_step=excluded.next_step, due_at=coalesce(hq.actions.due_at, excluded.due_at)`,
        [b.id, day, i + 1, a.department, a.title, a.reason, a.expected, a.next_step, a.lead_id || null, a.quote_id || null, i < 3 ? due : null, a.key, env === "test"]);
    }
    // Acties van eerdere dagen (of een eerder overleg vandaag) die niet meer nodig zijn, vervallen.
    const keys = chosen.map(a => a.key);
    await db.query("update hq.actions set status='vervallen', result='Niet meer bij de belangrijkste acties' where day=$1::date and rank > 0 and status='open' and is_test=$3 and not (source_key = any($2::text[]))", [day, keys, env === "test"]);
    await db.query("update hq.actions set status='vervallen', result='Aanleiding verdwenen' where day < $1::date and status in ('open','opgepakt') and is_test=$3 and not (source_key = any($2::text[]))", [day, keys, env === "test"]);
    return { briefing: b, actions: chosen.length, duplicate: false };
  });
}

/** Cron: overleg draaien zodra het ingestelde tijdstip voorbij is (eenmaal per dag). */
export async function meetingTick(now = new Date()) {
  const s = await kantoorSettings();
  if (s.paused) return { skipped: "gepauzeerd" };
  const p = amsParts(now); const [hh, mm] = s.meeting_time.split(":").map(Number);
  if (p.hh * 60 + p.mm < hh * 60 + mm) return { skipped: "nog niet" };
  return runMeeting({ now });
}

// ── Scorekaarten, virtuele bonus, fouten ────────────────────────────────────────
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

export async function scorecards({ env = "productie" } = {}) {
  const T = env === "test";
  const one_ = async (sql) => (await q(sql)).rows[0];
  const scout = await one_(`select count(*)::int as onderzocht, count(*) filter (where priority='hoog' and active_status<>'gesloten')::int as geschikt from hq.leads where source='scout_osm' and is_test=${T}`);
  const aud = await one_(`select count(*) filter (where o.verified='klopt')::int as klopt, count(*) filter (where o.verified='klopt_niet')::int as klopt_niet, count(*)::int as totaal from hq.opportunities o join hq.leads l on l.id=o.lead_id where l.is_test=${T}`);
  const acq = await one_(`select count(*) filter (where o.status in ('verzonden','test_verzonden','handmatig_verzonden') and o.kind in ('eerste_contact','opvolging'))::int as verzonden,
      (select count(*)::int from hq.interactions i where i.is_test=${T} and i.direction='in' and i.classification in ('interesse','vraag') and exists (select 1 from hq.outreach x where x.lead_id=i.lead_id and x.kind='eerste_contact' and x.status in ('verzonden','test_verzonden','handmatig_verzonden'))) as positief,
      (select count(*)::int from hq.interactions i where i.is_test=${T} and i.kind='afmelding' and exists (select 1 from hq.outreach x where x.lead_id=i.lead_id and x.kind='eerste_contact')) as afmeldingen,
      (select count(*)::int from hq.interactions i where i.is_test=${T} and i.kind='bezwaar') as klachten from hq.outreach o where o.is_test=${T}`);
  const sales = await one_(`select
      (select percentile_cont(0.5) within group (order by extract(epoch from (o.t - i.at))/3600)::float from hq.interactions i
         join lateral (select min(at) as t from hq.interactions x where x.lead_id=i.lead_id and x.direction='uit' and x.at > i.at) o on true where i.direction='in' and i.kind in ('aanvraag','antwoord') and i.is_test=${T} and o.t is not null) as antwoordtijd_uur,
      (select count(*)::int from hq.quotes where status='verstuurd' and is_test=${T}) + (select count(*)::int from hq.quotes where status in ('geaccepteerd','afgewezen','vervallen') and is_test=${T}) as offertes,
      (select count(*)::int from hq.quotes where status='geaccepteerd' and is_test=${T}) as geaccepteerd,
      (select count(distinct lead_id)::int from hq.payments where is_test=${T}) as betaald`);
  const mkt = await one_(`select count(*) filter (where campaign_piece_id is not null and qualified_at is not null)::int as aanvragen,
      count(*) filter (where campaign_piece_id is not null and exists (select 1 from hq.payments p where p.lead_id=hq.leads.id and p.is_test=${T}))::int as klanten from hq.leads where is_test=${T}`);
  const errs = (await q(`select department, count(*) filter (where resolved_at is null)::int as open, count(*)::int as totaal from hq.agent_errors where is_test=${T} group by 1`)).rows;
  const err = (d) => errs.find(e => e.department === d) || { open: 0, totaal: 0 };
  // Virtuele bonus: punten voor uitkomsten die de afdeling kan beïnvloeden; nooit voor volume.
  const bonus = (pts, d) => pts - err(d).totaal * 5;
  return {
    scout: { label: "Scout", metrics: [{ naam: "Geschikt na controle", aantal: scout.geschikt, van: scout.onderzocht, pct: pct(scout.geschikt, scout.onderzocht) }], bonus: bonus(scout.geschikt * 2, "scout"), fouten: err("scout") },
    auditor: { label: "Auditor", metrics: [{ naam: "Observaties die kloppen (door jou gecontroleerd)", aantal: aud.klopt, van: aud.klopt + aud.klopt_niet, pct: pct(aud.klopt, aud.klopt + aud.klopt_niet) }, { naam: "Nog niet gecontroleerd", aantal: aud.totaal - aud.klopt - aud.klopt_niet }], bonus: bonus(aud.klopt * 2 - aud.klopt_niet * 3, "auditor"), fouten: err("auditor") },
    acquisitie: { label: "Acquisitie", metrics: [{ naam: "Positieve reacties", aantal: acq.positief, van: acq.verzonden, pct: pct(acq.positief, acq.verzonden) }, { naam: "Afmeldingen", aantal: acq.afmeldingen, van: acq.verzonden, pct: pct(acq.afmeldingen, acq.verzonden) }, { naam: "Klachten", aantal: acq.klachten }], bonus: bonus(acq.positief * 5 - acq.klachten * 10, "acquisitie"), fouten: err("acquisitie") },
    sales: { label: "Sales", metrics: [{ naam: "Mediane antwoordtijd (uur)", aantal: sales.antwoordtijd_uur == null ? null : Math.round(sales.antwoordtijd_uur * 10) / 10 }, { naam: "Geaccepteerde offertes", aantal: sales.geaccepteerd, van: sales.offertes, pct: pct(sales.geaccepteerd, sales.offertes) }, { naam: "Bevestigde betalingen (klanten)", aantal: sales.betaald }], bonus: bonus(sales.geaccepteerd * 5 + sales.betaald * 10, "sales"), fouten: err("sales") },
    marketing: { label: "Marketing", metrics: [{ naam: "Herleidbare gekwalificeerde aanvragen", aantal: mkt.aanvragen }, { naam: "Herleidbare betalende klanten", aantal: mkt.klanten, van: mkt.aanvragen, pct: pct(mkt.klanten, mkt.aanvragen) }], bonus: bonus(mkt.aanvragen * 3 + mkt.klanten * 10, "marketing"), fouten: err("marketing") },
    note: "Punten alleen voor uitkomsten (geschikte kansen, kloppende observaties, positieve reacties, akkoorden, betalingen). Geen punten voor aantallen mails, views of ingevoerde bedrijven. Een ondernemer zonder interesse is geen fout.",
  };
}

/**
 * Eigen fout van een agent: lagere score, correctietaak, en bij een verzendfout pauzeert de
 * route tot de fout is hersteld en getest.
 */
export async function recordError({ department, kind, description, route = null, lead_id = null, is_test = false }) {
  return tx(async (db) => {
    const day = amsDay();
    const a = (await db.query(`insert into hq.actions (day, rank, department, title, reason, expected, next_step, lead_id, source_key, is_test)
      values ($1, 0, $2, $3, $4, 'Fout hersteld en getest; route weer veilig', $5, $6, $7, $8) on conflict (day, source_key) do update set status='open' returning id`,
      [day, department, `Correctie: ${kind.replace(/_/g, " ")}`, description, route ? `Oorzaak herstellen, testen, daarna route ${route} vrijgeven` : "Oorzaak herstellen en testen", lead_id, `fout:${kind}:${lead_id || "-"}`, is_test])).rows[0];
    const e = (await db.query("insert into hq.agent_errors (department, kind, description, route, lead_id, correction_action_id, is_test) values ($1,$2,$3,$4,$5,$6,$7) returning *", [department, kind, description, route, lead_id, a.id, is_test])).rows[0];
    if (route) {
      const r = (await db.query("select value from hq.settings where key='routes'")).rows[0].value;
      r[route] = { ...(r[route] || {}), paused: true, pause_reason: `${kind.replace(/_/g, " ")}: ${description}` };
      await db.query("update hq.settings set value=$1, updated_at=now() where key='routes'", [r]);
    }
    return e;
  });
}

/** Controle op eigen fouten (cron): verzonden na afmelding of dubbel verzonden. */
export async function auditViolations() {
  const found = [];
  const afterUnsub = (await q(`select distinct on (o.lead_id) o.id, o.lead_id, l.is_test, l.company from hq.outreach o join hq.leads l on l.id=o.lead_id join hq.suppressions s on s.lead_id=o.lead_id
     where o.status in ('verzonden','test_verzonden') and o.sent_at > s.at and not exists (select 1 from hq.agent_errors e where e.kind='afmelding_genegeerd' and e.lead_id=o.lead_id)`)).rows;
  for (const v of afterUnsub) found.push(await recordError({ department: "acquisitie", kind: "afmelding_genegeerd", description: `Bericht verstuurd aan ${v.company} na een afmelding.`, route: "email", lead_id: v.lead_id, is_test: v.is_test }));
  const dupes = (await q(`select o.lead_id, o.kind, o.sequence, l.is_test, l.company from hq.outreach o join hq.leads l on l.id=o.lead_id where o.status in ('verzonden','test_verzonden') and o.kind<>'antwoord'
     group by 1,2,3,4,5 having count(*) > 1 and not exists (select 1 from hq.agent_errors e where e.kind='dubbele_verzending' and e.lead_id=o.lead_id)`)).rows;
  for (const v of dupes) found.push(await recordError({ department: "acquisitie", kind: "dubbele_verzending", description: `Hetzelfde bericht (${v.kind}) twee keer verstuurd aan ${v.company}.`, route: "email", lead_id: v.lead_id, is_test: v.is_test }));
  return found.length;
}

/** Fout hersteld: zelftest van de contactregels; pas daarna gaat de route weer open. */
export async function resolveError(errorId, note, auth) {
  const e = await one("select * from hq.agent_errors where id=$1", [errorId]);
  if (!e) throw Object.assign(new Error("Fout niet gevonden."), { status: 404, code: "niet_gevonden" });
  const { contactCheck, suppressedFor } = await import("./contact.js");
  // Zelftest: een afgemelde klant moet geblokkeerd worden, en er mag geen dubbele verzending openstaan.
  let test = "geen klant om te testen";
  if (e.lead_id) {
    const lead = await one("select * from hq.leads where id=$1", [e.lead_id]);
    const sup = await suppressedFor(lead);
    const chk = await contactCheck(lead, "email");
    if (e.kind === "afmelding_genegeerd" && (!sup || chk.allowed)) throw Object.assign(new Error("Zelftest mislukt: deze klant zou nog benaderd kunnen worden."), { status: 409, code: "test_mislukt" });
    test = `zelftest geslaagd: klant ${sup ? "geblokkeerd" : "niet geblokkeerd"}, contactcontrole ${chk.allowed ? "staat toe" : "weigert"}`;
  }
  await tx(async (db) => {
    await db.query("update hq.agent_errors set resolved_at=now(), resolved_note=$2 where id=$1", [errorId, `${note || "Hersteld"} · ${test}`]);
    if (e.correction_action_id) await db.query("update hq.actions set status='klaar', done_at=now(), result=$2 where id=$1", [e.correction_action_id, test]);
    if (e.route) {
      const open = (await db.query("select count(*)::int n from hq.agent_errors where route=$1 and resolved_at is null", [e.route])).rows[0].n;
      if (!open) {
        const r = (await db.query("select value from hq.settings where key='routes'")).rows[0].value;
        r[e.route] = { ...(r[e.route] || {}), paused: false, pause_reason: null };
        await db.query("update hq.settings set value=$1, updated_at=now() where key='routes'", [r]);
      }
    }
  });
  return { ok: true, test };
}

// ── Experimenten en promptversies ──────────────────────────────────────────────
export async function experimentResults(id) {
  const e = await one("select * from hq.experiments where id=$1", [id]);
  if (!e) return null;
  const r = (await q(`select o.variant, count(*)::int as verzonden,
      count(*) filter (where exists (select 1 from hq.interactions i where i.lead_id=o.lead_id and i.direction='in' and i.classification in ('interesse','vraag') and i.at > o.sent_at))::int as positief
    from hq.outreach o where o.experiment_id=$1 and o.status in ('verzonden','test_verzonden','handmatig_verzonden') group by 1`, [id])).rows;
  const A = r.find(x => x.variant === "A") || { verzonden: 0, positief: 0 }, B = r.find(x => x.variant === "B") || { verzonden: 0, positief: 0 };
  const enough = A.verzonden >= e.min_samples && B.verzonden >= e.min_samples;
  let verdict = "nog onvoldoende bewijs";
  if (enough) { const pa = A.positief / A.verzonden, pb = B.positief / B.verzonden; verdict = Math.abs(pa - pb) < 0.05 ? "geen duidelijk verschil: langer meten" : pb > pa ? "B lijkt beter" : "A lijkt beter"; }
  return { experiment: e, A, B, verdict, enough };
}
