// BESTAANDE KLANTEN: de warmste route naar nieuwe opdrachten.
// - Review: eerlijk en zonder beloning (Google-regels), alleen met jouw Google-reviewlink.
// - Verwijzen: eigen link per klant (?ref=…, herkend bij een aanvraag); een beloning noemt HQ
//   alleen als jij er zelf een regel voor instelt (Kantoor › Instellingen).
// - Onderhoud: de twee onderhoudsopties met prijs en omschrijving uit CONFIG.
// Berichten staan klaar en jij verstuurt ze zelf (WhatsApp-knop, of e-mail vanuit HQ).
// Grond: bestaande klant, voor eigen vergelijkbare diensten, met in elk bericht de mogelijkheid
// om af te melden (Telecommunicatiewet art. 11.7 lid 3); afmeldingen gelden voor alles.
import { q, one, tx, audit } from "../db.js";
import { HttpError, str } from "../http.js";
import { env } from "../env.js";
import { normalizeDomain, companyKey } from "../crm.js";
import { SITE } from "../content/studio.js";
import { normEmail, normPhone, contactCheck, recordConsent, WA_OPT_OUT } from "./contact.js";

export const CAMPAIGNS = {
  review: { kind: "review_verzoek", label: "Google-review vragen", subject: "Wil je iets over StrakWerk vertellen?" },
  verwijzing: { kind: "verwijzing", label: "Verwijslink sturen", subject: "Ken je iemand die een website kan gebruiken?" },
  onderhoud: { kind: "onderhoud", label: "Onderhoud aanbieden", subject: "Je website bijhouden" },
};
const BASIS_SCOPE = "Eigen, vergelijkbare diensten van StrakWerk (onderhoud, uitbreiding, review- en verwijsverzoek), met afmeldmogelijkheid in elk bericht";

/** Grond "bestaande klant" vastleggen voor de bekende kanalen (alleen als er nog geen is). */
export async function customerBasis(leadId, { source, evidence, channels = null }, auth = null, db = null) {
  const run = async (d) => {
    const lead = (await d.query("select id, contact_email, contact_phone from hq.leads where id=$1", [leadId])).rows[0];
    if (!lead) return [];
    const chans = (channels || [lead.contact_email ? "email" : null, normPhone(lead.contact_phone) ? "whatsapp" : null, normPhone(lead.contact_phone) ? "telefoon" : null]).filter(Boolean);
    const done = [];
    for (const ch of chans) {
      const has = (await d.query("select 1 from hq.consents where lead_id=$1 and channel=$2 and basis='bestaande_klant' and revoked_at is null", [lead.id, ch])).rows[0];
      if (!has) await recordConsent(lead.id, { channel: ch, basis: "bestaande_klant", source, scope: BASIS_SCOPE, evidence }, auth, d);
      done.push(ch);
    }
    return done;
  };
  return db ? run(db) : tx(run);
}

