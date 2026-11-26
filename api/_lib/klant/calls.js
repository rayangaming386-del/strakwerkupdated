// BELLEN EN LANGSGAAN: elke werkdag een korte lijst bedrijven met de meeste kans, elk met een
// belcoach (opening, aanleiding met bewijs, vragen, voorstel met prijs uit de prijslijst,
// antwoorden op bezwaren). Na het gesprek één tik op de uitkomst. Zegt iemand "stuur maar",
// dan wordt die toestemming vastgelegd en staat er meteen een persoonlijk bericht klaar
// (met de voorbeeldsite). Mail of WhatsApp zonder toestemming kan hier niet.
// Bellen alleen waar het mag (Telecommunicatiewet, sinds 1 juli 2021): een bv, nv, stichting,
// vereniging of coöperatie, of met toestemming, of een (oud-)klant. Een eenmanszaak, vof of
// maatschap bel je niet ongevraagd: daar is langsgaan de route, alleen bij echte potentie
// (bewezen probleem of geen eigen site, actief bedrijf, adres bekend), of na een positief gesprek.
import { q, one, tx, audit } from "../db.js";
import { HttpError, assertUuid, str } from "../http.js";
import { enqueue } from "../queue.js";
import { SITE, amsParts } from "../content/studio.js";
import { salesAiSettings } from "../budget.js";
import { structured, llmConfigured, refreshAi } from "../agents/llm.js";
import { suppress, recordConsent, contactCheck, validConsent, normEmail, normPhone, phoneAllowed, WA_OPT_OUT } from "./contact.js";
import { RECHTSPERSONEN } from "./legalform.js";
import { safeText } from "./claims.js";
import { quoteLines } from "./sales.js";

export const OUTCOMES = { geen_gehoor: "Geen gehoor", terugbellen: "Terugbellen", interesse: "Interesse", afspraak: "Afspraak gemaakt", offerte: "Wil een offerte", geen_interesse: "Geen interesse", niet_bellen: "Niet meer benaderen" };
export const amsDay = (d = new Date()) => { const p = amsParts(d); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };
const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const FEATURE = { salons: "booking", autobedrijven: "kenteken", dienstverleners: "aanvraag" };
// Bellen mag (bij een rechtspersoon) alleen met de mogelijkheid om bezwaar te maken, in elk gesprek.
const VERZET = "Wil je liever niet meer gebeld worden? Zeg het gerust, dan noteer ik dat meteen.";

/** Passend voorstel met prijzen uit de prijslijst (CONFIG): nooit een verzonnen bedrag. */
export function proposalFor(lead, opp) {
  const noSite = ["geen_gevonden", "alleen_sociaal"].includes(lead.website_status) || !lead.website;
  const pkg = noSite ? "nieuw" : "redesign";
  const feat = opp?.service_key && opp.service_key !== "redesign" ? opp.service_key : FEATURE[lead.segment] || null;
  const opts = feat && SITE.options.some(o => o.id === feat) && !(SITE.bases[pkg]?.incl || {})[feat] ? [feat] : [];
  const ql = quoteLines(pkg, opts);
  const b = SITE.bases[pkg];
  const extra = ql.lines.slice(1).map(l => `${l.name.toLowerCase()} (+€${l.price_eur})`).join(", ");
  return { package: pkg, options: opts, total_eur: ql.once_eur,
    tekst: `${noSite ? "Een eigen website" : "Je huidige site vernieuwd"}: pakket ${b.name} voor €${b.price_eur}${extra ? `, met ${extra}` : ""}. Samen €${ql.once_eur} eenmalig.` };
}

