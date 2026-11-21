#!/usr/bin/env node
// Demo "klanten winnen" met gemarkeerde testgegevens (is_test). Niets gaat naar echte
// bedrijven: OpenStreetMap en de websites zijn hier nagebootst, mail staat in proefstand.
//   A. Scout vindt een kapsalon zonder eigen website, geen contactgrond → niet mailen,
//      onderzoek bewaard, anoniem probleem als marketinginput.
//   B. Barbershop met een kapotte afspraaklink (concreet, met bewijs) en een vastgelegde
//      contactgrond → persoonlijke testmail, reactie komt binnen, geplande opvolging vervalt.
//   C. Garage komt binnen via een StrakWerk-video, vraagt een website aan → offerte → akkoord
//      → intake → gesimuleerde betaling.
// Daarna het ochtendoverleg van de volgende dag (testomgeving).
//
//   DATABASE_URL=postgres://... npm run demo:klanten
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvFile } from "./dev-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const owner = { userId: "00000000-0000-4000-8000-00000000d001", email: "demo@strakwerk.local", role: "eigenaar" };

function listen(handler) { const s = http.createServer(handler); return new Promise(r => s.listen(0, "127.0.0.1", () => r(s))); }

export async function demoKlanten({ log = console.log } = {}) {
  process.env.HQ_STORAGE ||= "local";
  process.env.HQ_TEST_MODE = "1"; // alleen voor het nagebootste netwerk; nooit op Vercel
  for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) delete process.env[k];
  const osm = { elements: [] };
  const overpass = await listen(async (rq, rs) => { for await (const _ of rq); rs.writeHead(200, { "content-type": "application/json" }); rs.end(JSON.stringify(osm)); });
  const site = await listen((rq, rs) => {
    if (rq.url === "/robots.txt") { rs.writeHead(200); return rs.end("User-agent: *\nAllow: /\n"); }
    if (rq.url === "/") { rs.writeHead(200, { "content-type": "text/html" }); return rs.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Barbershop Bravo (demo)</title></head><body><h1>Barbershop Bravo</h1><a href="tel:+31790000000">Bel</a><a href="/boeken">Afspraak maken</a><a href="/prijzen">Prijzen</a><a href="/contact">Contact</a></body></html>`); }
    if (rq.url === "/prijzen" || rq.url === "/contact") { rs.writeHead(200, { "content-type": "text/html" }); return rs.end("<html><body>ok</body></html>"); }
    rs.writeHead(404); rs.end("niet gevonden");
  });
  process.env.OVERPASS_URL = `http://127.0.0.1:${overpass.address().port}/`;
  const { migrate } = await import("./migrate.mjs");
  await migrate(process.env.DATABASE_URL, { log: () => {} });
  (await import("../api/_lib/agents/fetcher.js")).__setTestNetwork({ strict: true, hosts: { "barbershop-bravo-demo.nl": "127.0.0.1" } });
  const { q, one, tx } = await import("../api/_lib/db.js");
  const { runWorker } = await import("../api/_lib/worker.js");
  const { discover } = await import("../api/_lib/klant/discover.js");
  const acq = await import("../api/_lib/klant/acquisition.js");
  const sales = await import("../api/_lib/klant/sales.js");
  const contact = await import("../api/_lib/klant/contact.js");
  const proj = await import("../api/_lib/klant/project.js");
  const plan = await import("../api/_lib/klant/planning.js");
  const drain = async () => { for (let i = 0; i < 10; i++) { await q("update hq.tasks set run_after=now() where status='in_wachtrij' and agent_key in ('scout','auditor','acquisitie')"); await runWorker({ source: "demo", budgetMs: 120_000 }); if (!(await one("select count(*)::int n from hq.tasks where agent_key in ('scout','auditor','acquisitie') and status in ('in_wachtrij','bezig')")).n) return; } };
  await q("insert into hq.members (user_id, email, role, status) values ($1,$2,'eigenaar','actief') on conflict do nothing", [owner.userId, owner.email]);
  // Schone demo: eerdere testgegevens weg (echte gegevens blijven onaangeroerd).
  await q("delete from hq.leads where is_test");
  await q("delete from hq.briefings where env='test'"); await q("delete from hq.actions where is_test"); await q("delete from hq.content_pieces where campaign_code='demo-garage-kenteken'");

  log("\n── Scenario A: geen eigen website, geen contactgrond ──");
  osm.elements = [
    { type: "node", id: 9001, tags: { name: "Kapsalon Anna (demo)", shop: "hairdresser", "addr:city": "Den Haag", phone: "070 000 0001", opening_hours: "Tu-Sa 09:00-17:00" } },
    { type: "node", id: 9002, tags: { name: "Haarstudio Bea (demo)", shop: "hairdresser", "addr:city": "Den Haag", "contact:instagram": "https://instagram.com/voorbeeld" } },
  ];
  await discover({ segment: "salons", city: "Den Haag", limit: 5, isTest: true });
  await drain();
  for (const n of (await q("select company, website_status, priority from hq.leads where osm_id in ('node/9001','node/9002') order by osm_id")).rows) log(`Scout: ${n.company} → ${n.website_status} · prioriteit ${n.priority}`);
  const anna = await one("select * from hq.leads where osm_id='node/9001'");
  log(`Controles: ${anna.website_checks.map(c => `${c.controle}: ${c.uitkomst}`).join(" | ")}`);
  const ap = await acq.prepareApproach(anna.id, owner);
  log(`Acquisitie: fit=${ap.fit.fit} (${ap.fit.plus.join(", ")}) · besluit: ${ap.decision} · ${ap.why.join("; ")}`);
  log(`Marketinginput (anoniem): ${JSON.stringify(ap.marketing_input)}`);

  log("\n── Scenario B: kapotte afspraaklink, contactgrond, testmail, reactie ──");
  osm.elements = [{ type: "node", id: 9101, tags: { name: "Barbershop Bravo (demo)", shop: "hairdresser", "addr:city": "Zoetermeer", website: `http://barbershop-bravo-demo.nl:${site.address().port}/`, email: "info@barbershop-bravo-demo.nl" } }];
  await discover({ segment: "salons", city: "Zoetermeer", limit: 5, isTest: true });
  await drain();
  const bravo = await one("select * from hq.leads where osm_id='node/9101'");
  const opp = await one("select * from hq.opportunities where lead_id=$1 and strength='concreet'", [bravo.id]);
  log(`Auditor: ${opp.observation} · ${opp.page_url} → ${opp.service_text}`);
  await contact.recordConsent(bravo.id, { channel: "email", basis: "gerechtvaardigd_belang_zakelijk", source: "Zakelijk adres op eigen website (demo)", scope: "Eén bericht over de afspraaklink, hooguit één opvolging",
    evidence: "Concreet probleem op hun eigen site (afspraaklink geeft 404), zakelijk adres voor klantvragen, eenmalig en met afmeldlink. (DEMO)" }, owner);
  const routes = await contact.getRoutes();
  await contact.putRoutes({ email: { auto: true, live: false, terms_checked: true } }, owner);
  const bp = await acq.prepareApproach(bravo.id, owner);
  log(`Acquisitie: ${bp.decision}\n--- testmail ---\n${bp.outreach.subject}\n\n${bp.outreach.body}\n---------------`);
  await acq.enqueueDueOutreach(); await drain();
  const sent = await one("select * from hq.outreach where id=$1", [bp.outreach.id]);
  const fu = await one("select * from hq.outreach where lead_id=$1 and kind='opvolging'", [bravo.id]);
  log(`Verzending: ${sent.status} (proefstand) · opvolging gepland op ${new Date(fu.scheduled_at).toLocaleDateString("nl-NL")}`);
  const rr = await sales.registerReply({ text: "Hoi Rayan, goed gezien! Wat zou een nieuwe afspraakknop kosten?", from: "info@barbershop-bravo-demo.nl", in_reply_to: sent.provider_id, external_id: "<demo-reactie@bravo>", channel: "email" });
  log(`Reactie: ${rr.classification} · opvolging gestopt: ${rr.cancelled_followups} · opvolging nu: ${(await one("select status from hq.outreach where id=$1", [fu.id])).status}`);
  await contact.putRoutes({ email: { auto: routes.email.auto, live: routes.email.live } }, owner);

  log("\n── Scenario C: via een StrakWerk-video naar betaling ──");
  await q(`insert into hq.content_pieces (format_key, audience, goal, campaign_code, keyword, title, kind) values ('merk_reel','autobedrijven','aanvragen','demo-garage-kenteken','GARAGE','Garage: kies je automodel en vraag een offerte aan (demo)','merk') on conflict (campaign_code) do nothing`);
  const c = await sales.intakeRequest({ name: "Sam (demo)", company: "Garage De Vries (demo)", email: "sam@garage-demo.invalid", phone: "06 00000000", type: "Een nieuwe website", message: "Wij willen een website met kentekencheck zodat klanten hun auto kunnen kiezen en een offerte aanvragen.", channel: "formulier", page: "/", utm: { source: "instagram", campaign: "demo-garage-kenteken" }, is_test: true, external_id: "demo-form-garage" });
  log(`Aanvraag: ${c.analysis.summary} · herkomst: ${c.attribution?.hoe || "onbekend"}`);
  const quote = await sales.prepareQuote(c.lead_id, {}, owner);
  await q("update hq.quotes set terms='Demovoorwaarden' where id=$1", [quote.id]);
  log(`Offerteconcept: ${quote.quote.package_key} · €${quote.quote.price_cents / 100} · ${quote.quote.items.map(i => i.name).join(", ")}`);
  await sales.sendQuote(quote.id, { interest: true }, owner);
  const acc = await sales.acceptQuote(quote.id, owner);
  log(`Akkoord → project + intake-link (${acc.intake_url ? "aangemaakt" : "bestond al"})`);
  const t = acc.intake_url?.split("t=")[1];
  if (t) {
    await proj.saveIntake(t, { bedrijfsnaam: "Garage De Vries (demo)", over: "Familiegarage (demo).", diensten: "APK\nOnderhoud\nBanden", contact: "06 00000000", domein: "garage-demo.invalid" });
    const s = await proj.saveIntake(t, { logo: { name: "logo.png", data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" } });
    log(`Intake: ${s.done}/${s.total} · compleet: ${s.complete} · briefing klaar: ${s.briefing_ready}`);
  }
  await sales.registerPayment(c.lead_id, { amount_eur: quote.quote.price_cents / 100, method: "simulatie", quote_id: quote.id }, owner);
  log("Betaling: gesimuleerd (TEST)");

  log("\n── Volgende ochtend: overleg (testomgeving) ──");
  const tomorrow = new Date(Date.now() + 864e5); tomorrow.setUTCHours(7, 35, 0, 0);
  const m = await plan.runMeeting({ env: "test", now: tomorrow, force: true });
  log(m.briefing.summary);
  for (const x of (await q("select rank, department, title, reason, next_step from hq.actions where briefing_id=$1 order by rank", [m.briefing.id])).rows) log(`  ${x.rank}. [${plan.DEPT[x.department]}] ${x.title} · ${x.reason} → ${x.next_step}`);
  const res = await proj.results({ env: "test" });
  log(`Resultaten (test): ${res.funnel.map(f => `${f.label} ${f.n}`).join(" → ")} · betaald €${res.betaald_cents / 100}`);
  overpass.close(); site.close();
  return { leads: { a: anna.id, b: bravo.id, c: c.lead_id } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnvFile(path.join(root, ".env.local"));
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL ontbreekt (gebruik een lokale of test-database)."); process.exit(1); }
  demoKlanten().then(async () => { const { closePool } = await import("../api/_lib/db.js"); await closePool(); }, (e) => { console.error(e); process.exit(1); });
}
