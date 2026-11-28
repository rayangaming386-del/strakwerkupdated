// PROJECTBEHEER, NAZORG, VERTROUWEN en RESULTATEN.
// Akkoord → project (inhoud + prijs uit de offerte) → persoonlijke intake-link (alleen dit project)
// → compleet → bouwbriefing voor Claude → feedbackrondes met scopecontrole → opleverkandidaat
// → Auditor → opgeleverd → nazorg, reviewverzoek en portfoliocampagne.
// Commerciële status (leads) en projectvoortgang (projects) blijven gescheiden.
import { createHash, randomUUID } from "node:crypto";
import { q, one, tx, audit } from "../db.js";
import { HttpError, assertUuid, str } from "../http.js";
import { enqueue } from "../queue.js";
import { SITE, patchProject } from "../content/studio.js";
import * as storage from "../content/storage.js";
import { WA_OPT_OUT } from "./contact.js";

// Wat StrakWerk van de klant nodig heeft. "nodig" = verplicht om te kunnen bouwen.
export const INTAKE_FIELDS = [
  { key: "bedrijfsnaam", label: "Bedrijfsnaam zoals op de site", type: "text", nodig: true },
  { key: "over", label: "Over je bedrijf (een paar zinnen)", type: "textarea", nodig: true },
  { key: "diensten", label: "Je diensten of behandelingen (één per regel, met prijs als je die wilt tonen)", type: "textarea", nodig: true },
  { key: "contact", label: "Telefoon, e-mail en adres voor op de site", type: "textarea", nodig: true },
  { key: "openingstijden", label: "Openingstijden", type: "textarea", nodig: false },
  { key: "kleuren", label: "Kleuren of stijl die je mooi vindt (of een voorbeeldsite)", type: "text", nodig: false },
  { key: "domein", label: "Gewenst domein (of je bestaande domein)", type: "text", nodig: true },
  { key: "logo", label: "Logo (bestand)", type: "file", nodig: false },
  { key: "fotos", label: "Foto's van je zaak, werk of team", type: "files", nodig: false },
];
const MAX_FILE = 3 * 1024 * 1024; // Vercel accepteert ~4,5 MB per verzoek (base64 ≈ +33%)
const IMG = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg", "application/pdf": "pdf" };

const hashToken = (t) => createHash("sha256").update(String(t)).digest("hex");

export function completeness(intake = {}, scope = {}) {
  const needLogo = /logo/i.test(JSON.stringify(scope.onderdelen || [])) ? false : true; // logo-ontwerp in de offerte: geen logo nodig
  const fields = INTAKE_FIELDS.map(f => {
    const v = intake[f.key];
    const filled = f.type === "files" ? Array.isArray(v) && v.length > 0 : f.type === "file" ? Boolean(v?.key) : Boolean(String(v || "").trim());
    return { ...f, nodig: f.key === "logo" ? needLogo : f.nodig, filled };
  });
  const req = fields.filter(f => f.nodig);
  return { fields, done: req.filter(f => f.filled).length, total: req.length, complete: req.every(f => f.filled), missing: req.filter(f => !f.filled).map(f => f.label) };
}

async function projectByToken(token) {
  if (!/^[a-f0-9]{48}$/.test(String(token || ""))) throw new HttpError(404, "niet_gevonden", "Deze intake-link is ongeldig of verlopen.");
  const p = await one("select p.*, l.contact_name from hq.projects p left join hq.leads l on l.id=p.lead_id where p.intake_token_hash=$1 and p.status not in ('gestopt')", [hashToken(token)]);
  if (!p) throw new HttpError(404, "niet_gevonden", "Deze intake-link is ongeldig of verlopen.");
  return p;
}

/** Publiek (alleen met de persoonlijke link): wat is al aangeleverd, wat ontbreekt nog. */
export async function intakeView(token) {
  const p = await projectByToken(token);
  const c = completeness(p.intake, p.scope);
  return { project: { name: p.name, omschrijving: p.scope?.omschrijving || "", test: p.is_test }, contact_name: p.contact_name ? p.contact_name.split(" ")[0] : null,
    fields: c.fields.map(f => ({ key: f.key, label: f.label, type: f.type, nodig: f.nodig, filled: f.filled, value: ["file", "files"].includes(f.type) ? undefined : p.intake?.[f.key] || "",
      files: f.type === "files" ? (p.intake?.[f.key] || []).map(x => x.name) : f.type === "file" && p.intake?.[f.key] ? [p.intake[f.key].name] : [] })),
    done: c.done, total: c.total, complete: c.complete, submitted_at: p.intake_complete_at };
}