/** Belcoach (of bezoekcoach) met vaste, eerlijke teksten: werkt altijd, ook zonder AI. */
export function rulesBriefing(lead, opp, prop, kind = "bellen") {
  const visit = kind === "bezoek";
  const noSite = ["geen_gevonden", "alleen_sociaal"].includes(lead.website_status) || !lead.website;
  const obs = opp?.observation ? lowerFirst(String(opp.observation).replace(/\.$/, "")) : null;
  const aanleiding = obs ? `Ik keek op mijn telefoon naar jullie website en zag dat ${obs}.`
    : noSite ? `Ik zocht ${lead.company} op en vond geen eigen website.` : `Ik keek naar jullie website op mijn telefoon.`;
  const vragen = ["Hoe komen nieuwe klanten nu bij jullie binnen?", lead.segment === "salons" ? "Hoe maken klanten nu een afspraak?" : lead.segment === "autobedrijven" ? "Hoe vragen klanten nu een afspraak of prijs aan?" : "Hoe vragen klanten nu een offerte aan?", "Wat zou je het liefst anders zien?"];
  const bezwaren = [
    { bezwaar: "Geen tijd", antwoord: visit ? "Snap ik, ik houd het kort. Mag ik je een voorbeeld van je nieuwe site appen? Dan kijk je wanneer het jou uitkomt." : "Snap ik helemaal. Ik maak het makkelijk: ik stuur je een voorbeeld van je nieuwe site en je kijkt wanneer het jou uitkomt. Mag ik het je appen?" },
    { bezwaar: "Te duur", antwoord: `Bij mij kost een complete site vanaf €${SITE.bases.nieuw.price_eur}, eenmalig. Je ziet eerst een voorbeeld en beslist pas daarna.` },
    { bezwaar: "Ik heb al Facebook of Instagram", antwoord: "Goed voor je zichtbaarheid. Een eigen site zorgt dat mensen die je op Google zoeken je direct kunnen bellen, appen of een afspraak maken." },
    { bezwaar: noSite ? "Ik heb niet echt een site nodig" : "Ik heb al een website", antwoord: noSite ? "Dat kan. Mag ik je laten zien hoe het eruit zou zien? Dan kun je het beter beoordelen." : opp ? "Klopt, en dat punt dat ik zag kan ik snel voor je oplossen. Mag ik je laten zien hoe?" : "Prima! Mag ik je laten zien hoe die op een telefoon nog beter kan werken?" },
    { bezwaar: "Stuur maar een mail", antwoord: "Doe ik graag. Op welk adres? Dan stuur ik je een voorbeeld van je nieuwe site." },
  ];
  if (visit) return {
    opening: `Goedendag, ik ben Rayan van StrakWerk, webdesign uit Zoetermeer. Komt het even uit, of zal ik op een rustiger moment terugkomen? ${aanleiding}`,
    aanleiding, vragen, voorstel: prop.tekst, bezwaren,
    afsluiter: "Mag ik je een voorbeeld van je nieuwe website appen of mailen? Of zal ik je volgende week even bellen? Dan noteer ik je nummer.",
    verzet: "Liever geen contact meer? Zeg het gerust, dan noteer ik dat en kom ik niet meer langs.",
    let_op: ["Kom op een rustig moment en vraag eerst of het uitkomt.", "Sticker 'geen verkopers' of 'geen colportage' op de deur: niet naar binnen.", "Maak het voorbeeld vooraf aan en laat het op je telefoon zien.", "Noem geen cijfers, resultaten of reviews die je niet zeker weet.", "Wil iemand geen contact meer: tik 'Niet meer benaderen'. Dat geldt dan voorgoed."],
  };
  return {
    opening: `Goedendag, je spreekt met Rayan van StrakWerk, webdesign uit Zoetermeer. Heb je een minuutje? ${aanleiding}`,
    aanleiding, vragen, voorstel: prop.tekst, bezwaren,
    afsluiter: "Mag ik je een voorbeeld van je nieuwe website appen of mailen? Dan kijk je wanneer het jou uitkomt.",
    verzet: VERZET,
    let_op: ["Bel met je eigen, zichtbare nummer (niet anoniem).", "Bied in elk gesprek de mogelijkheid om bezwaar te maken (zie 'verzet').", "Noem geen cijfers, resultaten of reviews die je niet zeker weet.", "Wil iemand niet meer gebeld worden: tik 'Niet meer benaderen'. Dat geldt dan voorgoed."],
  };
}

