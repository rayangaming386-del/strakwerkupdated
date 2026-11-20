import { q, one, tx, audit } from "./db.js";
import { HttpError, str, assertUuid } from "./http.js";

export const LEAD_STATUS = ["nieuw", "onderzocht", "goedgekeurd", "benaderd", "gesprek", "offerte", "gewonnen", "verloren"];
export const LEAD_STATUS_LABEL = { nieuw: "Nieuw", onderzocht: "Onderzocht", goedgekeurd: "Goedgekeurd voor benadering", benaderd: "Benaderd", gesprek: "Gesprek", offerte: "Offerte", gewonnen: "Gewonnen", verloren: "Verloren" };
// Bronnen. Alleen "aanvraag_*" telt als bevestigde, binnengekomen aanvraag (lead_received).
export const SOURCES = { handmatig: "Handmatig onderzocht", aanvraag_whatsapp: "Aanvraag via WhatsApp", aanvraag_email: "Aanvraag via e-mail", aanvraag_telefoon: "Aanvraag via telefoon", aanvraag_anders: "Aanvraag (anders)", netwerk: "Netwerk / doorverwijzing" };

export function normalizeDomain(website) {
  if (!website) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    const h = u.hostname.toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? h : null;
  } catch { return null; }
}
export const companyKey = (name) => String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\b(b\.?v\.?|v\.?o\.?f\.?|eenmanszaak|holding)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

function leadFields(b, partial = false) {
  const out = {};
  if (!partial || "company" in b) { out.company = str(b.company, 160); if (!out.company) throw new HttpError(400, "ongeldig", "Bedrijfsnaam is verplicht."); }
  if ("website" in b) {
    out.website = str(b.website, 300);
    if (out.website && !normalizeDomain(out.website)) throw new HttpError(400, "ongeldig", "Ongeldige website.");
  }
  if ("source" in b) { out.source = SOURCES[b.source] ? b.source : "handmatig"; }
  for (const k of ["source_url", "city", "contact_name", "contact_phone", "notes", "lost_reason"]) if (k in b) out[k] = str(b[k], k === "notes" ? 5000 : 300) ?? (k === "notes" ? "" : null);
  if ("contact_email" in b) { out.contact_email = str(b.contact_email, 254); if (out.contact_email && !EMAIL.test(out.contact_email)) throw new HttpError(400, "ongeldig", "Ongeldig e-mailadres."); }
  if ("next_action_at" in b) { out.next_action_at = b.next_action_at && /^\d{4}-\d{2}-\d{2}$/.test(b.next_action_at) ? b.next_action_at : null; }
  if ("owner_user_id" in b) out.owner_user_id = b.owner_user_id ? assertUuid(b.owner_user_id, "verantwoordelijke") : null;
  return out;
}

export async function findDuplicate(db, { company, website }, exceptId = null) {
  const domain = normalizeDomain(website);
  // Dubbel = zelfde domein, of zelfde genormaliseerde naam als één van beide geen website heeft.
  const vals = [domain, companyKey(company)];
  if (exceptId) vals.push(exceptId);
  const r = (await db.query(
    `select id, company, website, status from hq.leads
     where ((domain is not null and domain=$1) or (company_key=$2 and (domain is null or $1::text is null)))
     ${exceptId ? "and id<>$3" : ""} limit 1`, vals)).rows[0];
  return r || null;
}

export async function createLead(body, auth) {
  const f = leadFields(body);
  return tx(async (db) => {
    const dup = await findDuplicate(db, { company: f.company, website: f.website });
    if (dup) throw new HttpError(409, "dubbel", `Deze lead bestaat al: ${dup.company}.`, { details: { id: dup.id } });
    const lead = (await db.query(
      `insert into hq.leads (company, company_key, website, domain, source, source_url, city, contact_name, contact_email, contact_phone, notes, next_action_at, owner_user_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,''),$12,$13,$14) returning *`,
      [f.company, companyKey(f.company), f.website || null, normalizeDomain(f.website), f.source || "handmatig", f.source_url || null, f.city || null,
       f.contact_name || null, f.contact_email || null, f.contact_phone || null, f.notes, f.next_action_at || null, f.owner_user_id || auth.userId, auth.userId])).rows[0];
    await db.query("insert into hq.lead_history (lead_id, actor, actor_label, to_status, note) values ($1,$2,$3,'nieuw','Lead aangemaakt')", [lead.id, auth.userId, auth.email]);
    await audit(db, { actor: auth.userId, label: auth.email, action: "lead.aangemaakt", entity: "lead", entityId: lead.id, details: { bron: lead.source } });
    return lead;
  });
}

