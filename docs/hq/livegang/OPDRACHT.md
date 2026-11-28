# Opdracht: StrakWerk volledig live op Cloudflare + Supabase, klaar voor sales

Je werkt voor Rayan, eigenaar van StrakWerk (webdesign, Zoetermeer). Communiceer in het Nederlands.
Je hebt via de Claude-extensie toegang tot zijn geopende accounts: **Cloudflare, Supabase, Hostnet en GitHub** (en Google voor Gmail).

**Doel:** www.strakwerkk.nl verhuist van Vercel naar Cloudflare, met de database op Supabase. StrakWerk HQ werkt live (`/hq`), en aanvragen en sales kunnen binnenkomen.

## Harde regels
- **€0 extra per maand.** Gebruik alleen gratis plannen: Cloudflare Free/Workers Free, Supabase Free, Google gratis. Klik nooit op upgrade, trial of betaalmethode. Vraagt iets om betaling: stop en meld het.
- **Inloggen, wachtwoorden en tweestapsverificatie doet Rayan zelf.** Vraag het hem en wacht.
- **Geheimen nooit in GitHub, nooit in de chat, nooit in een bestand.** Ze gaan alleen in Cloudflare (Variables and Secrets) of Supabase. Kopieer ze in de browser direct van bron naar doel.
- **Verwijder geen gegevens of DNS-records** zonder eerst te laten zien wat er staat en Rayan om akkoord te vragen. Uitzondering: het vervangen van het www-record door de Worker in fase 6.
- De live site mag zo kort mogelijk onbereikbaar zijn. Volg de volgorde hieronder.
- **Ga pas live (fase 6) als fase 2 t/m 5 geslaagd zijn.** Lukt een controle niet: stop, meld wat er misgaat en wat je nodig hebt.
- Acquisitiemails gaan pas echt naar bedrijven als Rayan dat expliciet per keer bevestigt (fase 7). AI blijft uit tot Rayan zijn tegoed bevestigt.

