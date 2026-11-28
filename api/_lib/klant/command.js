// Opdrachtveld: gewone taal → concrete acties, met vaste regels (geen AI nodig).
// Voorbeeld: "Deze kapper wil een website met afspraken. Zet de aanvraag erin en bereid een offerte voor."
// Het resultaat laat altijd zien wat er is gedaan en wat Rayan nog moet beslissen.
import { one, audit } from "../db.js";
import { HttpError, str } from "../http.js";
import { intakeRequest, prepareQuote, registerReply } from "./sales.js";
import { prepareApproach } from "./acquisition.js";
import { runMeeting } from "./planning.js";
import { normEmail, normPhone } from "./contact.js";

const SEGMENT_WORDS = [
  { re: /kapper|kapsalon|barber|salon|nagel|beauty|schoonheid/i, label: "salon" },
  { re: /garage|autobedrijf|auto ?(reparatie|handel)|apk|bandenservice/i, label: "autobedrijf" },
  { re: /loodgieter|schilder|elektricien|klusbedrijf|hovenier|aannemer|schoonmaak|bouw/i, label: "dienstverlener" },
  { re: /restaurant|caf[eé]|horeca|lunchroom|snackbar/i, label: "horeca" },
];

export function parseCommand(text) {
  const t = String(text || "");
  const email = normEmail((t.match(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i) || [])[0]);
  const phone = normPhone((t.match(/(\+31|0031|0)[\s-]?6[\s-]?(\d[\s-]?){8}|(\+31|0)\d{2}[\s-]?\d{7}/) || [])[0]);
  const company = (t.match(/(?:bedrijf|zaak|heet|genaamd|naam)\s*:?\s*["“]?([A-Z0-9][\w&'.-]*(?:\s+[A-Z0-9&][\w&'.-]*){0,4})/) || t.match(/["“]([^"”]{2,60})["”]/) || [])[1] || null;
  const name = (t.match(/(?:contactpersoon|naam is|heet)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/) || [])[1] || null;
  const seg = SEGMENT_WORDS.find(s => s.re.test(t));
  const intents = [];
  if (/aanvraag|zet (hem|haar|het|deze|die)? ?(er)?in|klant toevoegen|nieuwe klant|wil een (website|site|webshop)/i.test(t)) intents.push("aanvraag");
  if (/offerte/i.test(t)) intents.push("offerte");
  if (/benader|stuur (een )?(eerste )?(mail|bericht)|acquisitie/i.test(t)) intents.push("benaderen");
  if (/overleg|ochtend|briefing/i.test(t)) intents.push("overleg");
  if (/antwoord(de)?|reageerde|reactie|schreef terug/i.test(t) && !intents.includes("aanvraag")) intents.push("reactie");
  return { email, phone, company, name, segment: seg?.label || null, intents, text: t };
}

/** Voert een opdracht uit. Geld en versturen blijven altijd een beslissing van Rayan. */
export async function runCommand(body, auth) {
  const text = str(body.text, 4000);
  if (!text) throw new HttpError(400, "ongeldig", "Typ een opdracht.");
  const p = parseCommand(text);
  const done = [], decide = [];
  let leadId = body.lead_id || null;
  if (!p.intents.length) return { understood: false, parsed: p, done, decide: ["Ik herken geen opdracht. Probeer: \"Deze kapper wil een website met afspraken. Zet de aanvraag erin en bereid een offerte voor.\""] };

  if (p.intents.includes("aanvraag")) {
    const r = await intakeRequest({ company: p.company || (p.segment ? `Nieuwe ${p.segment}` : "Nieuwe aanvraag"), name: p.name, email: p.email, phone: p.phone, message: text, channel: "gesprek", is_test: Boolean(body.is_test), external_id: body.idempotency_key || null }, auth);
    leadId = r.lead_id;
    done.push(r.duplicate ? "Deze aanvraag stond er al in (niet dubbel aangemaakt)." : `Klantkaart aangemaakt${p.segment ? ` (${p.segment})` : ""}: ${r.analysis.summary}`);
    if (!r.duplicate && r.analysis.missing.length) decide.push(`Nog nodig van de klant: ${r.analysis.missing.join(", ")}`);
    if (!p.email && !p.phone) decide.push("Geen e-mail of telefoon in de opdracht: vul die aan op de klantkaart.");
    if (!p.company) decide.push("Bedrijfsnaam onbekend: pas de naam aan op de klantkaart.");
  }
  if (!leadId && p.company) leadId = (await one("select id from hq.leads where company ilike $1 order by updated_at desc limit 1", [p.company]))?.id || null;

  if (p.intents.includes("reactie")) {
    if (!leadId) decide.push("Bij welke klant hoort deze reactie? Open de klantkaart en plak hem daar.");
    else { const r = await registerReply({ lead_id: leadId, text, channel: "whatsapp" }, auth); done.push(`Reactie vastgelegd als "${r.classification}"${r.cancelled_followups ? `; ${r.cancelled_followups} geplande opvolging(en) gestopt` : ""}.`); }
  }
  if (p.intents.includes("offerte")) {
    if (!leadId) decide.push("Voor welke klant is de offerte? Noem de bedrijfsnaam of open de klantkaart.");
    else {
      const r = await prepareQuote(leadId, {}, auth);
      const qu = r.quote || (await one("select * from hq.quotes where id=$1", [r.id]));
      done.push(r.duplicate ? "Er stond al een offerteconcept met deze inhoud klaar." : `Offerteconcept klaargezet: ${qu.package_key}, €${qu.price_cents / 100} (prijzen uit de prijslijst).`);
      decide.push("Controleer de offerte en verstuur hem zelf (geld = jouw beslissing).");
    }
  }
  if (p.intents.includes("benaderen")) {
    if (!leadId) decide.push("Welk bedrijf moet benaderd worden?");
    else {
      const r = await prepareApproach(leadId, auth);
      done.push(r.decision === "automatisch_ingepland" ? "Eerste bericht ingepland (route staat aan en contact is toegestaan)."
        : r.decision === "klaar_om_handmatig_te_versturen" ? "Eerste bericht klaargezet om zelf te versturen."
        : `Niet benaderd: ${(r.why || []).join("; ")}`);
    }
  }
  if (p.intents.includes("overleg")) {
    const r = await runMeeting({ force: true });
    done.push(`Ochtendoverleg opnieuw opgesteld met ${r.actions} actie(s).`);
  }
  await audit(null, { actor: auth?.userId || null, label: auth?.email || "systeem", action: "opdracht.uitgevoerd", entity: "lead", entityId: leadId, details: { intents: p.intents } });
  return { understood: true, parsed: { ...p, text: undefined }, lead_id: leadId, done, decide };
}
