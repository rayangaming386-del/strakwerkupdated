// Welke agents echt zijn aangesloten, welke tools ze mogen gebruiken en wat er ontbreekt.
// Een agent heet pas "actief"/beschikbaar als zijn uitvoering hier is aangesloten.
import { env } from "../env.js";
import { llmConfigured } from "./llm.js";
import * as scout from "./scout.js";
import * as auditor from "./auditor.js";
import * as sales from "./sales.js";

export const EXECUTORS = { scout, auditor, sales };

export const TOOLS = {
  scout:   ["web.get (alleen publieke homepage + robots.txt)", "crm.lezen (lead)"],
  auditor: ["web.get (publieke pagina's, geen scans)", "pagespeed.api (Google, optioneel)", "taalmodel (optioneel, zonder tools)"],
  sales:   ["taalmodel (optioneel, zonder tools)", "crm.lezen (goedgekeurd onderzoek)"],
};

export function connection(key) {
  const llm = llmConfigured();
  if (!env.databaseUrl) return { connected: false, missing: ["DATABASE_URL"], note: "Geen takenopslag." };
  switch (key) {
    case "scout":
      return { connected: true, partial: !llm, missing: llm ? [] : ["ANTHROPIC_API_KEY"],
        note: llm ? "Controleert ingevoerde leads via hun eigen website en beoordeelt relevantie met Claude."
                  : "Controleert ingevoerde leads via hun eigen website. Zonder ANTHROPIC_API_KEY geen inhoudelijke relevantiebeoordeling. Zelf bedrijven zoeken is niet gekoppeld (geen zoekbron)." };
    case "auditor":
      return { connected: true, partial: !llm, missing: llm ? [] : ["ANTHROPIC_API_KEY"],
        note: llm ? "Meet de website en laat Claude de metingen interpreteren (gescheiden van de feiten)."
                  : "Meet de website (feiten) en geeft regelgebaseerde interpretaties. Met ANTHROPIC_API_KEY komen er inhoudelijke interpretaties bij." };
    case "sales":
      return { connected: true, partial: !llm, missing: llm ? [] : ["ANTHROPIC_API_KEY"],
        note: llm ? "Schrijft persoonlijke berichtconcepten met Claude, uitsluitend op basis van goedgekeurd onderzoek."
                  : "Maakt een sjabloonconcept uit goedgekeurde metingen (duidelijk gemarkeerd). Met ANTHROPIC_API_KEY wordt het concept persoonlijk geschreven." };
    default:
      return { connected: false, missing: [], note: "Uitvoering nog niet aangesloten. Deze rol is ingericht, maar draait nog niet." };
  }
}
