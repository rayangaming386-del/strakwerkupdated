# StrakWerk HQ — installatie en beheer

HQ is de afgeschermde beheeromgeving onder `/hq` (login op `/login`). Het draait in hetzelfde
Vercel-project als de website: de site blijft statisch, HQ voegt alleen Vercel Functions
(`api/`), één middleware-bestand en statische HQ-bestanden toe. Geen herbouw, geen nieuwe hosting.

## Architectuur in het kort

| Onderdeel | Waar | Wat |
|---|---|---|
| Inloggen, wachtwoordherstel, MFA | Supabase Auth | Uitnodiging via e-mail, geen openbare registratie. Wachtwoorden en inlogbeperking regelt Supabase. |
| Sessie | `api/auth.js` | Supabase-tokens worden gecontroleerd en als HttpOnly/Secure/SameSite-cookies gezet. De browser bewaart zelf geen tokens. |
| Afscherming `/hq` | `middleware.js` | Zonder geldige sessie geen HTML/JS/CSS van HQ. |
| Gegevens | `api/hq.js` → Postgres (schema `hq`) | Elke route controleert sessie, lidmaatschap, rol en MFA. |
| Takenwachtrij | `hq.tasks` + `api/_lib/queue.js` + `api/_lib/worker.js` | Persistent, met leases, time-outs, herhaalpogingen, limieten. |
| Bezoekersmeting | `assets/sw-metrics.js` → `api/collect.js` | Eigen meting zonder cookies; Vercel Web Analytics API optioneel ernaast. |
| Onderhoud | `api/worker.js` (Vercel Cron, dagelijks) | Bewaartermijnen + vangnet voor vastgelopen taken. |

Realtime: HQ gebruikt geen open realtimekanalen. De interface vraagt de beveiligde API periodiek
op (agentwereld elke 5 s, overzicht en bezoekers elke 30 s, alleen als het tabblad zichtbaar is).

## 1. Supabase-project aanmaken (gratis plan volstaat om te starten)

1. Maak een project op supabase.com, regio **EU (Frankfurt)**.
2. **Authentication › Sign In / Providers › Email**: e-mail aan, **"Allow new users to sign up" UIT**.
   Zo kan niemand zelf een account maken; alleen uitnodigingen werken.
3. **Authentication › Multi-Factor**: **TOTP aan**. (HQ verplicht MFA voor de rol eigenaar.)
4. **Authentication › URL Configuration**: Site URL `https://www.strakwerkk.nl`, en voeg
   `https://www.strakwerkk.nl/login` toe aan de Redirect URLs (voor lokaal testen ook `http://localhost:3000/login`).
5. **Authentication › Rate Limits**: laat de standaardlimieten staan of verlaag ze. Optioneel:
   **Attack Protection › CAPTCHA** (Turnstile) — dan moet de loginpagina het CAPTCHA-token meesturen;
   dat is in deze versie nog niet ingebouwd.
6. **Authentication › Emails › SMTP**: de ingebouwde mail van Supabase is beperkt (laag aantal mails per uur).
   Stel voor productie een eigen SMTP-dienst in.
7. Noteer uit **Project Settings › API**: Project URL, de **publishable key** (of anon key) en de
   **secret key** (of service_role key). Uit **Connect › Transaction pooler**: de connection string.

Let op (gratis plan): een project dat een week geen activiteit heeft, wordt gepauzeerd. HQ toont dan
"Database niet bereikbaar"; herstart het project in Supabase of kies een betaald plan.

## 2. Omgevingsvariabelen in Vercel

Vercel › Project › Settings › Environment Variables (Production, en eventueel Preview met een aparte database).
Zie `.env.example` voor alle namen en uitleg. Minimaal:

```
DATABASE_URL            (transaction pooler, poort 6543)
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY     (alleen server; nodig voor uitnodigen)
HQ_SITE_URL=https://www.strakwerkk.nl
CRON_SECRET             (lang willekeurig: openssl rand -hex 32)
```

Optioneel: `ANTHROPIC_API_KEY` (Claude voor Scout/Auditor/Sales), `PAGESPEED_API_KEY`,
`VERCEL_ANALYTICS_TOKEN` + `VERCEL_PROJECT_ID` (+ `VERCEL_TEAM_ID`).

Zet geen van deze waarden in de code, in GitHub of in chat. HQ toont in Instellingen alleen
wélke namen ontbreken, nooit waarden.

## 3. Database klaarzetten

Eenmalig vanaf je eigen computer (Node 20+):

```
npm install
DATABASE_URL='…' npm run migrate
```

Alle tabellen staan in het schema `hq` (niet `public`), met RLS aan en zonder rechten voor de
publieke Supabase-rollen. De publieke sleutel kan er dus niet bij.

## 4. Eerste eigenaar veilig activeren

