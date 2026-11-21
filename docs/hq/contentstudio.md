# StrakWerk HQ: contentstudio

Van klantproject naar een afspeelbare video, en daarna inplannen, publiceren en leren.
De studio staat in HQ onder **Contentstudio** (`/hq/studio`) en is gemaakt voor de telefoon.

## Welke bestaande onderdelen zijn uitgebreid

| Bestaand onderdeel | Uitbreiding |
|---|---|
| Takenwachtrij (`api/_lib/queue.js`, `worker.js`) | Taken kunnen bij een contentstuk horen (`piece_id`) en op een tijdstip starten (`run_after`). De serverloze worker pakt geen video-taken (`SERVERLESS_FILTER`); een aparte render-worker pakt alleen die. Er is een lease-verlenging (`heartbeat`) en een uitkomst "later opnieuw" (`deferS`) die niet als mislukte poging telt. |
| Agents (`api/_lib/agents/registry.js`) | **Content** is nu aangesloten (planner). Er zijn twee nieuwe rollen: **Video** (videomaker, draait in de render-worker) en **Publisher** (Instagram). |
| CRM (`crm.js`, `hq.leads`, `hq.quotes`) | Een geaccepteerde offerte maakt het klantproject aan (status akkoord). Een lead kan aan een video gekoppeld worden: via de campagnelink, het WhatsApp-zoekwoord of handmatig. |
| Pakketprijzen (`hq.packages`, gelijk aan `CONFIG.bases`) | De planner leest de "vanaf"-prijs hieruit. Andere prijzen worden geweigerd. |
| `CONFIG` in `index.html` en `tools/v2/projects.json` | `npm run sync-site-data` maakt hier `api/_lib/content/site-data.json` van: prijzen, de actie met einddatum, het WhatsApp-nummer en de echte projectinformatie met de afmetingen van de screenshots. `npm run check` faalt als dat bestand verouderd is. |
| Eigen meting (`sw-metrics.js`, `analytics_events`) | Een bezoek met `utm_campaign` = campagnecode telt als klik op die video. Daarnaast is `portfolio_open` nu ook geldig voor `glow`. |
| Rollen (`auth.js`) | Nieuwe rechten: `content.write` (eigenaar en medewerker), en `content.approve`, `content.settings` en `assets.release` (alleen de eigenaar). |
| Cron (`/api/worker`) | Draait nu ook de contentautomatisering, ververst het Instagram-token en haalt de resultaten op. |

**Nieuw:**
- migratie `003_contentstudio.sql`
- `api/_lib/content/*` (studio, planner, opslag, Instagram, routes, cron)
- agents `content.js` en `publisher.js`
- de videomaker `scripts/render/*` en `scripts/render-worker.mjs`
- `scripts/demo-glow.mjs`
- `.github/workflows/hq-render.yml`
- de view `hq/assets/views/studio.js`
- de tests `tests/studio.test.mjs`

## De workflow

1. **Project en beelden.** De vier portfolioprojecten staan als klantproject klaar, met hun screenshots (`assets/work/*`).
   - Standaard is **niets** vrijgegeven voor social media. Alleen de eigenaar geeft beelden vrij, per beeld.
   - Per beeld staat wat er bij de controle opviel:
     - Alle Glow-screenshots tonen de actiebalk van de salon ("t/m 1 januari"). Ze hebben daarom een einddatum (`valid_until`). Na die datum worden ze niet meer ingepland of geplaatst.
     - `glow-salon.webp` bevat een foto van de behandelruimte. Vraag de klant eerst om toestemming.
     - `glow-contact.webp` toont het adres en telefoonnummer van de salon.
     - `cartronic-reviews.webp` toont reviews van klanten van CarTronic. Dit beeld is geblokkeerd, omdat het kan lijken op reviews van StrakWerk.
2. **Contentopdracht.**
   - **Handmatig:** kies project, doelgroep, doel en beelden.
   - **Automatisch:** zet je een project op **opgeleverd** en zijn er minstens 3 beelden vrijgegeven, dan maakt HQ één opdracht.
   - De sleutel `oplevering:<project-id>` is uniek. Herhaalde of gelijktijdige statuswijzigingen geven dus nooit een tweede opdracht (getest met drie gelijktijdige verzoeken).