function decodeFile(f) {
  const m = /^data:([a-z+/.-]+);base64,(.+)$/i.exec(String(f?.data || ""));
  if (!m || !IMG[m[1].toLowerCase()]) throw new HttpError(400, "bestandstype", "Alleen PNG, JPG, WebP, SVG of PDF.");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_FILE) throw new HttpError(413, "te_groot", "Bestand is groter dan 3 MB.");
  return { buf, type: m[1].toLowerCase(), name: str(f.name, 120) || `bestand.${IMG[m[1].toLowerCase()]}` };
}

/** Publiek: klant vult in of uploadt. Compleet → briefing + taak voor Rayan (één keer). */
export async function saveIntake(token, body) {
  const p = await projectByToken(token);
  const next = { ...(p.intake || {}) };
  for (const f of INTAKE_FIELDS) {
    if (f.type === "text" || f.type === "textarea") { if (f.key in body) next[f.key] = str(body[f.key], f.type === "text" ? 300 : 4000) || ""; continue; }
    const files = f.type === "file" ? (body[f.key] ? [body[f.key]] : []) : Array.isArray(body[f.key]) ? body[f.key].slice(0, 8) : [];
    for (const raw of files) {
      const d = decodeFile(raw);
      const key = `intake/${p.id}/${randomUUID().slice(0, 8)}.${IMG[d.type]}`;
      await storage.put(key, d.buf, d.type);
      const item = { key, name: d.name, type: d.type, at: new Date().toISOString() };
      if (f.type === "file") next[f.key] = item; else next[f.key] = [...(next[f.key] || []), item].slice(0, 20);
    }
  }
  const c = completeness(next, p.scope);
  return tx(async (db) => {
    await db.query("update hq.projects set intake=$2, updated_at=now() where id=$1", [p.id, next]);
    await db.query("insert into hq.project_history (project_id, actor_label, to_status, note) values ($1,'klant (intake-link)',$2,$3)", [p.id, p.status, `Intake bijgewerkt: ${c.done}/${c.total} verplichte onderdelen`]);
    let briefing = null;
    if (c.complete && !p.intake_complete_at) {
      briefing = buildBriefing({ ...p, intake: next });
      await db.query("update hq.projects set intake_complete_at=now(), briefing=$2, briefing_at=now(), status=case when status in ('akkoord','intake') then 'in_aanbouw' else status end where id=$1", [p.id, briefing]);
      await db.query("update hq.outreach set status='geannuleerd', cancel_reason='Intake compleet', updated_at=now() where project_id=$1 and kind='intake_herinnering' and status in ('concept','gepland','klaar_handmatig')", [p.id]);
      await db.query("insert into hq.interactions (lead_id, direction, channel, kind, body, is_test, created_label) values ($1,'in','systeem','notitie',$2,$3,'klant (intake-link)')", [p.lead_id, "Intake compleet: bouwbriefing klaar", p.is_test]);
    }
    return { ...c, briefing_ready: Boolean(briefing || p.briefing_at) };
  });
}