Er is geen standaardwachtwoord en geen registratiepagina. Het eerste eigenaarsaccount maak je
eenmalig met een script op je eigen computer:

```
DATABASE_URL='…' SUPABASE_URL='…' SUPABASE_SECRET_KEY='…' HQ_SITE_URL=https://www.strakwerkk.nl \
  npm run bootstrap-owner -- jouw@adres.nl
```

1. Supabase stuurt een uitnodigingsmail naar dat adres.
2. Open de link: je komt op `/login` en kiest een wachtwoord (minimaal 12 tekens; gebruik een wachtwoordbeheerder).
3. HQ vraagt direct om tweestapsverificatie: scan de QR-code met een authenticator-app en vul de code in.
4. Klaar. Het script weigert te draaien zodra er een eigenaar bestaat.

Daarna nodig je anderen uit via **HQ › Instellingen › Toegang**, altijd als medewerker of
alleen-lezen. Iemand eigenaar maken is een aparte, bevestigde stap ("EIGENAAR" typen) en kan alleen
voor een actief account. De laatste eigenaar kan niet worden gedegradeerd of geblokkeerd.

**Accountherstel:** "Wachtwoord vergeten?" op `/login`. Kwijtgeraakte authenticator? Een andere
eigenaar kan het account niet resetten vanuit HQ; verwijder de MFA-factor in Supabase
(Authentication › Users › gebruiker › MFA factors) en log opnieuw in om een nieuwe in te stellen.

## 5. Uitrollen

De wijzigingen staan op een aparte branch. Mergen naar `main` zet ze live (Vercel). Vóór het mergen:

1. Variabelen uit stap 2 ingesteld, migraties uit stap 3 uitgevoerd.
2. Preview-deployment van de branch openen en controleren:
   - `/` werkt als vanouds (calculator, WhatsApp-knoppen, menu);
   - `/hq` stuurt door naar `/login`;
   - `/api/hq/overview` geeft 401 zonder login.
3. Vercel Cron draait `/api/worker` dagelijks (04:17 UTC). Op het Hobby-plan kan Cron maximaal
   dagelijks; taken worden daarnaast direct na het starten en bij elke HQ-poll opgepakt.

## Lokaal ontwikkelen en testen

```
cp .env.example .env.local    # vul in (bijv. een aparte Supabase-testomgeving)
npm run dev                    # http://localhost:3000 (site, /login, /hq, /api)
npm run check                  # syntax, imports, verwijzingen, geen geheimen in browsercode
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm test
```

De tests maken een tijdelijke database aan en gebruiken een nagebootste Supabase Auth-server en een
nep-bedrijfswebsite. Echte Supabase-login/MFA en echte externe websites worden daarin niet getest.

## Kosten en limieten (stand november 2026, controleer actuele prijzen)

| Dienst | Kosten | Let op |
|---|---|---|
| Vercel | Huidig plan | Hobby is bedoeld voor niet-commercieel gebruik; Cron maximaal dagelijks; functies max. 60 s (ingesteld). |
| Supabase | Gratis plan mogelijk | Pauzeert na een week inactiviteit; beperkte e-mail zonder eigen SMTP. |
| Claude API (optioneel) | Per gebruik; standaardmodel `claude-opus-5-5` ($4 / $20 per miljoen in/uit-tokens) | HQ meet de kosten per taak en stopt bij de ingestelde limieten (standaard $0,25 per taak, $2 per dag). |
| PageSpeed Insights | Gratis | Zonder sleutel lage limiet. |
| Vercel Web Analytics API | Binnen je Vercel-plan | Hobby: 1 maand historie. UTM-uitsplitsing en eigen events vragen een duurder abonnement (HQ toont dan de melding van Vercel). |

## Agents

| Rol | Status in deze versie |
|---|---|
| Scout | Aangesloten: controleert een ingevoerde lead via de eigen website (robots.txt gerespecteerd). Zelf bedrijven zoeken: **niet gekoppeld** (geen zoekbron). Relevantiebeoordeling alleen met Claude. |
| Auditor | Aangesloten: meet de homepage (https, viewport, titels, H1, alt-teksten, structured data, …), optioneel PageSpeed; interpretaties gescheiden van feiten. |
| Sales | Aangesloten: berichtconcept uit **goedgekeurd** onderzoek; zonder Claude een gemarkeerd sjabloon. Nooit prijzen/reviews/garanties (harde controle). Verstuurt niets. |
| Rank, Content, Insights, Builder, Care | Ingericht maar **niet gekoppeld**: ze tonen "Niet gekoppeld" en voeren niets uit. |

Keten: lead → Scout → Auditor → **goedkeuring onderzoek** → Sales → **goedkeuring bericht** →
handmatig versturen → "Ik heb dit verstuurd" (lead naar Benaderd). Een goedkeuring geldt één keer
en voor precies de beoordeelde tekst.

Terugkerende agentruns bestaan in deze versie niet (staan uit).