const AI_SCHEMA = {
  type: "object", additionalProperties: false, required: ["opening", "vragen", "bezwaren", "afsluiter"],
  properties: {
    opening: { type: "string" },
    vragen: { type: "array", items: { type: "string" } },
    bezwaren: { type: "array", items: { type: "object", additionalProperties: false, required: ["bezwaar", "antwoord"], properties: { bezwaar: { type: "string" }, antwoord: { type: "string" } } } },
    afsluiter: { type: "string" },
  },
};

/** Belcoach verbeteren met AI (binnen vaste regels); prijzen, voorstel en recht van bezwaar blijven uit de code. */
export async function aiBriefing(lead, opp, prop, rules, kind = "bellen") {
  if (!(await refreshAi()) || !llmConfigured()) return null;
  const visit = kind === "bezoek";
  try {
    const r = await structured({
      tier: "werk", post: "acquisitie", maxTokens: 1400,
      system: `Je helpt Rayan van StrakWerk (webdesign, Zoetermeer) ${visit ? "een kort, eerlijk bezoek aan de zaak" : "een kort, eerlijk belletje"} voor te bereiden met een lokale ondernemer. Nederlands, je-vorm, natuurlijk en kort (spreektaal). Verzin NOOIT feiten: geen cijfers, prijzen, resultaten, reviews, garanties of 'beste'; geen links. Gebruik alleen de aangeleverde observatie. De opening noemt wie Rayan is en waarom hij ${visit ? "langskomt, en vraagt of het uitkomt" : "belt"}. Lever precies 3 vragen en 4 bezwaren met antwoord. De afsluiter vraagt toestemming om een voorbeeld te appen of te mailen.`,
      instruction: "Schrijf de belcoach.",
      untrusted: { bedrijf: lead.company, plaats: lead.city, branche: lead.segment, websitestatus: lead.website_status, observatie: opp?.observation || null },
      schema: AI_SCHEMA,
    });
    const d = r.data;
    const bz = (Array.isArray(d.bezwaren) ? d.bezwaren : []).slice(0, 4).map((x, i) => ({ bezwaar: safeText(x?.bezwaar, rules.bezwaren[i]?.bezwaar, 60).text, antwoord: safeText(x?.antwoord, rules.bezwaren[i]?.antwoord, 300).text }));
    const vr = (Array.isArray(d.vragen) ? d.vragen : []).slice(0, 3).map((x, i) => safeText(x, rules.vragen[i], 140).text);
    return { ...rules,
      opening: safeText(d.opening, rules.opening, 400).text,
      vragen: vr.length === 3 ? vr : rules.vragen,
      // Het bezwaar "te duur" houdt altijd het echte bedrag uit de prijslijst.
      bezwaren: bz.length === 4 ? [...bz.filter(x => !/duur|prijs|kost/i.test(x.bezwaar)), rules.bezwaren[1]].slice(0, 5) : rules.bezwaren,
      afsluiter: safeText(d.afsluiter, rules.afsluiter, 220).text };
  } catch (e) {
    if (!e.budget) console.error(`[belcoach] AI niet gebruikt: ${e.message}`);
    return null;
  }
}

/** Uitvoerder (agent sales, kind belcoach): briefing van één regel op de lijst verbeteren. */
export async function runBriefingTask({ task, lead, ctx }) {
  const call = await one("select * from hq.calls where id=$1", [task.input?.call_id]);
  if (!call || !lead || call.outcome) return { status: "afgerond", result: { overgeslagen: true }, message: "Niets te doen." };
  await ctx.step(`${call.kind === "bezoek" ? "Bezoekcoach" : "Belcoach"} voor ${lead.company}`);
  const opp = await one("select observation, service_key, page_url from hq.opportunities where lead_id=$1 and strength='concreet' and verified<>'klopt_niet' order by created_at desc limit 1", [lead.id]);
  const prop = proposalFor(lead, opp);
  const better = await aiBriefing(lead, opp, prop, call.briefing || rulesBriefing(lead, opp, prop, call.kind), call.kind);
  if (better) await q("update hq.calls set briefing=$2, briefing_by='Claude' where id=$1 and outcome is null", [call.id, better]);
  return { status: "afgerond", result: { ai: Boolean(better) }, message: better ? "Belcoach verbeterd met AI." : "Belcoach met vaste teksten (AI niet beschikbaar)." };
}