export async function updateLead(id, body, auth) {
  assertUuid(id);
  const f = leadFields(body, true);
  const status = body.status != null ? String(body.status) : null;
  if (status && !LEAD_STATUS.includes(status)) throw new HttpError(400, "ongeldig", "Ongeldige status.");
  return tx(async (db) => {
    const cur = (await db.query("select * from hq.leads where id=$1 for update", [id])).rows[0];
    if (!cur) throw new HttpError(404, "niet_gevonden", "Lead niet gevonden.");
    if (f.company || "website" in f) {
      const dup = await findDuplicate(db, { company: f.company || cur.company, website: "website" in f ? f.website : cur.website }, id);
      if (dup) throw new HttpError(409, "dubbel", `Er bestaat al een lead met deze naam of website: ${dup.company}.`, { details: { id: dup.id } });
    }
    const sets = [], vals = [id];
    const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
    for (const [k, v] of Object.entries(f)) add(k, v);
    if (f.company) add("company_key", companyKey(f.company));
    if ("website" in f) add("domain", normalizeDomain(f.website));
    if (status && status !== cur.status) add("status", status);
    if (!sets.length) return cur;
    const lead = (await db.query(`update hq.leads set ${sets.join(", ")}, updated_at=now() where id=$1 returning *`, vals)).rows[0];
    if (status && status !== cur.status) {
      await db.query("insert into hq.lead_history (lead_id, actor, actor_label, from_status, to_status, note) values ($1,$2,$3,$4,$5,$6)", [id, auth.userId, auth.email, cur.status, status, str(body.status_note, 300)]);
    }
    await audit(db, { actor: auth.userId, label: auth.email, action: "lead.gewijzigd", entity: "lead", entityId: id, details: { velden: Object.keys(f), status: status || undefined } });
    return lead;
  });
}

export async function listLeads({ status, search } = {}) {
  const where = [], vals = [];
  if (status && LEAD_STATUS.includes(status)) { vals.push(status); where.push(`l.status=$${vals.length}`); }
  if (search) { vals.push(`%${String(search).toLowerCase().slice(0, 80)}%`); where.push(`(lower(l.company) like $${vals.length} or l.domain like $${vals.length})`); }
  return (await q(`select l.*, m.email as owner_email,
      (select count(*)::int from hq.tasks t where t.lead_id=l.id) as task_count,
      (select coalesce(sum(price_cents),0)::int from hq.quotes qq where qq.lead_id=l.id and qq.status='geaccepteerd') as won_cents
    from hq.leads l left join hq.members m on m.user_id=l.owner_user_id
    ${where.length ? "where " + where.join(" and ") : ""} order by l.updated_at desc limit 300`, vals)).rows;
}

export async function leadDetail(id) {
  assertUuid(id);
  const lead = await one("select l.*, m.email as owner_email from hq.leads l left join hq.members m on m.user_id=l.owner_user_id where l.id=$1", [id]);
  if (!lead) throw new HttpError(404, "niet_gevonden", "Lead niet gevonden.");
  const [history, tasks, quotes, payments, approvals] = await Promise.all([
    q("select * from hq.lead_history where lead_id=$1 order by at desc limit 50", [id]),
    q("select id, agent_key, kind, title, status, created_at, finished_at, error, result from hq.tasks where lead_id=$1 order by created_at desc limit 30", [id]),
    q("select qq.*, p.name as package_name from hq.quotes qq join hq.packages p on p.key=qq.package_key where lead_id=$1 order by created_at desc", [id]),
    q("select * from hq.payments where lead_id=$1 order by received_on desc", [id]),
    q("select id, kind, status, title, requested_at, decided_at, used_at from hq.approvals where lead_id=$1 order by requested_at desc", [id]),
  ]);
  return { lead, history: history.rows, tasks: tasks.rows, quotes: quotes.rows, payments: payments.rows, approvals: approvals.rows };
}

// ── Offertes: prijs en voorwaarden komen altijd uit hq.packages ────────────
export async function createQuote(leadId, body, auth) {
  assertUuid(leadId, "lead");
  return tx(async (db) => {
    const pkg = (await db.query("select * from hq.packages where key=$1 and active", [String(body.package_key || "")])).rows[0];
    if (!pkg) throw new HttpError(400, "ongeldig", "Onbekend of inactief pakket.");
    if (!pkg.terms.trim()) throw new HttpError(409, "geen_voorwaarden", `Voor pakket ${pkg.name} zijn nog geen voorwaarden vastgelegd. Een eigenaar vult die in bij Instellingen › Pakketten.`);
    const lead = (await db.query("select id, status from hq.leads where id=$1 for update", [leadId])).rows[0];
    if (!lead) throw new HttpError(404, "niet_gevonden", "Lead niet gevonden.");
    const quote = (await db.query(
      "insert into hq.quotes (lead_id, package_key, price_cents, terms, note, created_by) values ($1,$2,$3,$4,$5,$6) returning *",
      [leadId, pkg.key, pkg.price_cents, pkg.terms, str(body.note, 1000) || "", auth.userId])).rows[0];
    await audit(db, { actor: auth.userId, label: auth.email, action: "offerte.concept", entity: "quote", entityId: quote.id, details: { pakket: pkg.key, prijs_cents: pkg.price_cents } });
    return quote;
  });
}

