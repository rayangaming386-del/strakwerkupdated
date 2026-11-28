// SALES: maakt een persoonlijk berichtconcept op basis van GOEDGEKEURD onderzoek.
// Verzint geen prijzen, afspraken of klantbehoeften. Verstuurt niets: het concept gaat
// naar de goedkeuringsinbox; versturen doet een mens, na goedkeuring.
import { structured, llmConfigured } from "./llm.js";

export const KIND = "bericht_concept";

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["onderwerp", "bericht", "gebruikte_feiten"],
  properties: {
    onderwerp: { type: "string" },
    bericht: { type: "string", description: "Maximaal 140 woorden, Nederlands, je-vorm, geen prijzen, geen beloftes." },
    gebruikte_feiten: { type: "array", items: { type: "string", description: "Naam van de meting of het feit uit het goedgekeurde onderzoek." } },
  },
};

// Harde controle op dingen die Sales nooit mag doen, ook niet als het model het probeert.
export function guard(text) {
  const problems = [];
  if (/€|\beuro\b|\d+\s*,-/i.test(text)) problems.push("bevat een prijs");
  if (/\b(review|recensie|sterren|beoordeling)/i.test(text)) problems.push("verwijst naar reviews");
  if (/\b(afspraak staat|zoals afgesproken|ingepland op)\b/i.test(text)) problems.push("suggereert een afspraak");
  if (/\b(garantie|gegarandeerd|100%)\b/i.test(text)) problems.push("bevat een garantie");
  return problems;
}

function template(company, interps) {
  const points = interps.slice(0, 2).map(i => `- ${i.punt}`).join("\n");
  return {
    onderwerp: `Een paar observaties over de website van ${company}`,
    bericht:
`Hoi,

Ik ben Rayan van StrakWerk, webdesign uit Zoetermeer. Ik heb kort naar de website van ${company} gekeken en zag een paar punten die ik wil delen:

${points || "- (geen concrete verbeterpunten gevonden)"}

Als je wilt, licht ik dit vrijblijvend toe. Geen interesse? Dan hoor je verder niets van me.

Groet,
Rayan
StrakWerk`,
    gebruikte_feiten: interps.slice(0, 2).flatMap(i => i.op_basis_van || []),
  };
}

export async function run({ task, lead, ctx }) {
  const research = task.input?.onderzoek;
  if (!research) throw Object.assign(new Error("Geen goedgekeurd onderzoek meegegeven."), { retryable: false });
  const company = lead?.company || research.bedrijf || "het bedrijf";
  const interps = (research.interpretaties || []).filter(i => i && i.punt);
  let draft, methode;
  if (llmConfigured()) {
    await ctx.step("Berichtconcept schrijven (Claude)");
    const r = await ctx.llm(structured({
      system: "Je bent Sales voor StrakWerk (Rayan, webdesign uit Zoetermeer). Je schrijft een kort, persoonlijk en respectvol eerste bericht. Gebruik uitsluitend het goedgekeurde onderzoek. Noem geen prijzen, kortingen, afspraken, garanties, reviews of klantresultaten. Verzin geen behoeften van de ontvanger. Sluit af met een vrijblijvende vraag en een eenvoudige manier om geen berichten meer te ontvangen.",
      instruction: `Schrijf een eerste bericht aan ${company}. Kies maximaal twee concrete, goedgekeurde verbeterpunten.`,
      untrusted: { goedgekeurd_onderzoek: research },
      schema: SCHEMA, maxTokens: 1500, signal: ctx.signal,
    }));
    draft = r.data; methode = "Claude";
  } else {
    await ctx.step("Sjabloonconcept maken (geen taalmodel gekoppeld)");
    draft = template(company, interps); methode = "sjabloon";
  }
  const problems = guard(`${draft.onderwerp}\n${draft.bericht}`);
  if (problems.length) throw Object.assign(new Error(`Concept afgekeurd door controle: ${problems.join(", ")}.`), { retryable: methode === "Claude" });

  const channel = lead?.contact_email ? "e-mail" : lead?.contact_phone ? "telefoon/WhatsApp" : "nog onbekend";
  return {
    status: "wacht_op_goedkeuring",
    result: { concept: draft, methode, kanaal_voorstel: channel },
    approval: {
      kind: "bericht", title: `Berichtconcept voor ${company}`,
      proposal: { onderwerp: draft.onderwerp, bericht: draft.bericht, kanaal: channel, ontvanger: lead?.contact_email || lead?.contact_phone || null },
      rationale: { gebruikte_feiten: draft.gebruikte_feiten, methode, onderzoek_goedgekeurd: task.input?.onderzoek_approval_id || null,
        let_op: "Goedkeuring geldt alleen voor deze exacte tekst. Versturen gebeurt handmatig; controleer of de ontvanger benaderd mag worden (AVG / Telecommunicatiewet)." },
    },
  };
}