// Mag bellen (SQL-voorselectie; phoneAllowed controleert daarna per bedrijf, met genormaliseerd nummer).
const CALLABLE = `(l.legal_form = any($4::text[]) or exists (select 1 from hq.consents cs where cs.lead_id=l.id and cs.channel='telefoon' and cs.revoked_at is null
  and cs.basis in ('toestemming','zelf_contact_gezocht','bestaande_klant')))`;

/**
 * Lijst voor vandaag (idempotent: vult aan tot het maximum). Alleen op werkdagen uit je
 * beschikbaarheid. Terugbelafspraken van vandaag komen er altijd bij.
 */
export async function buildDayList({ now = new Date(), env = "productie", force = false } = {}) {
  const T = env === "test";
  const day = amsDay(now);
  const av = (await one("select value from hq.settings where key='availability'"))?.value || {};
  const weekdays = Array.isArray(av.weekdays) && av.weekdays.length ? av.weekdays : [1, 2, 3, 4, 5];
  if (!force && !weekdays.includes(amsParts(now).wd)) return { day, bellen: 0, bezoek: 0, overgeslagen: "geen werkdag" };
  const s = await salesAiSettings();
  const made = { day, bellen: 0, bezoek: 0, terugbellen: 0, niet_gebeld: 0 };
  const insert = async (lead, kind) => {
    const opp = await one("select observation, service_key, page_url from hq.opportunities where lead_id=$1 and strength='concreet' and verified<>'klopt_niet' order by created_at desc limit 1", [lead.id]);
    const prop = proposalFor(lead, opp);
    const row = (await q("insert into hq.calls (lead_id, day, kind, briefing, briefing_by, is_test) values ($1,$2,$3,$4,'regels',$5) on conflict (lead_id, day) do nothing returning id", [lead.id, day, kind, rulesBriefing(lead, opp, prop, kind), T])).rows[0];
    if (row) await tx((db) => enqueue(db, { agent: "sales", kind: "belcoach", title: `${kind === "bezoek" ? "Bezoekcoach" : "Belcoach"} ${lead.company}`, input: { call_id: row.id }, leadId: lead.id, idempotencyKey: `belcoach:${row.id}`, timeoutS: 24 }));
    return Boolean(row);
  };
  // Terugbelafspraken voor vandaag (de laatste afspraak per bedrijf), niet na een afmelding of bezwaar.
  const callbacks = (await q(`select distinct on (l.id) l.* from hq.calls c join hq.leads l on l.id=c.lead_id
      where c.outcome='terugbellen' and c.callback_on=$1::date and c.is_test=$2 and c.day<>$1::date
        and l.status not in ('afgemeld','verloren','gewonnen')
        and not exists (select 1 from hq.suppressions s where s.kind='lead' and s.value=l.id::text)
        and not exists (select 1 from hq.calls c2 where c2.lead_id=l.id and c2.day > c.day and c2.outcome is not null)
      order by l.id`, [day, T])).rows;
  for (const l of callbacks) {
    // Zonder (toegestaan) nummer: terugkomen in plaats van bellen.
    const ok = await phoneAllowed(l);
    if (await insert(l, ok.allowed ? "bellen" : "bezoek")) made.terugbellen++;
  }
  const already = (await one("select count(*) filter (where kind='bellen')::int as b, count(*) filter (where kind='bezoek')::int as v from hq.calls where day=$1::date and is_test=$2", [day, T]));
  const hasConcrete = "exists (select 1 from hq.opportunities o where o.lead_id=l.id and o.strength='concreet' and o.verified<>'klopt_niet')";
  // Bellen: zakelijk nummer uit openbare gegevens, nog niet in gesprek, en bellen mag.
  const callLimit = Math.max(0, s.calls_per_day - already.b);
  if (callLimit) {
    const rows = (await q(`select l.* from hq.leads l where l.is_test=$2 and l.contact_phone is not null and l.status in ('nieuw','onderzocht','goedgekeurd','benaderd')
        and coalesce(l.active_status,'onzeker') <> 'gesloten' and l.priority in ('hoog','middel') and ${CALLABLE}
        and not exists (select 1 from hq.suppressions s where s.kind='lead' and s.value=l.id::text)
        and not exists (select 1 from hq.calls c where c.lead_id=l.id and (c.outcome='niet_bellen' or (c.outcome='geen_interesse' and c.day > $1::date - 90) or c.day > $1::date - 2
          or c.outcome in ('interesse','afspraak','offerte','terugbellen')))
      order by (l.priority='hoog') desc, ${hasConcrete} desc, l.fit_score desc nulls last, l.created_at limit $3`, [day, T, 100, RECHTSPERSONEN])).rows;
    for (const l of rows) {
      if (made.bellen >= callLimit) break;
      if (!(await phoneAllowed(l)).allowed) { made.niet_gebeld++; continue; } // bijv. nummer staat (anders geschreven) op de bezwaarlijst
      if (await insert(l, "bellen")) made.bellen++;
    }
  }
  // Langsgaan: alleen bij echte potentie en met adres. Wie je mag bellen, bel je eerst; langsgaan
  // dan pas na een positief gesprek. Wie je niet mag bellen (eenmanszaak, vof, onbekend): langsgaan.
  const visitLimit = Math.max(0, s.visits_per_day - already.v);
  if (visitLimit) {
    const rows = (await q(`select l.* from hq.leads l where l.is_test=$2 and l.address is not null and l.status in ('nieuw','onderzocht','goedgekeurd','benaderd','gesprek')
        and l.priority='hoog' and l.active_status='actief'
        and (l.website_status in ('geen_gevonden','alleen_sociaal') or ${hasConcrete})
        and (l.contact_phone is null or not ${CALLABLE} or exists (select 1 from hq.calls c2 where c2.lead_id=l.id and c2.outcome='interesse'))
        and not exists (select 1 from hq.suppressions s where s.kind='lead' and s.value=l.id::text)
        and not exists (select 1 from hq.calls c where c.lead_id=l.id and (c.outcome in ('niet_bellen','geen_interesse') or (c.kind='bezoek' and c.day > $1::date - 30) or c.day=$1::date))
      order by l.city, l.fit_score desc nulls last limit $3`, [day, T, visitLimit, RECHTSPERSONEN])).rows;
    for (const l of rows) if (await insert(l, "bezoek")) made.bezoek++;
  }
  return made;
}

