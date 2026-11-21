# Zelfstandig kantoor: kosten, gratis limieten en wat HQ doet bij een limiet

Doel: **€0 extra per maand.** AI alleen uit het maandelijkse API-tegoed van Claude Max.
Ik heb geen abonnement, proefabonnement of betaalde API afgesloten. Ik heb ook nergens automatisch opwaarderen of betaalde overschrijding aangezet.
De productiesite en de domeininstellingen zijn niet aangeraakt.

Stand: 21 november 2026. Prijzen en voorwaarden veranderen; de bronnen staan onderaan. Controleer ze voordat je iets koppelt.

## Per onderdeel

| Onderdeel | Keuze | Gratis limiet (indicatie) | Verborgen kosten / risico | Wat HQ doet bij de limiet |
|---|---|---|---|---|
| **Hosting site + HQ** | Vercel (bestaand) | Hobby: gratis; functies, cron 1×/dag | **Let op:** volgens de fair use policy van Vercel is Hobby alleen voor niet-commercieel gebruik. StrakWerk is commercieel. Ik heb niets verhuisd (opdracht: productie intact laten). Beslissing aan jou: Vercel Pro (betaald) of later een gratis host die commercieel gebruik toestaat. | Hobby kan niet bijbetalen: bij een limiet pauzeert Vercel de functie in plaats van een rekening te sturen. |
| **Database** | Supabase Free | 500 MB database, 2 actieve projecten | Pauzeert na 7 dagen zonder activiteit. De 5-minuten-planner hieronder houdt het project actief. | HQ toont "Database niet bereikbaar"; niets gaat verloren. |
| **Video-opslag** | Supabase Storage (privé-bucket `hq-media`) | 1 GB opslag, 5 GB dataverkeer per maand | Een video is ongeveer 5 MB. 12 video's per maand is ongeveer 60 MB opslag. Ophalen door Buffer of Instagram plus jouw previews kost een paar honderd MB verkeer. | Bij vol: uploaden mislukt en de render blijft "mislukt" met de reden erbij. Ruim oude renders op of archiveer. |
| **Geplande taken** | Supabase `pg_cron` + `pg_net` roepen `/api/worker` elke 5 minuten aan (gratis, zie installatie) | Ruim binnen de functielimieten van Vercel Hobby | Geen extra account nodig. Alternatief: cron-job.org (gratis). | Zonder planner: alleen de dagelijkse cron van Vercel draait; publiceren gebeurt dan hooguit één keer per dag. |
| **Renderen (MP4)** | GitHub Actions (`hq-render.yml`), start alleen als er een render klaarstaat | Openbare repo: onbeperkt. Privé repo (Free): 2000 minuten per maand. Bestedingslimiet staat standaard op $0. | Ongeveer 3 minuten per render (installeren plus renderen). Bij 3 video's per week is dat ongeveer 40 minuten per maand. Een lege controle kost minder dan 1 minuut; die draait 2× per dag. | Minuten op: de render blijft **in de wachtrij** (niets gaat verloren). Na 45 minuten zegt HQ: "start de render-worker op je computer" (`npm run render-worker`). |
| **Publiceren TikTok + Instagram** | **Buffer Free** (eerste keus), één route per kanaal | 3 kanalen, **10 geplande posts per kanaal** tegelijk | API op alle plannen (volgens recente bronnen; Buffer noemt hem deels nog bèta). TikTok vraagt een TikTok Business-profiel. | Wachtrij vol: post blijft bewaard (**"Wachtrij vol: HQ probeert later"**) en gaat over 3 uur opnieuw. Er komt geen dubbele post. |
| **Instagram (alternatief)** | Officiële Instagram API (bestaande koppeling) | Gratis, ongeveer 50 posts per 24 uur | Vraagt een Meta-app; in ontwikkelmodus alleen voor je eigen account. | Kies per kanaal één route; HQ gebruikt nooit twee routes tegelijk. |
| **AI (Claude)** | Maandelijks API-tegoed van Claude Max (Max 5x: $100, Max 20x: $200 per periode) | Jouw HQ-limiet, bijvoorbeeld $80 van $100 | Anthropic rekent geen overschrijding af: bij een leeg tegoed stopt de API. HQ reserveert vooraf en stopt eerder. | AI-taken **pauzeren** (bewaard), video's die al klaar zijn publiceren door. Hervatten = dezelfde taak, geen dubbele uitvoer. |
| **E-mail** | Supabase Auth-mails (alleen uitnodigen en wachtwoord) | Laag aantal mails per uur | Geen marketingmail. | Uitnodiging later opnieuw versturen. |
| **Analytics** | Eigen meting (bestaand) + Vercel Web Analytics | Hobby: 1 maand historie | – | – |

## Wat vanzelf draait terwijl je laptop uitstaat

