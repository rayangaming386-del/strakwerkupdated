// Openbare offertepagina (/offerte?t=…): de klant bekijkt zijn offerte op zijn telefoon en
// geeft met één knop akkoord. Daarna: aanbetaling (standaard 50%) met de juiste betaalgegevens,
// en meteen de persoonlijke intake-link. Rayan krijgt bij bekijken en akkoord een melding.
import { createHash } from "node:crypto";
import { one, q } from "../db.js";
import { HttpError, str } from "../http.js";
import { checkLinkToken, intakeToken } from "./tokens.js";
import { customerBasis } from "./clients.js";
import { acceptQuote, paymentSettings } from "./sales.js";
import { notify } from "./notify.js";
import { SITE } from "../content/studio.js";

const cents = (c) => Math.round(Number(c) || 0) / 100;
export const paymentReference = (quoteId) => `SW-${String(quoteId).slice(0, 8).toUpperCase()}`;

function quoteIdFrom(token) {
  const id = checkLinkToken("offerte", token);
  if (!id) throw new HttpError(404, "niet_gevonden", "Deze offertelink klopt niet. Vraag Rayan om een nieuwe link.");
  return id;
}

/** Offerte voor de klant. Telt een weergave (niet als Rayan zelf ingelogd kijkt). */
export async function quoteView(token, { countView = true } = {}) {
  const id = quoteIdFrom(token);
  const qu = await one(`select q.*, l.company, l.contact_name from hq.quotes q join hq.leads l on l.id = q.lead_id where q.id = $1`, [id]);
  if (!qu || qu.status === "concept") throw new HttpError(404, "niet_gevonden", "Deze offerte is nog niet verstuurd.");
  if (["afgewezen", "vervallen"].includes(qu.status)) throw new HttpError(410, "niet_geldig", "Deze offerte is niet meer geldig. Stuur Rayan een berichtje voor een nieuwe.");
  const expired = qu.status === "verstuurd" && qu.valid_until && new Date(qu.valid_until) < new Date();
  if (countView && qu.status === "verstuurd") {
    const r = (await q("update hq.quotes set view_count = view_count + 1, viewed_at = coalesce(viewed_at, now()) where id = $1 returning (view_count = 1) as first", [id])).rows[0];
    if (r?.first) await notify({ key: `offerte_bekeken:${id}`, kind: "offerte_bekeken", title: `${qu.company} bekijkt je offerte`,
      body: `Offerte van €${cents(qu.price_cents)} wordt nu bekeken. Goed moment om even te bellen of te appen.`, leadId: qu.lead_id, url: `/hq/klanten?id=${qu.lead_id}`, isTest: qu.is_test });
  }
  const items = (qu.items || []).map(i => ({ name: i.name, price_eur: i.price_eur, per: i.per || null, note: i.note || null }));
  const accepted = qu.status === "geaccepteerd";
  const pay = await paymentSettings();
  const deposit = qu.deposit_cents ?? Math.round(qu.price_cents * pay.deposit_pct / 100);
  let intake = null;
  if (accepted) {
    const p = await one("select id, intake_token_hash from hq.projects where lead_id = $1", [qu.lead_id]);
    const t = p ? intakeToken(p.id) : null;
    if (t && p.intake_token_hash === createHash("sha256").update(t).digest("hex")) intake = `/intake?t=${t}`;
  }
  return {
    company: qu.company, first_name: qu.contact_name ? String(qu.contact_name).split(" ")[0] : null,
    description: qu.description || "", items, extras: (qu.extras || []).map(e => ({ omschrijving: e.omschrijving, prijs_eur: e.prijs_eur })),
    total_eur: cents(qu.price_cents), monthly_eur: items.filter(i => i.per === "maand").reduce((s, i) => s + (Number(i.price_eur) || 0), 0),
    deposit_pct: qu.deposit_pct ?? pay.deposit_pct, deposit_eur: cents(deposit), rest_eur: cents(qu.price_cents - deposit),
    terms: qu.terms || "", info_needed: qu.info_needed || [], next_step: qu.next_step || "", earliest_start: qu.earliest_start,
    valid_until: qu.valid_until, expired: Boolean(expired), status: qu.status,
    accepted: accepted ? { at: qu.accepted_at, name: qu.accepted_name } : null,
    payment: accepted ? { amount_eur: cents(deposit), iban: pay.iban, account_name: pay.account_name, reference: paymentReference(id),
      note: pay.iban ? null : "Je ontvangt binnen één werkdag een betaalverzoek van Rayan." } : null,
    intake_url: intake,
    contact: { whatsapp: SITE.brand.whatsapp, phone: SITE.brand.phone, email: SITE.brand.email },
    test: qu.is_test,
  };
}

/** Akkoord door de klant zelf (naam + vinkje). Herhaald akkoord = zelfde uitkomst. */
export async function quoteAccept(token, body, { ip = "" } = {}) {
  const id = quoteIdFrom(token);
  const name = str(body?.name, 120);
  if (!name || name.length < 2) throw new HttpError(400, "ongeldig", "Vul je naam in.");
  if (body?.agree !== true) throw new HttpError(400, "ongeldig", "Vink aan dat je akkoord gaat met de offerte en de voorwaarden.");
  const qu = await one("select status, valid_until, lead_id, is_test from hq.quotes where id = $1", [id]);
  if (!qu || qu.status === "concept") throw new HttpError(404, "niet_gevonden", "Deze offerte is nog niet verstuurd.");
  if (qu.status === "geaccepteerd") return quoteView(token, { countView: false });
  if (qu.status !== "verstuurd") throw new HttpError(410, "niet_geldig", "Deze offerte is niet meer geldig. Stuur Rayan een berichtje voor een nieuwe.");
  if (qu.valid_until && new Date(qu.valid_until) < new Date()) throw new HttpError(410, "verlopen", "Deze offerte is verlopen. Stuur Rayan een berichtje: hij maakt graag een nieuwe.");
  const ipHash = ip ? createHash("sha256").update(`${ip}|${new Date().toISOString().slice(0, 10)}|offerte`).digest("hex").slice(0, 32) : null;
  await acceptQuote(id, null, { via: "klant_online", name, ipHash });
  const noMarketing = body?.no_marketing === true;
  await q("insert into hq.interactions (lead_id, direction, channel, kind, classification, body, quote_id, is_test, created_label) values ($1,'in','formulier','bericht','interesse',$2,$3,$4,'offertepagina')",
    [qu.lead_id, `Offerte online geaccepteerd door ${name}.${noMarketing ? " Wil geen berichten over andere diensten." : ""}`, id, qu.is_test]);
  // Bestaande klant: berichten over eigen, vergelijkbare diensten mogen, want bij het akkoord
  // kreeg de klant de kans om dat te weigeren (vinkje) en elk bericht heeft een afmeldregel.
  if (!noMarketing) await customerBasis(qu.lead_id, { source: `Offerte online geaccepteerd door ${name}`,
    evidence: "Bij het akkoord stond: 'Na de oplevering stuur ik je soms een bericht over je website, bijvoorbeeld over onderhoud. Afmelden kan altijd.' Het vinkje 'Liever geen berichten over andere diensten' stond uit." });
  return quoteView(token, { countView: false });
}