/** Cron: eenmaal per werkdag na het ochtendoverleg de lijst klaarzetten (aanvullen is veilig). */
export async function dayListTick(now = new Date()) {
  const k = (await one("select value from hq.settings where key='kantoor'"))?.value || {};
  const [hh, mm] = String(k.meeting_time || "08:30").split(":").map(Number);
  const p = amsParts(now);
  if (p.hh * 60 + p.mm < hh * 60 + mm) return { skipped: "nog niet" };
  return buildDayList({ now });
}

/** Uitkomst van een gesprek of bezoek (één tik), eventueel met toestemming voor app, mail of bellen. */
export async function callOutcome(callId, body, auth) {
  assertUuid(callId, "gesprek");
  const outcome = String(body?.outcome || "");
  if (!OUTCOMES[outcome]) throw new HttpError(400, "ongeldig", "Onbekende uitkomst.");
  const notes = str(body?.notes, 1000) || null;
  let callback = null;
  if (outcome === "terugbellen") {
    callback = /^\d{4}-\d{2}-\d{2}$/.test(body?.callback_on || "") ? body.callback_on : null;
    if (!callback || callback < amsDay()) throw new HttpError(400, "ongeldig", "Kies een terugbeldatum (vandaag of later).");
  }
  const wantConsent = Array.isArray(body?.consent) ? [...new Set(body.consent.filter(c => ["whatsapp", "email", "telefoon"].includes(c)))] : [];
  const email = body?.email ? normEmail(str(body.email, 254)) : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new HttpError(400, "ongeldig", "Ongeldig e-mailadres.");
  const phone = body?.phone ? normPhone(str(body.phone, 40)) : null;
  if (body?.phone && !/^\+\d{9,15}$/.test(phone || "")) throw new HttpError(400, "ongeldig", "Ongeldig telefoonnummer.");
  return tx(async (db) => {
    const call = (await db.query("select * from hq.calls where id=$1 for update", [callId])).rows[0];
    if (!call) throw new HttpError(404, "niet_gevonden", "Gesprek niet gevonden.");
    let lead = (await db.query("select * from hq.leads where id=$1 for update", [call.lead_id])).rows[0];
    await db.query("update hq.calls set outcome=$2, notes=coalesce($3, notes), callback_on=$4, done_at=now() where id=$1", [callId, outcome, notes, callback]);
    const how = call.kind === "bezoek" ? "Bezoek" : "Telefoongesprek";
    await db.query("insert into hq.interactions (lead_id, direction, channel, kind, body, is_test, created_by, created_label) values ($1,'intern',$2,'notitie',$3,$4,$5,$6)",
      [lead.id, call.kind === "bezoek" ? "gesprek" : "telefoon", `${how}: ${OUTCOMES[outcome]}${notes ? ` · ${notes}` : ""}`, lead.is_test, auth?.userId || null, auth?.email || "systeem"]);
    if (outcome === "niet_bellen") {
      // "Niet meer benaderen": geen enkel contact meer (alle kanalen, voorbeeldsite offline).
      await suppress({ lead, reason: "bezwaar", note: `${how}: wil niet meer benaderd worden` }, db);
      await audit(db, { actor: auth?.userId || null, label: auth?.email || "systeem", action: "gesprek.uitkomst", entity: "lead", entityId: lead.id, details: { outcome, toestemming: [] } });
      return { ok: true, outcome, consents: [] };
    }
    if (outcome === "geen_interesse") {
      await db.query("update hq.leads set status=case when status in ('gewonnen','afgemeld') then status else 'verloren' end, lost_reason=coalesce(lost_reason,$2), updated_at=now() where id=$1", [lead.id, `Geen interesse (${how.toLowerCase()})`]);
    } else if (["interesse", "afspraak", "offerte"].includes(outcome)) {
      await db.query(`update hq.leads set status=case when status in ('nieuw','onderzocht','goedgekeurd','benaderd') then 'gesprek' else status end,
        sales_channel=coalesce(sales_channel,$2), updated_at=now() where id=$1`, [lead.id, call.kind === "bezoek" ? "bezoek" : "bellen"]);
    }
    // Gegeven gegevens (bijv. bij een bezoek: "bel me maar op dit nummer").
    const positive = ["interesse", "afspraak", "offerte", "terugbellen"].includes(outcome);
    if (positive && email && !lead.contact_email) { await db.query("update hq.leads set contact_email=$2 where id=$1", [lead.id, email]); lead = { ...lead, contact_email: email }; }
    if (positive && phone && !lead.contact_phone) { await db.query("update hq.leads set contact_phone=$2 where id=$1", [lead.id, phone]); lead = { ...lead, contact_phone: phone }; }
    // Terugbellen afgesproken = toestemming voor dat telefoontje (nodig bij een eenmanszaak of vof).
    const want = new Set(positive ? wantConsent : []);
    if (outcome === "terugbellen" && lead.contact_phone) want.add("telefoon");
    // Toestemming tijdens het gesprek: "mag ik je een voorbeeld appen/mailen?" → ja.
    const consents = [];
    for (const ch of want) {
      if (ch === "email" && !lead.contact_email) throw new HttpError(400, "ongeldig", "Vul het e-mailadres in dat je kreeg.");
      if ((ch === "whatsapp" || ch === "telefoon") && !lead.contact_phone) throw new HttpError(400, "ongeldig", "Vul het telefoonnummer in dat je kreeg.");
      if (await validConsent(lead.id, ch, db)) { consents.push(ch); continue; }
      await recordConsent(lead.id, { channel: ch, basis: "toestemming", source: `${how} op ${new Date().toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam" })}`,
        scope: ch === "telefoon" ? "Terugbellen of bellen over een website, zoals afgesproken" : "Voorbeeld en voorstel over een website sturen, plus opvolging daarover",
        evidence: `Mondelinge toestemming tijdens het ${how.toLowerCase()}, genoteerd door ${auth?.email || "Rayan"}.` }, auth, db);
      consents.push(ch);
    }
    await audit(db, { actor: auth?.userId || null, label: auth?.email || "systeem", action: "gesprek.uitkomst", entity: "lead", entityId: lead.id, details: { outcome, toestemming: consents } });
    return { ok: true, outcome, consents };
  });
}