/** Bouwbriefing voor Claude: afgesproken inhoud, aangeleverd materiaal, huisregels. */
export function buildBriefing(p) {
  const i = p.intake || {};
  const items = (p.scope?.onderdelen || []).map(l => `- ${l.name}${l.qty > 1 ? ` (${l.qty}×)` : ""}`).join("\n");
  const extra = (p.scope?.extra || []).map(e => `- ${e.omschrijving} (€${e.prijs_eur}, apart afgesproken)`).join("\n");
  const text = `# Bouwbriefing ${p.name}
Prijs afgesproken: €${(p.price_cents || 0) / 100}. Bouw alleen wat hieronder staat; alles daarbuiten eerst als voorstel aan Rayan.

## Afgesproken onderdelen
${items || "- zie offerte"}
${extra ? `\n## Extra (apart afgesproken)\n${extra}\n` : ""}
## Over het bedrijf
${i.bedrijfsnaam || p.name}
${i.over || ""}

## Diensten
${i.diensten || ""}

## Contact en openingstijden
${i.contact || ""}
${i.openingstijden || ""}

## Stijl
${i.kleuren || "Geen voorkeur opgegeven: rustig, professioneel, mobiel eerst."}
Domein: ${i.domein || "nog bepalen"}

## Materiaal
Logo: ${i.logo ? i.logo.name : "niet aangeleverd (logo-ontwerp of tekstlogo)"}
Foto's: ${(i.fotos || []).map(f => f.name).join(", ") || "geen; gebruik geen stockfoto's die echte klanten of resultaten suggereren"}

## Huisregels
- Mobiel eerst; elke pagina heeft een duidelijke vervolgstap (bellen, WhatsApp of aanvraag).
- Geen verzonnen reviews, cijfers of resultaten.
- Na oplevering: Auditor controleert de mobiele klantroute (diensten, afspraak, prijs, contact).`;
  return { text, gemaakt_op: new Date().toISOString(), bronnen: ["offerte", "intake"] };
}

/** Nieuwe intake-link (de oude werkt dan niet meer). */
export async function newIntakeLink(projectId, auth) {
  assertUuid(projectId);
  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 16);
  const r = await q("update hq.projects set intake_token_hash=$2, updated_at=now() where id=$1", [projectId, hashToken(token)]);
  if (!r.rowCount) throw new HttpError(404, "niet_gevonden", "Project niet gevonden.");
  await audit(null, { actor: auth.userId, label: auth.email, action: "intake.nieuwe_link", entity: "project", entityId: projectId });
  return { intake_url: `/intake?t=${token}` };
}

// ── Feedback met scopecontrole (gewone code) ─────────────────────────────────
const OUT_OF_SCOPE = [
  { re: /webshop|online verkopen|winkelwagen/i, opt: "webshop" },
  { re: /extra pagina|nieuwe pagina|nog een pagina|pagina erbij/i, opt: "pagina" },
  { re: /afspra(ak|ken) (online|plannen|boeken)|boekingssysteem|reserveren/i, opt: "booking" },
  { re: /kenteken/i, opt: "kenteken" },
  { re: /meertalig|engels|vertal/i, opt: "taal" },
  { re: /logo (ontwerpen|maken)|nieuw logo/i, opt: "logo" },
];
export async function addFeedback(projectId, text, auth) {
  assertUuid(projectId);
  const t = str(text, 4000);
  if (!t) throw new HttpError(400, "ongeldig", "Feedback is leeg.");
  const p = await one("select * from hq.projects where id=$1", [projectId]);
  if (!p) throw new HttpError(404, "niet_gevonden", "Project niet gevonden.");
  const lines = p.scope?.onderdelen || [];
  const pkg = lines.find(l => l.kind === "pakket")?.key;
  const inScope = new Set([...lines.map(l => l.key), ...Object.keys(SITE.bases[pkg]?.incl || {})]);
  const hits = OUT_OF_SCOPE.filter(x => x.re.test(t) && !inScope.has(x.opt));
  const opts = hits.map(h => (SITE.options || []).find(o => o.id === h.opt)).filter(Boolean);
  const round = ((await one("select coalesce(max(round),0)::int r from hq.project_feedback where project_id=$1", [projectId])).r) + 1;
  const proposal = opts.length ? { onderdelen: opts.map(o => ({ id: o.id, naam: o.name, prijs_eur: o.price_eur, per: o.per || null })), totaal_eur: opts.reduce((s, o) => s + (o.per ? 0 : o.price_eur), 0),
    tekst: `Dit valt buiten de afgesproken onderdelen: ${opts.map(o => `${o.name} (+€${o.price_eur}${o.per ? ` per ${o.per}` : ""})`).join(", ")}. Eerst akkoord van de klant op de meerprijs.` } : null;
  const r = await one(`insert into hq.project_feedback (project_id, round, text, in_scope, scope_note, proposal, status, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [projectId, round, t, opts.length ? false : null, opts.length ? "Buiten scope (herkend door de scopecontrole)" : "Geen meerwerk herkend; Rayan beoordeelt", proposal, opts.length ? "voorstel" : "open", auth?.userId || null]);
  return r;
}