3. **Planner (Content).** Stelt drie verkoophoeken voor: *Van DM naar aanvraag*, *Prijzen vooraf zichtbaar* en *Rondleiding*. Elke hoek heeft:
   - een openingszin;
   - scènes met de gebruikte beelden;
   - één oproep tot actie;
   - een Instagram- en een TikTok-caption.

   Alles komt uit de projectgegevens, de vrijgegeven beelden, de pakketprijs en de actie (met einddatum).
   - Een harde controle (`contentGuard`) weigert reviews, percentages, omzet- of resultaatclaims, voor-en-na of "oude website", garanties en elke prijs die niet uit de pakketten komt. Dat geldt ook voor jouw eigen aanpassingen.
   - Zonder `ANTHROPIC_API_KEY` werken vaste sjablonen. Met de sleutel herschrijft Claude alleen de teksten, binnen dezelfde structuur en controle.
4. **Kiezen en aanpassen.**
   - Jij kiest een hoek. Daarna pas je één scène of één caption aan zonder het concept opnieuw te maken. "Origineel" zet een scène of caption terug.
   - Na een wijziging is de vorige video niet meer goed te keuren (de goedkeuring hoort bij exact dat script). Na een wijziging van een caption krijgen nog niet geplaatste publicaties de nieuwe tekst.
5. **Videomaker (Video).** De render-worker maakt de video in twee stappen:
   - Chromium tekent elke scène in de huisstijl (1080×1920, beelden in hun eigen verhouding, binnen de veilige zones van Reels en TikTok).
   - ffmpeg monteert de scènes met een rustige zoom en zachte overgangen tot een H.264 MP4 met een stil audiospoor (`+faststart`), plus een JPEG-cover.

   Een video duurt 15 tot 25 seconden; scènes van 1,5 tot 6 seconden.
   - De worker controleert vlak voor het renderen of de beelden nog zijn vrijgegeven.
   - Het resultaat gaat naar duurzame opslag.
   - Een mislukte render toont de reden in de werkvoorraad. "Opnieuw proberen" maakt een nieuwe versie; de oude blijft bewaard. Een dubbelklik maakt geen tweede render.
6. **Review en publiceren.**
   - Je kijkt de video op je telefoon (HTTP Range, dus ook op iOS) of downloadt hem, en keurt hem goed (alleen de eigenaar).
   - Daarna plan je per kanaal in, in Nederlandse tijd. Render- en publicatiestatus staan apart, per kanaal.
7. **Leren.** Per video zie je views, klikken, aanvragen en geaccepteerde offertes apart. Wat niet gemeten is, staat er als *onbekend* en niet als 0. Elke week staat er één voorstel voor de volgende video, met de basis erbij.

**De werkvoorraad** heeft zes kolommen: Actie nodig, Concept, Render bezig, Klaar voor review, Ingepland en Gepubliceerd. Elke kaart zegt welke actie van jou nodig is. Het Overzicht van HQ begint met een lijst **Aandacht nodig**.

## Eerste werkende voorbeeld: Glow & Laser For You

Bestanden in `docs/hq/demo/`:
- `glow-saloneigenaren.mp4`: 18,5 s, 1080×1920, H.264, 30 fps.
- `glow-saloneigenaren-cover.jpg`: de cover.
- `glow-saloneigenaren.json`: scènes, captions en campagnelinks.

De video:
- **Opening:** "Saloneigenaar, plan jij nog alles via DM?"
- **Scènes daarna:** de homepage (laptop en telefoon), de pagina per behandeling, de prijslijst met zoekfunctie en de afspraakaanvraag in stappen.
- **Slot:** "Wil je dit voor jouw salon? App ‘SALON’."

De beelden zijn `glow.webp`, `glow-mobiel.webp`, `glow-behandelingen.webp`, `glow-prijzen.webp` en `glow-boeken.webp`. Er staan geen reviews, cijfers of resultaten in.

Zelf opnieuw maken (Node 20+, ffmpeg, Chromium, een lokale Postgres):

```
DATABASE_URL=postgres://postgres@127.0.0.1:5432/hq_demo npm run demo:glow -- --out docs/hq/demo
```

Het script doorloopt de hele keten:
1. beelden vrijgeven;
2. twee keer "opgeleverd" zetten (er komt één opdracht);
3. de planner laten werken;
4. de hoek *Van DM naar aanvraag* kiezen;
5. renderen;
6. goedkeuren;
7. Instagram en TikTok als export klaarzetten.

Het plaatst niets op echte accounts.

## Render-worker: waar draait die?

Vercel-functies hebben geen ffmpeg of Chromium. De render-worker draait daarom apart en kan op drie plekken:

- **GitHub Actions** (`.github/workflows/hq-render.yml`).
  - Benodigde repository-secrets: `HQ_DATABASE_URL`, `HQ_SUPABASE_URL` en `HQ_SUPABASE_SECRET_KEY`.
  - Met `GITHUB_RENDER_TOKEN` en `GITHUB_RENDER_REPO` in Vercel start HQ de workflow direct na een nieuwe render. Zonder die twee draait de workflow drie keer per dag.
  - Elke run kost ongeveer 2–3 minuten Actions-tijd (installeren plus renderen). Een render zelf duurt ongeveer 30 s.