/** Persoonlijk bericht na het gesprek (alleen met toestemming), met de voorbeeldsite erin. */
export async function composeAfterCall(leadId, body, auth) {
  assertUuid(leadId, "klant");
  const channel = body?.channel === "email" ? "email" : "whatsapp";
  const lead = await one("select * from hq.leads where id=$1", [leadId]);
  if (!lead) throw new HttpError(404, "niet_gevonden", "Klant niet gevonden.");
  const chk = await contactCheck(lead, channel, { kind: "eerste_contact" });
  if (!chk.allowed) throw new HttpError(409, "niet_toegestaan", `Nog niet versturen: ${chk.reasons.join("; ")}.`);
  if (channel === "whatsapp" && !normPhone(lead.contact_phone)) throw new HttpError(400, "ongeldig", "Geen telefoonnummer bekend voor WhatsApp.");
  const opp = await one("select observation, service_key from hq.opportunities where lead_id=$1 and strength='concreet' and verified<>'klopt_niet' order by created_at desc limit 1", [leadId]);
  const prev = await one("select slug from hq.previews where lead_id=$1 and status<>'ingetrokken' and expires_at > now()", [leadId]);
  const prop = proposalFor(lead, opp);
  const first = lead.contact_name ? ` ${String(lead.contact_name).split(" ")[0]}` : "";
  let middle = `Leuk je net te spreken! Zoals beloofd stuur ik je ${prev ? "een voorbeeld van hoe de nieuwe website van " + lead.company + " eruit kan zien" : "even de informatie over je nieuwe website"}.`;
  let by = "regels";
  if (await refreshAi() && llmConfigured()) {
    try {
      const r = await structured({ tier: "overtuigen", post: "acquisitie", maxTokens: 600,
        system: "Je schrijft namens Rayan van StrakWerk een kort, persoonlijk bericht aan een ondernemer die hij net sprak en die toestemming gaf om iets te sturen. Nederlands, je-vorm, warm en kort (2 tot 3 zinnen). Verzin niets: geen cijfers, prijzen, resultaten, reviews of garanties, geen links (die zet de code erbij). Begin niet met 'Hoi' (dat doet de code).",
        instruction: "Schrijf het middenstuk van het bericht.", untrusted: { bedrijf: lead.company, plaats: lead.city, observatie: opp?.observation || null, voorbeeldsite: Boolean(prev), notities: body?.notes || null },
        schema: { type: "object", additionalProperties: false, required: ["tekst"], properties: { tekst: { type: "string" } } } });
      const s = safeText(r.data.tekst, middle, 500);
      middle = s.text; by = s.replaced ? "regels (AI-tekst afgekeurd door controle)" : "Claude";
    } catch (e) { if (!e.budget) console.error(`[bericht] AI niet gebruikt: ${e.message}`); }
  }
  const link = prev ? `\n\n${process.env.HQ_SITE_URL || "https://www.strakwerkk.nl"}/voorbeeld/${prev.slug}` : "";
  // E-mail krijgt de afmeldregel automatisch in de voettekst; WhatsApp in de tekst zelf.
  const text = `Hoi${first},\n\n${middle}${link}\n\n${prop.tekst}\n\nZeg het gerust als je iets anders wilt zien.\n\nGroet,\nRayan\nStrakWerk${channel === "whatsapp" ? `\n\n${WA_OPT_OUT}` : ""}`;
  const day = amsDay();
  const o = (await q(`insert into hq.outreach (lead_id, channel, kind, status, subject, body, to_address, idempotency_key, is_test, prompt_version)
      values ($1,$2,'eerste_contact',$3,$4,$5,$6,$7,$8,$9)
      on conflict (idempotency_key) do update set body=excluded.body, updated_at=now() where hq.outreach.status in ('concept','klaar_handmatig') returning *`,
    [leadId, channel, channel === "whatsapp" ? "klaar_handmatig" : "concept", `Voorbeeld van je nieuwe website`, text, channel === "email" ? lead.contact_email : lead.contact_phone, `na_gesprek:${leadId}:${channel}:${day}`, lead.is_test, `na_gesprek@${by}`])).rows[0]
    || await one("select * from hq.outreach where idempotency_key=$1", [`na_gesprek:${leadId}:${channel}:${day}`]);
  return { outreach: o, wa_link: channel === "whatsapp" ? `https://wa.me/${normPhone(lead.contact_phone).replace(/\D/g, "")}?text=${encodeURIComponent(o.body)}` : null, by };
}