## De code (al klaar en getest)
- Repository `rayangaming386-del/strakwerkupdated`. Branch **`claude/hq-cloudflare`** is de complete versie (PR #1 + #2 + #3 + #4).
- Volledige technische uitleg: `docs/hq/cloudflare.md` op die branch. Lees die eerst.
- Database in één bestand: `docs/hq/livegang/migraties.sql` (veilig om te herhalen).
- Heb je een terminal? Dan mag je de terminalvariant uit `docs/hq/cloudflare.md` gebruiken (wrangler). Zonder terminal: volg de stappen hieronder; alles kan via de dashboards.

---

## Fase 1: Supabase (database en inloggen)
1. Open Supabase. Is er al een project voor StrakWerk HQ? Gebruik dat. Zo niet: maak een gratis project "strakwerk-hq", regio **Central EU (Frankfurt)**. Rayan kiest en bewaart het databasewachtwoord zelf.
2. **SQL Editor:** open `docs/hq/livegang/migraties.sql` op GitHub (branch `claude/hq-cloudflare`, knop "Raw"), kopieer de hele inhoud, plak in een nieuwe query en klik Run. Onderaan moeten 5 regels staan: `001_…` t/m `005_…`.
3. Authentication:
   - **Sign In / Providers › Email:** e-mail aan, "Allow new users to sign up" **uit**.
   - **Multi-Factor:** TOTP aan.
   - **URL Configuration:** Site URL `https://www.strakwerkk.nl`. Redirect URLs: `https://www.strakwerkk.nl/**`. De workers.dev-URL voeg je toe in fase 2.
4. **Eerste eigenaar** (als die nog niet bestaat; controleer met `select * from hq.members;`):
   1. Authentication › Users › **Invite user** met Rayans e-mailadres. Vraag welk adres hij wil.
   2. Daarna in de SQL Editor:
      ```sql
      insert into hq.members (user_id, email, role, status)
      select id, email, 'eigenaar', 'uitgenodigd' from auth.users where lower(email) = lower('ADRES-VAN-RAYAN')
      on conflict (user_id) do update set role = 'eigenaar';
      ```
   3. Rayan opent de uitnodigingsmail pas in fase 3, op de preview.
5. Noteer waar de gegevens staan, maar zet ze niet in de chat:
   - Project Settings › API: Project URL, publishable key, secret key;
   - Database › Connect: de **Transaction pooler**-verbinding (poort 6543) met het wachtwoord;
   - JWT: nieuwe projecten gebruiken JWKS, dan is geen JWT-secret nodig. Bij een ouder project met "Legacy JWT secret" gebruik je die als `SUPABASE_JWT_SECRET`.

## Fase 2: Cloudflare Worker (preview op workers.dev, nog niet live)
1. Ga in Cloudflare naar **Workers & Pages › Create › Import a repository** en koppel GitHub `rayangaming386-del/strakwerkupdated`.
   - Project name: **`strakwerk`**. Moet gelijk zijn aan `name` in `wrangler.toml`.
   - Production branch: **`claude/hq-cloudflare`** (tijdelijk; na de livegang `main`).
   - Build command: leeg laten. Deploy command: `npx wrangler deploy`. Root directory: `/`.
   - Mislukt de build: lees de buildlog.
     - Gaat de fout over de service-binding `SELF` ("service not found"): de Worker bestaat bij de eerste deploy nog niet. Probeer opnieuw (Retry) zodra de Worker is aangemaakt. Blijft het falen: meld het, en pas niets aan in de code zonder Rayan.
     - Gaat het om de Node-versie: zet onder Build › Variables `NODE_VERSION = 22`.
2. Ga naar **Settings › Variables and Secrets** en voeg toe als **Secret** (type "Secret", niet "Text"):

   | Naam | Waarde |
   |---|---|
   | `DATABASE_URL` | Supabase Transaction pooler (6543) |
   | `SUPABASE_URL` | Project URL |
   | `SUPABASE_PUBLISHABLE_KEY` | publishable key |
   | `SUPABASE_SECRET_KEY` | secret key |
   | `SUPABASE_JWT_SECRET` | alleen bij een legacy-project |
   | `CRON_SECRET` | nieuw: 40 willekeurige tekens (laat de browser of een wachtwoordbeheerder ze maken) |
   | `HQ_ENCRYPTION_KEY` | nieuw: 40 willekeurige tekens |
   | `HQ_INBOUND_SECRET` | nieuw: 40 willekeurige tekens |

   Bestaan er al HQ-variabelen in Vercel (Settings › Environment Variables), neem dan `HQ_ENCRYPTION_KEY` daar over in plaats van een nieuwe te maken.

   Opslaan, daarna opnieuw deployen (Deployments › Retry of een nieuwe build).
3. Noteer de URL: `https://strakwerk.<subdomein>.workers.dev`. Zet `https://strakwerk.<subdomein>.workers.dev/**` bij de Redirect URLs in Supabase.

## Fase 3: Preview controleren
Open deze adressen op de preview en controleer de uitkomst:

| Adres | Verwachte uitkomst |
|---|---|
| `/` | de site |
| `/werk/vagpro` | de pagina |
| `/service-pro` | doorverwijzing naar `/prijzen` |
| `/bestaat-niet` | de 404-pagina |
| `/package.json` | 404, geen code |
| `/hq/assets/app.js` | doorverwijzing naar inloggen, geen code |
| `/api/hq/vandaag` | `{"error":…}` met status 401 |

Heb je een terminal: `node scripts/cf-smoke.mjs --base <preview> --cron-secret <CRON_SECRET>` moet alles ✓ geven.

**Rayan logt in:**
1. Rayan opent de uitnodigingsmail. Wijst de link naar www.strakwerkk.nl, vervang dan het domein door de preview-URL.
2. Hij kiest een wachtwoord en stelt de authenticator-app in.
3. Daarna moet `/hq` werken. Controleer op zijn telefoon `/hq/vandaag`, `/hq/klanten` en `/hq/kantoor`: niets mag buiten beeld vallen en er mogen geen foutmeldingen zijn.

**Cron:** na 5 minuten moet in Supabase `select key, updated_at from hq.settings where key like 'cron:%';` recente tijden tonen voor `cron:taken` en `cron:klant`. Of kijk in HQ › Kantoor › Routes & fouten › "Geplande taken".

## Fase 4: Scout met echte bedrijven (vanaf de preview)
1. Ga in HQ naar Kantoor › Scout › Salons › **"Zoek in Zoetermeer"**, en daarna Autobedrijven › "Zoek in Den Haag".
2. Wacht 2 tot 5 minuten. Kijk dan onder Klanten › "Gevonden door Scout".
3. Maak voor Rayan een overzicht per bedrijf:
   - naam en plaats;
   - de bron (OpenStreetMap-link en datum);
   - de websitestatus met de gedane controles;
   - de prioriteit en reden;
   - de verkoopkans (observaties van de Auditor, met de pagina);
   - de contactroute (e-mail of telefoon, en of er een contactgrond is).
4. Komt er niets binnen? Kijk in Kantoor › Routes & fouten en bij Taken naar de foutmelding. Is OpenStreetMap druk of geweigerd: zet bij de Worker een variabele `OVERPASS_URL = https://overpass.kumi.systems/api/interpreter` en probeer opnieuw.

## Fase 5: E-mail (gratis)
**Uitgaand, via de Gmail API (zonder terminal):**
1. console.cloud.google.com, ingelogd als strakwerkk@gmail.com: maak een nieuw project "strakwerk-hq" en zet de **Gmail API** aan.
2. **OAuth consent screen:** External, app-naam "StrakWerk HQ". Zet hem daarna op **"In production"**; in "Testing" verloopt het token na 7 dagen. De melding "niet geverifieerd" is in orde, want alleen Rayan gebruikt de app.
3. **Credentials:** maak een OAuth client ID van het type **Web application** met als Authorized redirect URI `https://developers.google.com/oauthplayground`.
4. Ga naar developers.google.com/oauthplayground:
   1. Tandwiel › "Use your own OAuth credentials" en vul client ID en secret in.
   2. Kies als scope alleen `https://www.googleapis.com/auth/gmail.send`.
   3. Authorize APIs. Rayan logt in met strakwerkk@gmail.com en geeft toestemming.
   4. Klik "Exchange authorization code for tokens".
5. Zet bij de Worker als Secret: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` (het refresh token).

**Binnenkomend, via Cloudflare Email Routing.** Dit kan pas nadat strakwerkk.nl in fase 6 naar Cloudflare is overgezet. Voer het daar uit en test dan:
1. Email › Email Routing: zet het aan voor het **subdomein `reply.strakwerkk.nl`**. Raak de MX van strakwerkk.nl zelf niet aan.
2. Destination addresses: strakwerkk@gmail.com. Rayan bevestigt via de mail die hij krijgt.
3. Routing rule: `antwoord@reply.strakwerkk.nl` → **Send to a Worker** → `strakwerk`.
4. Zet bij de Worker als Text-variabelen: `MAIL_REPLY_TO = antwoord@reply.strakwerkk.nl` en `MAIL_FORWARD_TO = strakwerkk@gmail.com`. Deploy opnieuw.

**Mailtest** (na stap 4 van fase 6):
1. Ga in HQ naar Kantoor › Routes & fouten en klik **"Testmail naar mezelf"**. De mail moet aankomen in Rayans inbox.
2. Rayan antwoordt, bijvoorbeeld met "Wat kost dat?".
3. Binnen 1 minuut moet het antwoord op de klantkaart "Mailtest StrakWerk HQ" staan, en de geplande opvolging op "geannuleerd".

## Fase 6: Livegang
1. **Domein toevoegen in Cloudflare:** Add a site, `strakwerkk.nl`, plan **Free**.
   - Vergelijk de gescande DNS-records met de DNS-lijst bij **Hostnet**. Alles moet over, vooral **MX, TXT (SPF/DKIM/verificaties) en CNAME's**.
   - Records die nu naar Vercel wijzen (www en apex) blijven voorlopig staan, op **DNS only (grijze wolk)**.
   - Laat het overzicht aan Rayan zien vóór de volgende stap.
2. **Nameservers:** zet bij **Hostnet** (domeinbeheer › nameservers) de twee nameservers die Cloudflare opgeeft. Hostnet blijft de registrar. Wacht tot Cloudflare "Active" toont; dat kan van minuten tot enkele uren duren. De site blijft al die tijd op Vercel draaien.
3. **Worker aan het domein:**
   1. Verwijder in Cloudflare DNS het www-record naar Vercel. Dit is de toegestane uitzondering.
   2. Ga naar Workers › strakwerk › Settings › Domains & Routes › Add › **Custom domain: `www.strakwerkk.nl`**.
   3. Zet voor de kale domeinnaam het apex-record (naar Vercel) om naar een **A-record `192.0.2.1`, Proxied (oranje wolk)**.
   4. Maak onder **Rules › Redirect Rules** een regel: als hostnaam gelijk is aan `strakwerkk.nl`, dan dynamische redirect naar `concat("https://www.strakwerkk.nl", http.request.uri.path)`, 301, querystring behouden.
4. **Controle live:**
   - Heb je een terminal: `node scripts/cf-smoke.mjs --base https://www.strakwerkk.nl`. Zonder terminal: de lijst uit fase 3 op www.strakwerkk.nl.
   - `https://strakwerkk.nl/prijzen` moet doorsturen naar www.
   - Rayan logt in op `https://www.strakwerkk.nl/login`.
   - Voer nu ook Email Routing en de mailtest uit fase 5 uit.
5. **Mergen** op GitHub:
   1. Ga in Vercel naar Settings › Git en klik **Disconnect**, zodat een merge niet ook naar Vercel deployt.
   2. Merge in deze volgorde: **PR #1 → #2 → #3 → #4** (elk met "Merge pull request").
   3. Zet bij Cloudflare Workers › strakwerk › Settings › Builds de production branch op **`main`** en controleer dat de nieuwe build van `main` slaagt.
6. **Vercel opruimen:**
   - verwijder het domein uit het Vercel-project. Verwijder het project zelf niet; laat de beslissing daarover bij Rayan;
   - staat er in Supabase een pg_cron-job die de oude Vercel-URL `/api/worker` aanroept: laat hem zien en zet hem uit;
   - Search Console blijft werken (zelfde domein).

## Fase 7: Klaar voor sales
1. **Formuliertest:**
   1. Open `https://www.strakwerkk.nl/contact?sw_test=1` en vul in: naam "Test Rayan", bedrijf "Testbedrijf", bericht "Ik wil een website met afspraken".
   2. Klik "Verstuur via WhatsApp". Je hoeft niet echt te versturen.
   3. In HQ, met de schakelaar op "Test & demo", moet er een klantkaart staan met een antwoordconcept en een offerte op basis van de prijslijst.
2. **Ochtendoverleg:** klik in HQ › Kantoor › Overleg op "Overleg nu opnieuw opstellen" en laat Rayan de acties zien.
3. **Acquisitie:**
   - Laat Rayan de gevonden bedrijven uit fase 4 zien.
   - Leg uit: e-mail gaat alleen uit naar bedrijven met een vastgelegde contactgrond; een openbaar e-mailadres alleen is niet genoeg. Zonder grond zet HQ een bericht klaar om zelf te versturen (bijv. WhatsApp of bellen) of gebruikt het als marketinginput.
   - Zet **niets** op "Automatisch" of "Live" zonder Rayans uitdrukkelijke ja, en vraag hem dan te bevestigen dat de voorwaarden van Gmail zijn gecontroleerd.
4. Vraag Rayan of de wekelijkse Scout-ronde aan moet (Kantoor › Instellingen) en voor hoeveel bedrijven per week.

## Eindverslag aan Rayan
- De werkende links: `https://www.strakwerkk.nl`, `https://www.strakwerkk.nl/hq`, en de workers.dev-URL.
- Per fase: geslaagd of niet, met wat je hebt gecontroleerd.
- De Scout-lijst uit fase 4.
- Wat nu vanzelf draait:
  - elke minuut de takenwachtrij;
  - elke 5 minuten berichten, controles en het overleg om 08:30;
  - elke 10 minuten de contentstudio;
  - formulier → klantkaart;
  - antwoorden → klantkaart;
  - afmelden met één klik.
- Wat nog aanstaat voor Rayan: acquisitie live zetten, AI-tegoed bevestigen, wekelijkse Scout, eventueel Hyperdrive.
- Eventuele blokkades, precies: welke toegang of instelling ontbreekt.

## Daarna: salesmotor (PR #5, pas na de livegang)
Alleen uitvoeren als Rayan PR #5 heeft gemerged en Workers Builds de nieuwe versie heeft gebouwd.
1. **Database:** voer `docs/hq/livegang/migraties.sql` opnieuw uit in de Supabase SQL Editor. Het
   bestand slaat 001 t/m 005 over ("Al gedaan") en voert 006, 007 en 008 uit. Controle:
   `select name from public.hq_schema_migrations order by name;` toont acht regels.
2. **Instellingen** (HQ › Kantoor › Instellingen › Verkoop), samen met Rayan:
   - betaalwijze: Rayan wil het liefst **contant** (standaard). IBAN en tenaamstelling alleen als hij "contant of overmaken" kiest;
   - e-mailadres voor meldingen: een ander adres dan het afzendadres (mail aan jezelf geeft vaak geen pushmelding);
   - Google-reviewlink uit zijn Bedrijfsprofiel (als dat er al is);
   - beloning voor een verwijzing alleen als Rayan die wil.
3. **Controles op de echte site** (`node scripts/cf-smoke.mjs --base https://www.strakwerkk.nl` moet alles groen geven), plus:
   - `/websitecheck`: vul `strakwerkk.nl` in; binnen een halve minuut een uitslag;
   - `/_vercel/insights/script.js` geeft 200 (geen 404 meer in de console op elke pagina);
   - HQ › Vandaag toont "Bellen en langsgaan" en "Meldingen"; HQ › Kantoor › Instellingen toont "Verkoop", "AI-budget per post" en "Bestaande klanten".
4. **Bestaande klanten** (HQ › Kantoor › Instellingen › Bestaande klanten): alleen invoeren als Rayan de
   lijst aanlevert en zelf de twee vragen over de herkomst beantwoordt. Niets versturen zonder Rayan.
5. **Niets** op automatisch of live zetten. Bellen en langsgaan doet Rayan zelf; HQ zet alleen klaar.