Dit draait zonder je laptop, zodra de koppelingen hieronder actief zijn:
- elke 5 minuten de **planner** (Supabase `pg_cron` roept `/api/worker` aan):
  - het kantoor plant komende video's;
  - de serverloze worker maakt scripts (AI of voorbeelddata), captions en planningen;
  - wachtende AI-taken hervatten als er weer budget is;
  - Buffer- en Instagram-posts worden aangeleverd en gecontroleerd;
- **renders** in GitHub Actions: gestart door HQ, plus een vangnet 2× per dag;
- het **Instagram-token** ververst automatisch en de **resultaten** worden dagelijks opgehaald.

Jouw rol:
- Je krijgt alleen een melding (Aandacht nodig) als jouw actie nodig is: beoordelen, zelf plaatsen bij export, budget, een mislukte stap of een render die lang wacht.
- Je laptop is alleen nodig als terugvaloptie: `npm run render-worker -- --watch` als de gratis Actions-minuten op zijn.

## Eenmalig te koppelen (accounts van StrakWerk)

1. **Supabase:** project en sleutels (al beschreven in `installatie.md` stap 1–4), plus de 5-minuten-planner (stap 6).
2. **GitHub Actions-secrets:** `HQ_DATABASE_URL`, `HQ_SUPABASE_URL` en `HQ_SUPABASE_SECRET_KEY`. Optioneel in Vercel: `GITHUB_RENDER_TOKEN` en `GITHUB_RENDER_REPO`.
3. **Buffer Free:**
   1. Verbind Instagram (professioneel account) en TikTok (Business) in Buffer.
   2. Maak een API-sleutel aan (Buffer › Settings › API) en zet die als `BUFFER_API_KEY` in Vercel.
   3. Haal in HQ (Contentstudio › Kantoor) de kanalen op en kies per kanaal "Buffer".
4. **Claude API-tegoed:**
   1. Koppel in claude.ai (instellingen › API-tegoed) je Console-organisatie.
   2. Maak in die organisatie een API-sleutel aan en zet die als `ANTHROPIC_API_KEY` in Vercel.
   3. Vul in HQ de periode, het toegekende tegoed en je HQ-limiet in, vink "tegoed gezien" aan en zet AI aan.
5. **Live publiceren:** pas aanzetten (Kantoor › Live publiceren) als 3 en 4 werken. Tot die tijd maakt HQ alles klaar als concept ("Proef: klaar, niet live").

## Wat echt getest is en wat pas na koppelen kan

**Getest** (lokaal, Postgres 16, echte ffmpeg en Chromium; 35 van de 35 tests):
- een maand kantoor-ticks: nooit meer dan 3 per week, ook bij gelijktijdige runs, zonder klantproject;
- de StrakWerk-video "Wat kost een website laten maken?":
  - MP4 1080×1920, 19,8 s;
  - de echte configurator als eigen schermopname en de prijzen uit `index.html`;
  - captions en ondertitels (SRT);
- een lege AI-portemonnee:
  - pauze zonder aanroep;
  - "onvoldoende tegoed" van de API: pauze, geen kosten;
  - hervatten met dezelfde taak;
- gelijktijdige reserveringen: samen nooit boven de limiet;
- de publicatietijd wijzigen: geen AI-aanroep, geen render;
- de proefstand: niets naar Buffer;
- een volle Buffer-wachtrij: bewaren en later opnieuw;
- een onduidelijke uitkomst bij Buffer: hervatten zonder dubbele post; "gepubliceerd" pas na bevestiging door Buffer;
- de mobiele schermen (iPhone 13 en desktop): geen fouten, niets buiten beeld.

**Niet getest** (nagebootst in tests; pas te bevestigen na jouw koppeling):
- de echte Buffer-API. Ik kon de documentatie van Buffer vanuit de bouwomgeving niet openen; de veldnamen komen uit de officiële voorbeelden zoals zoekresultaten die tonen. Controleer met "Kanalen ophalen uit Buffer" en één proefpost.
- de echte Claude API, Supabase Storage en de GitHub Actions-run;
- Supabase `pg_cron`;
- het commerciële-gebruikpunt bij Vercel Hobby.

## Bronnen
- Buffer API: [Posts & Scheduling](https://developers.buffer.com/guides/posts-and-scheduling.html), [Create Video Post](https://developers.buffer.com/examples/create-video-post.html), [REST-migratie](https://developers.buffer.com/guides/rest-migration.html)
- Buffer Free: [prijzen](https://buffer.com/pricing), [functies per plan](https://support.buffer.com/article/595-features-available-on-each-buffer-plan)
- Vercel: [fair use policy](https://vercel.com/docs/limits/fair-use-policy), [cron jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- Supabase: [prijzen](https://supabase.com/docs/pricing), [billing FAQ](https://supabase.com/docs/guides/platform/billing-faq)
- Claude Max API-tegoed: [Claude Help Center](https://support.claude.com/articles/15036540)