/** E-mail nu versturen (jouw klik, met toestemming). Opvolging na 7 dagen staat dan klaar voor jou. */
export async function sendNow(outreachId, auth) {
  assertUuid(outreachId, "bericht");
  const { sendMail, mailConfigured } = await import("./mail.js");
  const { afterSent } = await import("./acquisition.js");
  const o = await one("select * from hq.outreach where id=$1", [outreachId]);
  if (!o) throw new HttpError(404, "niet_gevonden", "Bericht niet gevonden.");
  if (o.channel !== "email") throw new HttpError(400, "ongeldig", "Alleen e-mail kan vanuit HQ worden verstuurd; WhatsApp verstuur je zelf via de knop.");
  if (!["concept", "klaar_handmatig"].includes(o.status)) return { status: o.status, duplicate: true };
  if (!mailConfigured()) throw new HttpError(409, "niet_gekoppeld", "E-mail is nog niet gekoppeld.", { missing: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"] });
  const lead = await one("select * from hq.leads where id=$1", [o.lead_id]);
  const chk = await contactCheck(lead, "email", { kind: o.kind });
  if (!chk.allowed) throw new HttpError(409, "niet_toegestaan", `Niet versturen: ${chk.reasons.join("; ")}.`);
  const claim = await q("update hq.outreach set status='verzenden', updated_at=now() where id=$1 and status in ('concept','klaar_handmatig')", [outreachId]);
  if (!claim.rowCount) return { status: "verzenden", duplicate: true };
  let r;
  try {
    r = await sendMail({ outreachId, leadId: lead.id, to: o.to_address, subject: o.subject, text: o.body });
  } catch (e) {
    // Alleen als het versturen zelf mislukt mag hij terug naar concept (anders kans op dubbel).
    await q("update hq.outreach set status=$2, last_error=$3, updated_at=now() where id=$1", [outreachId, e.ambiguous ? "onzeker" : "concept", String(e.message).slice(0, 300)]);
    throw new HttpError(502, "mail", e.message);
  }
  await q("update hq.outreach set status='verzonden', sent_at=now(), provider_id=$2, last_error=null, updated_at=now() where id=$1", [outreachId, r.messageId]);
  await afterSent(o, lead, r.messageId, false, { manualFollowup: true });
  if (/\/voorbeeld\//.test(o.body)) await q("update hq.previews set status='gedeeld' where lead_id=$1 and status='concept'", [lead.id]);
  await audit(null, { actor: auth?.userId || null, label: auth?.email || "systeem", action: "bericht.verstuurd", entity: "lead", entityId: lead.id, details: { kanaal: "email" } });
  return { status: "verzonden" };
}

/** Na een handmatig verstuurde WhatsApp na een gesprek: opvolging over 7 dagen klaarzetten. */
export async function afterManualSend(outreachId) {
  const o = await one("select * from hq.outreach where id=$1", [outreachId]);
  if (!o || o.kind !== "eerste_contact" || !["handmatig_verzonden", "verzonden"].includes(o.status)) return;
  const lead = await one("select * from hq.leads where id=$1", [o.lead_id]);
  const { afterSent } = await import("./acquisition.js");
  await afterSent(o, lead, null, false, { manualFollowup: true, interaction: false });
  if (/\/voorbeeld\//.test(o.body)) await q("update hq.previews set status='gedeeld' where lead_id=$1 and status='concept'", [o.lead_id]);
}