/** Klantlijst importeren (klanten van vóór HQ). Alleen met jouw bevestiging over de herkomst. */
export async function importClients(body, auth, { env: envName = "productie" } = {}) {
  if (body?.confirmed !== true) throw new HttpError(400, "bevestigen", "Bevestig dat je deze gegevens kreeg bij de verkoop van een website aan deze klanten. Alleen dan mag je ze benaderen over eigen, vergelijkbare diensten.");
  // Mail en WhatsApp aan een bestaande klant mogen alleen als die bij het geven van zijn gegevens
  // de kans kreeg om bezwaar te maken. Zo niet: alleen bellen (klant of oud-klant), en tijdens
  // dat gesprek vragen of je berichten mag sturen.
  if (typeof body.optout_offered !== "boolean") throw new HttpError(400, "bevestigen", "Geef aan of deze klanten bij het geven van hun gegevens de kans kregen om berichten te weigeren.");
  const optout = body.optout_offered;
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 200) : [];
  if (!rows.length) throw new HttpError(400, "ongeldig", "Geen klanten om te importeren.");
  const isTest = envName === "test";
  const out = { nieuw: 0, bijgewerkt: 0, overgeslagen: [] };
  for (const raw of rows) {
    const company = str(raw?.company, 160);
    const email = raw?.email ? normEmail(str(raw.email, 254)) : null;
    const phone = raw?.phone ? normPhone(str(raw.phone, 40)) : null;
    const website = str(raw?.website, 300) || null;
    if (!company) { out.overgeslagen.push({ rij: raw, reden: "bedrijfsnaam ontbreekt" }); continue; }
    if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { out.overgeslagen.push({ bedrijf: company, reden: "ongeldig e-mailadres" }); continue; }
    if (phone && !/^\+\d{9,15}$/.test(phone)) { out.overgeslagen.push({ bedrijf: company, reden: "ongeldig telefoonnummer" }); continue; }
    const domain = normalizeDomain(website);
    await tx(async (db) => {
      let lead = (await db.query(`select * from hq.leads where is_test=$5 and ((lower(contact_email)=$1 and $1 is not null) or (contact_phone=$2 and $2 is not null) or (domain=$3 and $3 is not null) or company_key=$4) order by created_at limit 1`,
        [email, phone, domain, companyKey(company), isTest])).rows[0];
      if (lead) {
        lead = (await db.query(`update hq.leads set contact_name=coalesce(contact_name,$2), contact_email=coalesce(contact_email,$3), contact_phone=coalesce(contact_phone,$4), website=coalesce(website,$5), domain=coalesce(domain,$6),
            status='gewonnen', sales_channel=coalesce(sales_channel,'bestaande_klant'), updated_at=now() where id=$1 returning *`, [lead.id, str(raw.contact_name, 120), email, phone, website, domain])).rows[0];
        out.bijgewerkt++;
      } else {
        lead = (await db.query(`insert into hq.leads (company, company_key, website, domain, source, contact_name, contact_email, contact_phone, status, sales_channel, notes, is_test, created_by)
            values ($1,$2,$3,$4,'bestaande_klant',$5,$6,$7,'gewonnen','bestaande_klant',$8,$9,$10) returning *`,
          [company, companyKey(company), website, domain, str(raw.contact_name, 120), email, phone, str(raw.note, 1000) || "", isTest, auth?.userId || null])).rows[0];
        await db.query("insert into hq.lead_history (lead_id, actor, actor_label, to_status, note) values ($1,$2,$3,'gewonnen','Bestaande klant (import)')", [lead.id, auth?.userId || null, auth?.email || "systeem"]);
        out.nieuw++;
      }
      await customerBasis(lead.id, { source: "Klant van StrakWerk (klantlijst ingevoerd door Rayan)",
        channels: [optout && email ? "email" : null, optout && phone ? "whatsapp" : null, phone ? "telefoon" : null].filter(Boolean),
        evidence: `Rayan bevestigde bij het invoeren dat deze gegevens zijn verkregen bij de verkoop van een website aan ${company}${optout ? ", en dat de klant daarbij de kans kreeg om berichten te weigeren" : " (mail en WhatsApp pas na toestemming; bellen mag)"}.` }, auth, db);
    });
  }
  await audit(null, { actor: auth?.userId || null, label: auth?.email || "systeem", action: "klanten.import", entity: "lead", details: { nieuw: out.nieuw, bijgewerkt: out.bijgewerkt, overgeslagen: out.overgeslagen.length } });
  return out;
}

const firstName = (l) => (l.contact_name ? ` ${String(l.contact_name).split(" ")[0]}` : "");
export const referralLink = (leadId) => `${env.siteUrl}/?ref=${String(leadId).slice(0, 8)}`;
const option = (id) => (SITE.options || []).find(o => o.id === id);

