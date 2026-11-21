// Welke agents echt zijn aangesloten, welke tools ze mogen gebruiken en wat er ontbreekt.
// Een agent heet pas "actief"/beschikbaar als zijn uitvoering hier is aangesloten.
import { env } from "../env.js";
import { llmConfigured } from "./llm.js";
import * as scout from "./scout.js";
import * as auditor from "./auditor.js";
import * as sales from "./sales.js";
import * as content from "./content.js";
import * as publisher from "./publisher.js";
import * as acquisitie from "../klant/acquisition.js";
import { runDiscover, runSalesCheck, runCheckLead } from "../klant/agents.js";
import { missingIg } from "../content/instagram.js";
import { mailConfigured, mailRoute, missingMail } from "../klant/mail.js";

// "video" heeft hier bewust geen uitvoerder: renders draaien in de render-worker
// (scripts/render-worker.mjs) met ffmpeg en Chromium, niet in een Vercel-functie.
// Scout en Auditor kiezen per taaksoort: ontdekken (OpenStreetMap) en verkoopkans (mobiele klantroute).
const scoutX = { run: (a) => (a.task.kind === "ontdekken" ? runDiscover(a) : a.task.kind === "websitestatus" ? runCheckLead(a) : scout.run(a)) };
const auditorX = { run: (a) => (a.task.kind === "verkoopkans" ? runSalesCheck(a) : auditor.run(a)) };
export const EXECUTORS = { scout: scoutX, auditor: auditorX, sales, content, publisher, acquisitie };

export const TOOLS = {
  scout:   ["OpenStreetMap (Overpass API, open data)", "web.get (alleen publieke homepage + robots.txt)", "crm.lezen (lead)"],
  auditor: ["web.get (publieke pagina's, geen scans)", "pagespeed.api (Google, optioneel)", "taalmodel (optioneel, zonder tools)"],
  sales:   ["taalmodel (optioneel, zonder tools)", "crm.lezen (goedgekeurd onderzoek)"],
  content: ["projectgegevens + vrijgegeven beelden (lezen)", "pakketprijzen (hq.packages) en actie uit CONFIG", "taalmodel (optioneel, zonder tools)"],
  video:   ["Chromium (scènes tekenen)", "ffmpeg (montage)", "opslag (Supabase Storage of lokaal)"],
  acquisitie: ["contactregels (toestemming, afmeldingen, frequentie)", "e-mail vanaf het StrakWerk-adres via de Gmail API (alleen als jij de route activeert)"],
  publisher: ["Instagram API (officieel, professioneel account)", "opslag (tijdelijke link voor Instagram)"],
};

export function connection(key) {
  const llm = llmConfigured();
  if (!env.databaseUrl) return { connected: false, missing: ["DATABASE_URL"], note: "Geen takenopslag." };
  switch (key) {
    case "scout":
      return { connected: true, partial: !llm, missing: llm ? [] : ["ANTHROPIC_API_KEY"],
        note: llm ? "Controleert ingevoerde leads via hun eigen website en beoordeelt relevantie met Claude."
                  : "Controleert ingevoerde leads via hun eigen website. Zonder ANTHROPIC_API_KEY geen inhoudelijke relevantiebeoordeling. Bedrijven zoeken gaat via OpenStreetMap (gratis, open data)." };
    case "auditor":
      return { connected: true, partial: !llm, missing: llm ? [] : ["ANTHROPIC_API_KEY"],
        note: llm ? "Meet de website en laat Claude de metingen interpreteren (gescheiden van de feiten)."
                  : "Meet de website (feiten) en geeft regelgebaseerde interpretaties. Met ANTHROPIC_API_KEY komen er inhoudelijke interpretaties bij." };
    case "sales":
      return { connected: true, partial: !llm, missing: llm ? [] : ["ANTHROPIC_API_KEY"],
        note: llm ? "Schrijft persoonlijke berichtconcepten met Claude, uitsluitend op basis van goedgekeurd onderzoek."
                  : "Maakt een sjabloonconcept uit goedgekeurde metingen (duidelijk gemarkeerd). Met ANTHROPIC_API_KEY wordt het concept persoonlijk geschreven." };
    case "content":
      return { connected: true, partial: !llm, missing: llm ? [] : ["ANTHROPIC_API_KEY"],
        note: llm ? "Maakt drie verkoophoeken; Claude schrijft de teksten binnen vaste regels."
                  : "Maakt drie verkoophoeken uit vaste sjablonen met echte projectinformatie. Met ANTHROPIC_API_KEY schrijft Claude de teksten." };
    case "video":
      return { connected: true, partial: true, missing: [],
        note: "Rendert op een aparte machine (render-worker met ffmpeg en Chromium): lokaal met npm run render-worker of via GitHub Actions." };
    case "publisher": {
      const m = missingIg();
      return { connected: true, partial: m.length > 0, missing: m,
        note: m.length ? "Instagram-koppeling niet ingesteld: publicaties worden als export (MP4, cover, caption) klaargezet. TikTok: altijd export." : "Plaatst op Instagram via de officiële API; TikTok via export." };
    }
    case "acquisitie": {
      const ok = mailConfigured();
      return { connected: true, partial: !ok, missing: missingMail(),
        note: ok ? `Verstuurt alleen toegestane berichten (${mailRoute() === "gmail_api" ? "Gmail API" : "SMTP"}) als jij de e-mailroute live zet; anders proefstand.` : "Zonder mailkoppeling: berichten klaarzetten met kopieerknop (proefstand). Contactregels gelden altijd." };
    }
    case "teamleider": case "groei":
      return { connected: true, partial: !llm, missing: [], note: "Ochtendoverleg en acties uit gewone code; hooguit één AI-samenvatting met bevestigd tegoed." };
    default:
      return { connected: false, missing: [], note: "Uitvoering nog niet aangesloten. Deze rol is ingericht, maar draait nog niet." };
  }
}