export async function requestQuoteApproval(quoteId, auth) {
  assertUuid(quoteId);
  return tx(async (db) => {
    const qu = (await db.query("select qq.*, p.name, l.company from hq.quotes qq join hq.packages p on p.key=qq.package_key join hq.leads l on l.id=qq.lead_id where qq.id=$1 for update of qq", [quoteId])).rows[0];
    if (!qu) throw new HttpError(404, "niet_gevonden", "Offerte niet gevonden.");
    if (qu.status !== "concept") throw new HttpError(409, "ongeldige_overgang", "Alleen een concept kan ter goedkeuring worden voorgelegd.");
    const open = (await db.query("select id from hq.approvals where kind='offerte' and status='open' and (proposal->>'quote_id')=$1", [quoteId])).rows[0];
    if (open) return { id: open.id, duplicate: true };
    const { stableHash } = await import("./worker.js");
    const proposal = { quote_id: qu.id, bedrijf: qu.company, pakket: qu.name, prijs_cents: qu.price_cents, voorwaarden: qu.terms, notitie: qu.note };
    const a = (await db.query("insert into hq.approvals (kind, lead_id, title, proposal, proposal_hash, rationale) values ('offerte',$1,$2,$3,$4,$5) returning id",
      [qu.lead_id, `Offerte ${qu.name} voor ${qu.company}`, proposal, stableHash(proposal), { let_op: "Prijs en voorwaarden komen uit de vastgelegde pakketten; niet aangepast door een agent." }])).rows[0];
    await audit(db, { actor: auth.userId, label: auth.email, action: "offerte.ter_goedkeuring", entity: "quote", entityId: quoteId });
    return { id: a.id };
  });
}

export async function setQuoteStatus(quoteId, status, auth) {
  assertUuid(quoteId);
  if (!["geaccepteerd", "afgewezen", "vervallen"].includes(status)) throw new HttpError(400, "ongeldig", "Ongeldige status.");
  return tx(async (db) => {
    const qu = (await db.query("select * from hq.quotes where id=$1 for update", [quoteId])).rows[0];
    if (!qu) throw new HttpError(404, "niet_gevonden", "Offerte niet gevonden.");
    if (qu.status !== "verstuurd") throw new HttpError(409, "ongeldige_overgang", "Alleen een verstuurde offerte kan worden geaccepteerd of afgewezen.");
    await db.query("update hq.quotes set status=$2, decided_at=now() where id=$1", [quoteId, status]);
    if (status === "geaccepteerd") {
      const l = (await db.query("update hq.leads set status='gewonnen', updated_at=now() where id=$1 and status<>'gewonnen' returning id", [qu.lead_id])).rows[0];
      if (l) await db.query("insert into hq.lead_history (lead_id, actor, actor_label, to_status, note) values ($1,$2,$3,'gewonnen','Offerte geaccepteerd')", [qu.lead_id, auth.userId, auth.email]);
    }
    await audit(db, { actor: auth.userId, label: auth.email, action: `offerte.${status}`, entity: "quote", entityId: quoteId });
    return { ok: true };
  });
}

export async function addPayment(leadId, body, auth) {
  assertUuid(leadId, "lead");
  const cents = Math.round(Number(body.amount_eur) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > 10_000_000) throw new HttpError(400, "ongeldig", "Ongeldig bedrag.");
  const on = /^\d{4}-\d{2}-\d{2}$/.test(body.received_on || "") ? body.received_on : null;
  if (!on) throw new HttpError(400, "ongeldig", "Ontvangstdatum is verplicht.");
  const p = await one("insert into hq.payments (lead_id, quote_id, amount_cents, received_on, note, created_by) values ($1,$2,$3,$4,$5,$6) returning *",
    [leadId, body.quote_id ? assertUuid(body.quote_id) : null, cents, on, str(body.note, 300) || "", auth.userId]);
  await audit(null, { actor: auth.userId, label: auth.email, action: "betaling.geregistreerd", entity: "payment", entityId: p.id, details: { bedrag_cents: cents } });
  return p;
}

export async function deleteLead(id, auth) {
  assertUuid(id);
  const r = await one("delete from hq.leads where id=$1 returning company", [id]);
  if (!r) throw new HttpError(404, "niet_gevonden", "Lead niet gevonden.");
  await audit(null, { actor: auth.userId, label: auth.email, action: "lead.verwijderd", entity: "lead", entityId: id });
  return { ok: true };
}

export async function crmMetrics() {
  return one(`select
    (select count(*)::int from hq.leads where source like 'aanvraag_%' and created_at >= date_trunc('day', now() at time zone 'Europe/Amsterdam') at time zone 'Europe/Amsterdam') as requests_today,
    (select count(*)::int from hq.leads where source like 'aanvraag_%' and created_at >= now() - interval '30 days') as requests_30d,
    (select count(*)::int from hq.quotes where status='verstuurd') as open_quotes,
    (select coalesce(sum(price_cents),0)::int from hq.quotes where status='verstuurd') as open_quotes_cents,
    (select count(*)::int from hq.leads where status='gewonnen') as won_count,
    (select coalesce(sum(price_cents),0)::int from hq.quotes where status='geaccepteerd') as won_cents,
    (select coalesce(sum(amount_cents),0)::int from hq.payments) as received_cents,
    (select count(*)::int from hq.leads) as lead_count`);
}