- **Je eigen computer:** `npm run render-worker -- --watch` (met `.env.local`).
- **Lokaal en in tests:** zonder `SUPABASE_SECRET_KEY` gaat de video naar `.data/media`. HQ streamt hem dan zelf.

## Publiceren

**Instagram** gaat via de officiële *Instagram API with Instagram Login*, voor een professioneel account (zakelijk of creator).
- **Stappen:**
  1. container maken (`media_type=REELS`, `video_url`, `cover_url`, caption);
  2. wachten tot de status `FINISHED` is;
  3. `media_publish`;
  4. permalink ophalen.
- **Rechten:** `instagram_business_basic` en `instagram_business_content_publish`.
- **Token:**
  - Het langlevende token (60 dagen) staat versleuteld in `hq.integrations` (AES-256-GCM met `HQ_ENCRYPTION_KEY`).
  - Cron ververst het token als het binnen 15 dagen verloopt.
  - Het token gaat nooit naar de browser.
- **Host en versie:** standaard `graph.instagram.com` en `v24.0`, instelbaar met `IG_GRAPH_BASE` en `IG_API_VERSION`. Ik kon de documentatie van Meta vanuit de bouwomgeving niet openen. Controleer de API-versie bij de eerste koppeling op developers.facebook.com.

**Dubbele posts voorkomen:**
- één actieve publicatie per stuk per kanaal (een unieke index in de database);
- één taak per poging;
- de container-id wordt opgeslagen vóór er gewacht of gepubliceerd wordt;
- vlak vóór `media_publish` gaat de status naar *onzeker*;
- na een time-out of crash controleert de volgende run eerst de container (`PUBLISHED`?) en de recente posts (zelfde caption), en pas daarna wordt er iets opnieuw geprobeerd;
- een gepubliceerde container wordt nooit opnieuw gepubliceerd.

Het externe post-ID en de permalink worden opgeslagen. Getest met een Instagram die de post verwerkt maar niet antwoordt, terwijl twee workers tegelijk draaien: precies één post.

**TikTok: export.**
- HQ zet de MP4, de cover en een kopieerbare caption klaar, met de geplande datum in de kalender en de werkvoorraad.
- Na het plaatsen tik je op "Ik heb dit geplaatst" en plak je eventueel de link.
- Waarom geen directe koppeling (stand november 2026, controleer bij een keuze):
  - De officiële *Content Posting API* van TikTok plaatst bij een app zonder audit alleen **privé** (`SELF_ONLY`), voor maximaal 5 gebruikers per dag.
  - Openbaar plaatsen vraagt een audit door TikTok. Inplannen zit niet in die API.
- Diensten die geplande TikTok-posts én aanlevering via een API vanuit HQ ondersteunen. Dit zijn bedragen uit vergelijkingen en prijspagina's; **niet** afgesloten:

| Dienst | Prijs (indicatie) | Voorwaarden om op te letten |
|---|---|---|
| Upload-Post | ongeveer $16/mnd jaarlijks of $24/mnd maandelijks; TikTok alleen op een betaald plan | API inbegrepen; jouw TikTok-account koppel je bij de dienst |
| Buffer | gratis plan met beperkte API; betaald ongeveer $5–6 per kanaal/mnd | bedoeld voor je eigen kanalen; volgens sommige bronnen is de API nog in bèta |
| Ayrshare | vanaf ongeveer $149/mnd | voor platforms met veel klantaccounts; te zwaar voor één account |

  Mijn advies: begin met export. Wil je TikTok automatisch, dan past Upload-Post of Buffer het best. Ik bouw die koppeling pas na jouw akkoord over prijs en voorwaarden.

## Herkomst en resultaten

- **Campagnelink:** `https://www.strakwerkk.nl/?utm_source=instagram&utm_medium=social&utm_campaign=<code>`, bijvoorbeeld `glow-saloneigenaren-1`. Zet die in je bio of story. Een bezoek met die code telt als **klik**.
- **WhatsApp-zoekwoord:** bijvoorbeeld `SALON`. Stuurt iemand dat woord, maak dan een lead aan met bron "Aanvraag via WhatsApp" en koppel hem bij **Campagne (herkomst)**. HQ vindt de video bij het zoekwoord. Pas dan telt het als **aanvraag**.
- **Geaccepteerde offerte:** een offerte die je zelf als geaccepteerd markeert, voor een lead die aan de video gekoppeld is.
- **Views en reach:** uit de Instagram-koppeling (dagelijks) of handmatig ingevoerd. Ontbreekt een meting, dan staat er *onbekend*.
- **Weekvoorstel:** kiest de hoek met het beste resultaat in de volgorde geaccepteerd → aanvragen → klikken → views. Het noemt altijd waar het op gebaseerd is en hoe weinig gegevens er zijn.

