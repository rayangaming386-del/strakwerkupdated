#!/usr/bin/env node
// Activeert het EERSTE eigenaarsaccount van StrakWerk HQ. Eenmalig, lokaal uit te voeren
// met de servergeheimen in je eigen terminal (niet in de browser, niet in Git).
//
//   DATABASE_URL=... SUPABASE_URL=... SUPABASE_SECRET_KEY=... HQ_SITE_URL=https://www.strakwerkk.nl \
//     node scripts/bootstrap-owner.mjs jij@voorbeeld.nl
//
// Wat het doet: stuurt via Supabase een uitnodiging naar het adres en legt dat account vast
// als eigenaar. Er wordt geen wachtwoord aangemaakt of getoond: je kiest het zelf via de link
// in de mail. Bij de eerste login stel je verplicht tweestapsverificatie (TOTP) in.
// Weigert als er al een eigenaar bestaat: extra eigenaars maak je in HQ › Instellingen.
import { migrate } from "./migrate.mjs";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { console.error("Gebruik: node scripts/bootstrap-owner.mjs <e-mailadres>"); process.exit(1); }
for (const k of ["DATABASE_URL", "SUPABASE_URL", "HQ_SITE_URL"]) if (!process.env[k]) { console.error(`${k} ontbreekt.`); process.exit(1); }
if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error("SUPABASE_SECRET_KEY ontbreekt."); process.exit(1); }

await migrate(process.env.DATABASE_URL, { log: () => {} });
const db = await import("../api/_lib/db.js");
const sb = await import("../api/_lib/supabase.js");
const { env } = await import("../api/_lib/env.js");

try {
  const existing = await db.one("select email from hq.members where role='eigenaar' limit 1");
  if (existing) { console.error("Er bestaat al een eigenaar. Voeg extra eigenaars toe via HQ › Instellingen › Toegang."); process.exit(2); }
  let user;
  try { user = await sb.inviteUser(email, `${env.siteUrl}/login?type=invite`); }
  catch (e) {
    user = await sb.findUserByEmail(email);
    if (!user) throw e;
    console.log("Dit adres bestaat al in Supabase Auth; er is geen nieuwe uitnodiging verstuurd. Gebruik “Wachtwoord vergeten” op /login als je het wachtwoord niet weet.");
  }
  await db.q("insert into hq.members (user_id, email, role, status) values ($1,$2,'eigenaar','uitgenodigd') on conflict (user_id) do update set role='eigenaar'", [user.id, email]);
  await db.audit(null, { label: "bootstrap-script", action: "eigenaar.eerste", entity: "member", entityId: user.id });
  console.log(`Klaar. ${email} is eigenaar. Open de uitnodigingsmail, kies een wachtwoord en stel daarna tweestapsverificatie in.`);
} finally {
  await db.closePool();
}
