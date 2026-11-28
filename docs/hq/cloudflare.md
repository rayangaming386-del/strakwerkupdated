# StrakWerk op Cloudflare (gratis): ombouw en overdracht

Branch: **`claude/hq-cloudflare`**. Dat is de complete versie (PR #1 + #2 + #3) plus de ombouw naar Cloudflare.
Extra kosten: **€0**. Alles hieronder valt binnen de gratis plannen van Cloudflare, Supabase, Google en GitHub.

## Wat er is omgebouwd
| Onderdeel | Vercel (oud) | Cloudflare (nieuw) |
|---|---|---|
| Statische site | Vercel, `cleanUrls` | Workers Static Assets (`dist/`, gemaakt door `scripts/build-cf.mjs`), `auto-trailing-slash`, `404.html`, `_redirects`, `_headers` |
| API (`/api/hq`, `/api/auth`, `/api/public`, `/api/collect`, `/api/worker`) | 5 Vercel-functies | Dezelfde handlers in één Worker (`worker/index.js`) |
| Afscherming `/hq` | `middleware.js` | `api/_lib/guard.js` in de Worker. De HQ-bestanden zitten **in de Worker**, niet in de publieke map. Zonder geldige sessie krijg je geen byte HTML/JS/CSS (ook niet via `/%68q/...` of `/HQ/...`) |
| Database | één pool per functie | één verbinding per verzoek (Workers mag verbindingen niet delen), automatisch gesloten. Optioneel Hyperdrive (gratis) |
| Werk na het antwoord | `@vercel/functions` | `ctx.waitUntil` (max. 30 s), via `api/_lib/runtime.js` |
| Geplande taken | Vercel Cron 1×/dag + pg_cron | Cron-trigger **elke minuut**. Elk onderdeel draait in een eigen aanroep via de eigen service-binding: taken elke minuut, klanten winnen elke 5 min, content elke 10 min, bewaartermijnen elk uur. Laatste run per onderdeel staat in `hq.settings` (`cron:taken`, `cron:klant`, …) |
| Taakduur | max. 60 s | max. 25 s per taak. Scout is daarom opgesplitst: één taak per plaats (OpenStreetMap) plus één korte taak per bedrijf (websitecontrole) |
| Webpagina's ophalen | `node:http` met DNS-controle | `fetch()` (Workers kan geen privé-netwerken bereiken). Max. 6 s en 400 kB per pagina |
| E-mail uit | SMTP | **Gmail API** (HTTPS, recht `gmail.send`) vanaf strakwerkk@gmail.com. SMTP blijft alleen voor lokaal gebruik |
| E-mail in | webhook | **Cloudflare Email Routing → Worker** (`email()`): antwoord → juiste klantkaart, opvolging stopt, en altijd doorgestuurd naar je Gmail |
| Mailtest | n.v.t. | Kantoor › Routes & fouten › **"Testmail naar mezelf"** (alleen naar het e-mailadres van de ingelogde eigenaar) |

## Getest in deze sessie (lokaal, in `workerd`: dezelfde runtime als Cloudflare)
- `node scripts/cf-smoke.mjs`: **60/60**. Gecontroleerd:
  - de statische site;
  - de redirects en de 404-pagina;
  - dat geen privébestand publiek is (servercode, migraties, docs, `.env` en HQ-bestanden, ook met omzeilingspogingen);
  - `/hq` en de HQ-scripts zonder sessie of met een vervalste sessie: doorgestuurd naar inloggen;
  - alle HQ-API's zonder sessie: 401;
  - CSRF;
  - cron zonder geheim of met een fout geheim;
  - de mailingang zonder geheim;
  - een formulier van een andere site;
  - een onbekende intake-link en een vervalste afmeldlink;
  - met een sessie: `/hq` en de API's;
  - alle cron-onderdelen.
- De echte cron-trigger (`scheduled`) → de service-binding → `/api/worker`, met een tijdstempel in de database. Een gepland bericht werd daardoor opgepakt en verwerkt (zie PR #4).
- De echte e-mailhandler (`email()`) met een ruw antwoord: het antwoord kwam op de juiste klantkaart (via In-Reply-To), de opvolging werd geannuleerd en er kwam een antwoordconcept.
- `npm test`: alle Node-tests, waaronder de Gmail-route met een nagebootste Google-server:
  - de echte Message-ID wordt teruggelezen;
  - Reply-To en de afmeldheaders staan erin;
  - de mail gaat alleen naar het eigen adres;
  - een fout vernieuwingstoken geeft een duidelijke fout.

**Niet getest** (vraagt jouw accounts): het echte Cloudflare-account, Supabase-productie, inloggen met MFA, echte Gmail, echte DNS en mail, en echte Scout-resultaten. Vanuit de cloudsandbox kwam ik niet bij OpenStreetMap: de verbinding werd steeds verbroken.

## Overdracht: stappen voor de Claude-sessie op je eigen computer
Doe dit in een Claude-sessie op je computer met de extensie (Claude in Chrome) en de accounts open. **Persoonlijke inlog en tweestapsverificatie doe je zelf.** Geheimen gaan alleen in Cloudflare of Supabase, nooit in Git of de chat.

### 0. Voorbereiden
```bash
git clone https://github.com/rayangaming386-del/strakwerkupdated && cd strakwerkupdated
git checkout claude/hq-cloudflare
npm ci
npx wrangler login          # jij logt in bij Cloudflare
```

### 1. Database (Supabase)
1. Zoek in Supabase › Project Settings › Database twee verbindingen op:
   - **Direct connection** (poort 5432) voor de migraties;
   - **Transaction pooler** (poort 6543) voor de Worker.
2. Migreer (eenmalig, vanaf je computer):
   ```bash
   DATABASE_URL="<direct, 5432>" npm run migrate
   ```
   Dit voert 001 t/m 005 uit; al uitgevoerde migraties worden overgeslagen.
3. Bestaat er nog geen eigenaar? Draai `DATABASE_URL=... npm run bootstrap-owner` (zie `docs/hq/installatie.md`).

### 2. Worker aanmaken en geheimen zetten (preview op workers.dev, nog niet live)
1. Eerste deploy. Dit maakt de Worker aan op `https://strakwerk.<jouw-subdomein>.workers.dev`; het is nog niet je domein:
   ```bash
   npx wrangler deploy
   ```
2. Zet de geheimen. Per geheim vraagt wrangler om de waarde; die plak je in de terminal:
   ```bash
   npx wrangler secret put DATABASE_URL              # transaction pooler (6543)
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
   npx wrangler secret put SUPABASE_SECRET_KEY
   npx wrangler secret put SUPABASE_JWT_SECRET       # alleen bij een oud project met HS256; anders overslaan
   npx wrangler secret put CRON_SECRET               # nieuw, minstens 32 tekens
   npx wrangler secret put HQ_ENCRYPTION_KEY         # DEZELFDE als op Vercel (versleutelde Instagram-token)
   npx wrangler secret put HQ_INBOUND_SECRET         # nieuw, minstens 32 tekens
   ```
3. Supabase › Authentication › URL Configuration: voeg de workers.dev-URL toe aan de Redirect URLs (voor uitnodigingen en het herstellen van een wachtwoord).

### 3. Preview controleren
```bash
node scripts/cf-smoke.mjs --base https://strakwerk.<subdomein>.workers.dev --cron-secret <CRON_SECRET>
```
Alles moet ✓ zijn. Log daarna zelf in op `<preview>/login` met wachtwoord en MFA.
- Op je telefoon: bekijk `/hq/vandaag`, `/hq/klanten` en `/hq/kantoor`, en controleer dat je eigenaar bent (Instellingen).
- Na 1 tot 5 minuten tonen `cron:taken` en `cron:klant` in Supabase (`select key, updated_at from hq.settings where key like 'cron:%'`) dat de cron draait.

### 4. Scout met echte bedrijven (vanaf de preview)
1. Ga in HQ naar Kantoor › Scout › Salons › "Zoek in Zoetermeer" (en eventueel Autobedrijven).
2. Na 1 tot 3 minuten (de cron) staan ze onder Klanten › "Gevonden door Scout". Per bedrijf zie je:
   - de bron (OpenStreetMap-link + datum);
   - de websitecontrole (elke stap met uitkomst);
   - de prioriteit met reden;
   - de verkoopkans: bij een website de observaties van de Auditor met de exacte pagina;
   - de contactroute: e-mail of telefoon uit open data, en of er een contactgrond is. Zonder contactgrond wordt er niet gemaild.
3. Weigert OpenStreetMap (te druk of geblokkeerd)? Zet `OVERPASS_URL` als variabele op een andere publieke Overpass-server en probeer opnieuw.

### 5. E-mail koppelen (gratis)
**Uitgaand, via de Gmail API:**
1. console.cloud.google.com: maak een nieuw project en zet de **Gmail API** aan.
2. OAuth consent screen: kies "External". Zet hem daarna op **"In production"**; in "Testing" verloopt het token na 7 dagen. Google toont een waarschuwing "niet geverifieerd" omdat alleen jij de app gebruikt; dat is in orde.
3. Credentials: maak een OAuth-client van het type **Desktop app**.
4. Op je computer:
   ```bash
   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node scripts/gmail-koppelen.mjs
   ```
   Log in met strakwerkk@gmail.com. Het script zet de drie geheimen direct in Cloudflare.

**Binnenkomend, via Cloudflare Email Routing.** Dit vraagt dat het domein strakwerkk.nl bij Cloudflare staat (stap 6.1):
1. Email › Email Routing: zet het aan voor het **subdomein** `reply.strakwerkk.nl`. De MX van strakwerkk.nl zelf blijft dan ongemoeid.
2. Destination addresses: voeg strakwerkk@gmail.com toe en bevestig het via de mail die je krijgt.
3. Routing rule: `antwoord@reply.strakwerkk.nl` → **Send to a Worker** → `strakwerk`.
4. Zet de variabelen:
   - `MAIL_REPLY_TO = antwoord@reply.strakwerkk.nl`
   - `MAIL_FORWARD_TO = strakwerkk@gmail.com`

   Gebruik `npx wrangler secret put` of het dashboard.

**Test:** HQ › Kantoor › Routes & fouten › **Testmail naar mezelf**.
1. De mail moet aankomen in je inbox.
2. Beantwoord hem, bijvoorbeeld met "Wat kost dat?".
3. Je antwoord moet binnen een minuut op de klantkaart "Mailtest StrakWerk HQ" staan, en de geplande opvolging moet op "geannuleerd" staan.

Acquisitie verstuurt pas echt als jij in Kantoor › Routes "Automatisch aan" en "Live aan" zet.

### 6. Livegang (alleen als stap 3 t/m 5 geslaagd zijn)
1. **Domein naar Cloudflare.** Voeg strakwerkk.nl toe in Cloudflare (Free plan) en controleer dat alle bestaande DNS-records zijn overgenomen. Let vooral op MX/TXT als je bij Hostnet mail op het domein hebt. Zet daarna bij **Hostnet** de nameservers op de twee van Cloudflare. Hostnet blijft je registrar.
2. **Domein aan de Worker.** Ga naar Workers › strakwerk › Settings › Domains & Routes › Add › Custom domain: `www.strakwerkk.nl`.
3. **Kale domeinnaam.** Rules › Redirect Rules: hostnaam `strakwerkk.nl` → `https://www.strakwerkk.nl${http.request.uri.path}` (301, querystring behouden).
4. Controleer de live omgeving:
   ```bash
   node scripts/cf-smoke.mjs --base https://www.strakwerkk.nl --cron-secret <CRON_SECRET>
   ```
5. **Mergen.** Merge op GitHub, in deze volgorde: PR #1 → #2 → #3 → #4. Daarna staat alles op `main`.
6. **Automatisch deployen (gratis).** Ga naar Workers › strakwerk › Settings › Builds › Connect: GitHub `rayangaming386-del/strakwerkupdated`, branch `main`. Laat het build-commando leeg; wrangler bouwt zelf. Het deploy-commando is `npx wrangler deploy`.
7. **Vercel.** Verwijder in het Vercel-project het domein en zet de Git-koppeling uit, zodat er niet twee keer wordt gedeployd. Staat er een pg_cron-job in Supabase die de oude `/api/worker` aanroept? Verwijder die; Cloudflare doet het nu elke minuut.

## Wat daarna vanzelf draait
- **Elke minuut:** de takenwachtrij (Scout, websitecontrole, Auditor, berichten).
- **Elke 5 minuten:** berichten die aan de beurt zijn, controle op eigen fouten, het ochtendoverleg (eenmaal per dag om 08:30), herinneringen voor de intake, dinsdag de Scout-ronde (als je die aanzet) en maandag de voorstellen.
- **Elke 10 minuten:** de contentstudio (kantoorplan, automatisering, AI-taken hervatten).
- **Elk uur:** bewaartermijnen.
- **Altijd:** formulier → klantkaart, afmelden met één klik, binnenkomende mail → klantkaart.
- **Afhankelijk van jou:**
  - echte AI-aanroepen (alleen met een bevestigd AI-budget en `ANTHROPIC_API_KEY`);
  - acquisitieverzending (Routes: automatisch en live);
  - de wekelijkse Scout-ronde.

## Gratis grenzen en bekende risico's
- **Workers Free:** 100.000 verzoeken per dag. Statische bestanden tellen niet als Worker-aanroep, behalve `/api`, `/hq` en `/intake`.
- **Rekentijd:** **10 ms per aanroep**. Wachten op het netwerk telt niet mee. Pagina's zijn daarom begrensd tot 400 kB en de cron is opgesplitst. Komt er toch fout 1102 ("exceeded resource limits") in de logs (Workers › strakwerk › Logs), dan krijgt die taak automatisch een herkansing. Blijft het gebeuren, dan is de gratis oplossing die taak verder opknippen; Workers Paid ($5 per maand) valt buiten je budget.
- **Cron-triggers:** 1 van de 5 gratis gebruikt.
- **Email Routing:** gratis. Doorsturen kan alleen naar bevestigde adressen.
- **Gmail API:** gratis. De gewone verzendlimieten van je Gmail-account blijven gelden; HQ verstuurt standaard maximaal 10 per dag.
- **Supabase Free:** het project pauzeert na 7 dagen zonder activiteit. De cron houdt het elke minuut actief.