/** Tekst per campagne; prijzen en omschrijvingen alleen uit CONFIG, links uit je instellingen. */
export function campaignText(kind, lead, links = {}, channel = "whatsapp") {
  const hi = `Hoi${firstName(lead)},`;
  const end = `\n\nGroet,\nRayan\nStrakWerk${channel === "whatsapp" ? `\n\n${WA_OPT_OUT}` : ""}`;
  if (kind === "review") {
    if (!links.google_review_url) throw new HttpError(409, "reviewlink", "Stel eerst je Google-reviewlink in (Kantoor › Instellingen).");
    return `${hi}\n\nFijn dat we samen je website hebben gemaakt. Zou je een korte, eerlijke review willen achterlaten op Google? Dat helpt andere ondernemers bij hun keuze:\n${links.google_review_url}\n\nAlleen als je het wilt, natuurlijk. Dank je!${end}`;
  }
  if (kind === "verwijzing") {
    const reward = str(links.referral_reward, 120);
    return `${hi}\n\nKen je een ondernemer die ook een strakke website kan gebruiken? Stuur gerust deze link door, dan weet ik dat diegene via jou komt:\n${referralLink(lead.id)}${reward ? `\n\nLaat diegene via jou een website maken, dan krijg jij ${reward}.` : ""}\n\nDank je!${end}`;
  }
  if (kind === "onderhoud") {
    const a = option("onderhoud"), b = option("onderhoudplus");
    if (!a) throw new HttpError(409, "geen_optie", "Er staat geen onderhoudsoptie in de prijslijst.");
    const line = (o) => `${o.name} voor €${o.price_eur}${o.per ? ` per ${o.per}` : ""}: ${String(o.desc || "").replace(/\.$/, "").toLowerCase()}`;
    return `${hi}\n\nEen website blijft het best werken als hij bijgehouden wordt. Daarvoor heb ik ${b ? "twee mogelijkheden" : "een vaste regeling"}:\n- ${line(a)}${b ? `\n- ${line(b)}` : ""}\n\nZal ik je er meer over vertellen?${end}`;
  }
  throw new HttpError(400, "ongeldig", "Onbekende campagne.");
}

/**
 * Berichten klaarzetten voor bestaande klanten (status gewonnen). Per klant per maand hooguit
 * één bericht per campagne; contactregels (afmelding, grond, tussenpoos) gelden zoals altijd.
 */
export async function prepareCampaign(body, auth, { env: envName = "productie" } = {}) {
  const kind = String(body?.kind || "");
  const c = CAMPAIGNS[kind];
  if (!c) throw new HttpError(400, "ongeldig", "Kies review, verwijzing of onderhoud.");
  const links = (await one("select value from hq.settings where key='links'"))?.value || {};
  if (kind === "review" && !links.google_review_url) throw new HttpError(409, "reviewlink", "Stel eerst je Google-reviewlink in (Kantoor › Instellingen).");
  const ids = Array.isArray(body.lead_ids) ? body.lead_ids.filter(x => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 200) : null;
  const leads = (await q(`select * from hq.leads where status='gewonnen' and is_test=$1 ${ids ? "and id = any($2::uuid[])" : ""} order by company limit 200`, ids ? [envName === "test", ids] : [envName === "test"])).rows;
  const month = new Date().toISOString().slice(0, 7);
  const out = { klaar: 0, al_klaar: 0, overgeslagen: [] };
  for (const lead of leads) {
    const channel = normPhone(lead.contact_phone) ? "whatsapp" : lead.contact_email ? "email" : null;
    if (!channel) { out.overgeslagen.push({ bedrijf: lead.company, reden: "geen telefoon of e-mail" }); continue; }
    const chk = await contactCheck(lead, channel, { kind: c.kind });
    if (!chk.allowed) { out.overgeslagen.push({ bedrijf: lead.company, reden: chk.reasons.join("; ") }); continue; }
    const basis = await one("select 1 from hq.consents where lead_id=$1 and channel=$2 and revoked_at is null and basis in ('bestaande_klant','toestemming')", [lead.id, channel]);
    if (!basis) { out.overgeslagen.push({ bedrijf: lead.company, reden: "geen grond voor berichten over andere diensten: bel en vraag het eerst (bellen mag bij een klant)" }); continue; }
    const text = campaignText(kind, lead, links, channel);
    const r = await q(`insert into hq.outreach (lead_id, channel, kind, status, subject, body, to_address, idempotency_key, is_test)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (idempotency_key) do nothing returning id`,
      [lead.id, channel, c.kind, channel === "whatsapp" ? "klaar_handmatig" : "concept", c.subject, text, channel === "email" ? lead.contact_email : lead.contact_phone, `campagne:${kind}:${lead.id}:${month}`, lead.is_test]);
    if (r.rowCount) out.klaar++; else out.al_klaar++;
  }
  await audit(null, { actor: auth?.userId || null, label: auth?.email || "systeem", action: "klanten.campagne", entity: "lead", details: { kind, ...out, overgeslagen: out.overgeslagen.length } });
  return out;
}