## Automatisering

- Je geeft zelf een **format** vrij (nu: Projectvideo) en **projectbeelden**.
- Per kanaal stel je in: aan/uit, een **weeklimiet** (0–7), dagen, tijd en doelgroep.
- Binnen die grenzen maakt HQ zelf afleveringen:
  1. Het kiest het project dat het langst geen video had en minstens 3 geldige, vrijgegeven beelden heeft.
  2. Het wisselt de hoeken af.
  3. Na het renderen keurt het automatisch goed en plant het in, op het eerstvolgende vrije slot dat minstens *min_hours_ahead* (standaard 24 uur) vooruit ligt. Je kunt dus altijd nog annuleren.
- Er is per week en slot een unieke sleutel, dus geen dubbele afleveringen, ook niet bij gelijktijdige cron-runs.
- **Pauzeknop:** stopt nieuwe afleveringen meteen.
- **Kostenplafond per maand:** taalmodelkosten (gemeten) plus rendertijd × instelbaar tarief. Bij het plafond stopt HQ met nieuwe afleveringen.
- **Kosten per video:** staan bij elk contentstuk.
- **Op tijd plaatsen:** Vercel Cron draait op het Hobby-plan één keer per dag. Laat daarom `/api/worker` elke 5 minuten aanroepen, met de header `Authorization: Bearer <CRON_SECRET>`. Dat kan met Vercel Pro (cron per minuut) of een externe planner zoals cron-job.org.

## Bekende grenzen

- TikTok wordt alleen geëxporteerd (zie hierboven).
- De Instagram-flow is getest tegen een nagebootste API en volgt de officiële stappen. De eerste echte koppeling moet je zelf met je account doen.
- Echte login en MFA via Supabase worden in de tests niet getest (zoals bij HQ zelf).
- Muziek zit er bewust niet in (licenties). Er is een stil audiospoor; voeg in de app eventueel een geluid uit hun eigen bibliotheek toe.
- Alleen portfolio-screenshots uit de repository zijn als beeld te gebruiken. Uploaden van nieuwe beelden staat in de backlog.

## Zelfstandig kantoor (november 2026)

StrakWerk is altijd de afzender. Een opgeleverd klantproject is optioneel portfoliomateriaal.

**Hoe het werkt**
- **Instellen, één keer:** in Contentstudio › Kantoor kies je doelgroep, doelen, kanalen, publicatiedagen en weeklimiet. De startinstelling is 3 video's per week (ma/wo/vr, 18:30).
- **Per kanaal kies je:**
  - *eerst beoordelen* of *automatisch publiceren*;
  - één publicatieroute: export, Buffer Free of Instagram API.
- **Onderwerpen voor StrakWerk zelf** (`BRAND_TOPICS`):
  - Wat kost een website laten maken?
  - Je websiteprijs in één minuut
  - Welk websitepakket past bij jou?

  Elk onderwerp heeft drie hoeken. Het materiaal is eigen: de schermopname van de echte configurator en schermafbeeldingen van pakketten en offerte (`brand/`, opnieuw opnemen met `npm run brand-assets`). De prijzen komen uit `CONFIG.bases`.
- **Taakverdeling:** AI schrijft alleen de teksten (onderwerpen, scripts, captions), binnen het centrale AI-budget. Gewone code doet:
  - planning;
  - montage (FFmpeg);
  - ondertitels (SRT uit het script);
  - opslag;
  - publicatie;
  - rapportage.

  Zonder bevestigd tegoed gebruikt HQ vaste voorbeeldteksten.
- **Tijd wijzigen:** een andere publicatietijd geeft geen nieuwe AI-aanroep en geen nieuwe render.

**Proef en bewijs**
- **Live publiceren staat standaard uit** (proefstand). HQ zet alles klaar ("Proef: klaar, niet live") en plaatst niets.
- **Bewijs:** `docs/hq/demo/`:
  - `strakwerk-wat-kost-een-website.mp4`, met cover, SRT en JSON;
  - `strakwerk-publicatiepreview.png`.

  Reproduceren met `npm run demo:strakwerk`.
- **Meer informatie:** kosten, gratis limieten en wat HQ doet bij een limiet staan in `docs/hq/kosten-en-limieten.md`.