/** Opleverkandidaat: Auditor controleert de mobiele klantroute voordat Rayan oplevert. */
export async function deliveryCandidate(projectId, url, auth) {
  assertUuid(projectId);
  const u = str(url, 300);
  if (!u || !/^https?:\/\//.test(u)) throw new HttpError(400, "ongeldig", "Geef de adres van de opleverkandidaat (https://…).");
  return tx(async (db) => {
    const p = (await db.query("select * from hq.projects where id=$1 for update", [projectId])).rows[0];
    if (!p) throw new HttpError(404, "niet_gevonden", "Project niet gevonden.");
    const t = await enqueue(db, { agent: "auditor", kind: "verkoopkans", title: `Oplevercontrole ${p.name}`, input: { url: u, project_id: projectId, oplevering: true }, leadId: null, createdBy: auth?.userId || null, idempotencyKey: `oplevering:${projectId}:${hashToken(u).slice(0, 12)}` });
    await db.query("update hq.projects set status='websitecontrole', live_url=coalesce(live_url,$2), check_task_id=$3, updated_at=now() where id=$1", [projectId, u, t.id]);
    await db.query("insert into hq.project_history (project_id, actor, actor_label, from_status, to_status, note) values ($1,$2,$3,$4,'websitecontrole',$5)", [projectId, auth?.userId || null, auth?.email || "systeem", p.status, `Opleverkandidaat ${u}: Auditor ingepland`]);
    return { task_id: t.id, duplicate: t.duplicate || false };
  });
}

/**
 * Projectstatus wijzigen + automatische overdracht. Opgeleverd → nazorg-check-in (14 dagen),
 * reviewverzoek als concept (Rayan verstuurt zelf) en portfoliocampagne (via de contentstudio).
 */
export async function setProjectStatus(projectId, status, auth) {
  const r = await patchProject(projectId, { status }, auth);
  if (status === "opgeleverd") await afterDelivery(projectId);
  return r;
}

export async function afterDelivery(projectId) {
  const p = await one("select p.*, l.contact_email, l.contact_phone, l.contact_name, l.id as lid from hq.projects p left join hq.leads l on l.id=p.lead_id where p.id=$1", [projectId]);
  if (!p?.lid) return { skipped: "geen klantkaart" };
  const ch = p.contact_email ? "email" : "whatsapp";
  const to = p.contact_email || p.contact_phone;
  const first = p.contact_name ? ` ${p.contact_name.split(" ")[0]}` : "";
  await q(`insert into hq.outreach (lead_id, project_id, channel, kind, status, subject, body, to_address, scheduled_at, idempotency_key, is_test)
    values ($1,$2,$3,'nazorg','gepland','Hoe bevalt je nieuwe website?',$4,$5,now() + interval '14 days',$6,$7) on conflict (idempotency_key) do nothing`,
    [p.lid, projectId, ch, `Hoi${first},\n\nJe site staat nu twee weken live. Loopt alles goed, of wil je iets aangepast hebben? Laat het gerust weten.\n\nGroet,\nRayan\nStrakWerk`, to, `nazorg:${projectId}:1`, p.is_test]);
  // Reviewverzoek: concept, nooit automatisch en nooit met een beloning (Google-regels). Met je
  // Google-reviewlink (Kantoor › Instellingen) staat die er meteen in.
  const links = (await one("select value from hq.settings where key='links'"))?.value || {};
  const ask = links.google_review_url
    ? `Fijn dat je site live staat. Zou je een korte, eerlijke review willen achterlaten op Google? Dat helpt andere ondernemers bij hun keuze:\n${links.google_review_url}\n\nAlleen als je het wilt, natuurlijk.`
    : "Fijn dat je site live staat. Zou je in een paar zinnen willen vertellen hoe de samenwerking was? Dat helpt andere ondernemers bij hun keuze. Alleen als je het wilt, natuurlijk.";
  await q(`insert into hq.outreach (lead_id, project_id, channel, kind, status, subject, body, to_address, idempotency_key, is_test)
    values ($1,$2,$3,'review_verzoek','concept','Wil je iets over StrakWerk vertellen?',$4,$5,$6,$7) on conflict (idempotency_key) do nothing`,
    [p.lid, projectId, ch, `Hoi${first},\n\n${ask}\n\nGroet,\nRayan${ch === "whatsapp" ? `\n\n${WA_OPT_OUT}` : ""}`, to, `review:${projectId}`, p.is_test]);
  return { ok: true };
}

/** Echte bewijzen (reviews, uitspraken, resultaten): alleen met bron en toegestaan gebruik. */
export async function addEvidence(body, auth) {
  const text = str(body.text, 2000), source = str(body.source, 300), permission = str(body.permission, 300);
  if (!text || !source || !permission) throw new HttpError(400, "ongeldig", "Tekst, bron en toegestaan gebruik zijn verplicht.");
  if (!["review", "uitspraak", "resultaat"].includes(body.kind)) throw new HttpError(400, "ongeldig", "Soort: review, uitspraak of resultaat.");
  return one("insert into hq.evidence (lead_id, project_id, kind, text, source, permission, received_at, is_test, created_by) values ($1,$2,$3,$4,$5,$6,coalesce($7::date,current_date),$8,$9) returning *",
    [body.lead_id || null, body.project_id || null, body.kind, text, source, permission, body.received_at || null, Boolean(body.is_test), auth.userId]);
}

export async function addPartner(body, auth) {
  const name = str(body.name, 160);
  if (!name) throw new HttpError(400, "ongeldig", "Naam is verplicht.");
  const kind = ["fotograaf", "drukkerij", "vormgever", "ondernemer", "klant", "anders"].includes(body.kind) ? body.kind : "anders";
  const code = (name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "partner") + randomUUID().slice(0, 4);
  return one(`insert into hq.partners (name, kind, contact_name, contact_email, contact_phone, website, we_offer, they_offer, agreement, reward_rule, ref_code, status, is_test)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
    [name, kind, str(body.contact_name, 120), str(body.contact_email, 254), str(body.contact_phone, 40), str(body.website, 300), str(body.we_offer, 1000) || "", str(body.they_offer, 1000) || "",
     str(body.agreement, 2000) || "", str(body.reward_rule, 500), code, ["idee", "benaderd", "actief", "gestopt"].includes(body.status) ? body.status : "idee", Boolean(body.is_test)]);
}

export async function partners() {
  return (await q(`select p.*, (select count(*)::int from hq.leads l where l.referral_partner_id=p.id) as aanvragen,
     (select count(*)::int from hq.leads l where l.referral_partner_id=p.id and exists (select 1 from hq.payments x where x.lead_id=l.id)) as betalend from hq.partners p order by created_at desc`)).rows;
}

// ── Resultaten & experimenten ────────────────────────────────────────────────
export const QUALIFIED_DEFINITION = "Een aanvraag is gekwalificeerd als de ondernemer een website (nieuw, redesign of uitbreiding) wil, er een bedrijf achter zit en er een manier is om te reageren (e-mail of telefoon).";

/** Trechter en omzet. Betaald staat los van open offertes. Herkomst met de gebruikte methode. */
export async function results({ days = 30, env = "productie" } = {}) {
  const T = env === "test";
  const since = new Date(Date.now() - days * 864e5);
  const c = async (sql) => (await q(sql, [since])).rows[0].n;
  const funnel = [
    { key: "ontvangen", label: "Aanvraag ontvangen", n: await c(`select count(distinct lead_id)::int n from hq.interactions where kind='aanvraag' and is_test=${T} and at >= $1`) },
    { key: "gekwalificeerd", label: "Gekwalificeerd", n: await c(`select count(*)::int n from hq.leads where qualified_at >= $1 and is_test=${T}`) },
    { key: "afspraak", label: "Afspraak", n: await c(`select count(distinct lead_id)::int n from hq.appointments where created_at >= $1 and is_test=${T}`) },
    { key: "offerte", label: "Offerte verstuurd", n: await c(`select count(*)::int n from hq.quotes where sent_at >= $1 and is_test=${T}`) },
    { key: "akkoord", label: "Akkoord", n: await c(`select count(*)::int n from hq.quotes where accepted_at >= $1 and is_test=${T}`) },
    { key: "betaald", label: "Betaling bevestigd", n: await c(`select count(distinct lead_id)::int n from hq.payments where created_at >= $1 and is_test=${T}`) },
  ];
  const paid = (await q(`select coalesce(sum(amount_cents),0)::int c from hq.payments where created_at >= $1 and is_test=${T}`, [since])).rows[0].c;
  const open = (await q(`select coalesce(sum(price_cents),0)::int c, count(*)::int n from hq.quotes where status='verstuurd' and is_test=${T}`)).rows[0];
  const attribution = (await q(`select coalesce(l.campaign_via, case when l.referral_partner_id is not null then 'partner' when l.referral_lead_id is not null then 'klant_verwijzing' when l.source='scout_osm' then 'acquisitie' else 'onbekend' end) as via,
      count(*)::int as aanvragen, count(*) filter (where exists (select 1 from hq.payments p where p.lead_id=l.id))::int as betalend
    from hq.leads l where l.is_test=${T} and exists (select 1 from hq.interactions i where i.lead_id=l.id and i.kind='aanvraag' and i.at >= $1) group by 1 order by 2 desc`, [since])).rows;
  const clicks = T ? [] : (await q(`select name, count(*)::int n from hq.analytics_events where env='production' and at >= $1 and name in ('quote_whatsapp_click','contact_whatsapp_click','email_click','phone_click') group by 1`, [since])).rows;
  return { days, env, funnel, betaald_cents: paid, open_offertes: { waarde_cents: open.c, aantal: open.n }, qualified_definition: QUALIFIED_DEFINITION,
    attribution, attribution_method: "Eerste herleidbare bron: campagnelink (utm_campaign), WhatsApp-zoekwoord, partnercode (ref) of acquisitie. Zonder spoor: onbekend (niet gegokt).",
    clicks, clicks_note: "Een klik op WhatsApp/bellen/mail is geen ontvangen aanvraag; ontvangen en betaald komen alleen uit HQ." };
}

/** Wekelijkse analyse en voorstellen voor Conversie/SEO, alleen uit echte gegevens met steekproefgrootte. */
export async function weeklyProposals() {
  const since = new Date(Date.now() - 28 * 864e5);
  const ev = (await q("select name, path, count(*)::int n from hq.analytics_events where env='production' and at >= $1 group by 1,2", [since])).rows;
  const views = ev.filter(e => e.name === "page_view").reduce((s, e) => s + e.n, 0);
  const calc = ev.filter(e => e.name === "calculator_start").reduce((s, e) => s + e.n, 0);
  const quoteWa = ev.filter(e => e.name === "quote_whatsapp_click").reduce((s, e) => s + e.n, 0);
  const requests = (await one("select count(*)::int n from hq.interactions where kind='aanvraag' and not is_test and at >= $1", [since])).n;
  const conf = (n) => (n < 100 ? "onvoldoende bewijs" : n < 400 ? "voorzichtig" : "redelijk");
  const out = [];
  if (calc > 0) out.push({ department: "conversie", title: "Van calculator naar offerteknop", problem: `${calc} keer de calculator gestart, ${quoteWa} keer de offerte naar WhatsApp gestuurd (28 dagen).`,
    evidence: { calculator_start: calc, quote_whatsapp_click: quoteWa, aanvragen_ontvangen: requests, periode_dagen: 28 }, sample_size: calc, confidence: conf(calc),
    change: { pagina: "/#prijzen", voorstel: "Offerteknop direct onder het totaal herhalen op mobiel (één wijziging), meten: quote_whatsapp_click per calculator_start." }, key: `cro:calc:${since.toISOString().slice(0, 10)}` });
  const pages = ev.filter(e => e.name === "page_view" && e.path.startsWith("/diensten/")).sort((a, b) => b.n - a.n);
  if (pages[0]) out.push({ department: "seo", title: `Meest bezochte dienstpagina: ${pages[0].path}`, problem: `${pages[0].n} weergaven in 28 dagen; controleer of de pagina een duidelijke aanvraagknop en actuele prijs heeft.`,
    evidence: { pagina: pages[0].path, weergaven: pages[0].n, totaal_weergaven: views }, sample_size: pages[0].n, confidence: conf(pages[0].n),
    change: { pagina: pages[0].path, voorstel: "Intro aanscherpen met de zoekterm uit de titel en een directe link naar de calculator met preset." }, key: `seo:${pages[0].path}:${since.toISOString().slice(0, 10)}` });
  let n = 0;
  for (const p of out) {
    const r = await q(`insert into hq.proposals (department, title, problem, evidence, measured_at, sample_size, confidence, change, source_key) values ($1,$2,$3,$4,now(),$5,$6,$7,$8) on conflict (source_key) do nothing`,
      [p.department, p.title, p.problem, p.evidence, p.sample_size, p.confidence, p.change, p.key]);
    n += r.rowCount;
  }
  return { created: n, note: views ? null : "Nog geen bezoekersgegevens in HQ: geen voorstellen gemaakt." };
}
