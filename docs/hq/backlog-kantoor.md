# Backlog: HQ als operationeel kantoor

Het gewenste traject: **aanvraag → offerte → akkoord → intake → websitecontrole → oplevering → contentcampagne → nazorg**.

Alles hangt aan dezelfde gegevens:
- `hq.leads`: de klant;
- `hq.quotes`: de offerte;
- `hq.projects`: het project, aangemaakt bij akkoord;
- `hq.content_pieces`: de campagnes;
- `hq.tasks`: de agents.

Prioriteit: P1 = volgende stap, P2 = daarna, P3 = later.

## Wat er nu al werkt
- Een geaccepteerde offerte maakt het klantproject aan (status *akkoord*, één per klant).
- Een project op *opgeleverd* met vrijgegeven beelden maakt één contentopdracht. De contentstudio doet de rest.
- Een lead kan aan een campagne worden gekoppeld (link, WhatsApp-zoekwoord of handmatig).

## Sales

| Prio | Onderdeel | Agent | Wat | Klaar als |
|---|---|---|---|---|
| P1 | Aanvraag snel vastleggen | – | Op je telefoon: "Nieuwe aanvraag" met bedrijf, kanaal (WhatsApp/mail/telefoon), zoekwoord en notitie. Het zoekwoord koppelt de campagne automatisch. | Een aanvraag staat in minder dan 30 s in het CRM, met de juiste herkomst. |
| P1 | Opvolgen | Sales | Elke ochtend leads met een verlopen vervolgdatum in **Aandacht nodig**, met een berichtconcept (de bestaande Sales-flow met goedkeuring). | Geen lead zonder vervolgactie ouder dan 3 dagen. |
| P2 | Offerte als PDF of link | – | Een goedgekeurde offerte als PDF of deelbare link, met dezelfde prijzen en voorwaarden als `hq.packages` en de calculator (`?cfg=`). | De klant kan online akkoord geven; het akkoord zet de offerte op *geaccepteerd*. |
| P2 | Scout voor doelgroepen van de campagne | Scout | Na een video voor "saloneigenaren": zelf ingevoerde salons onderzoeken (bestaande flow), geen scraping. | Leads met een bronlink en relevantie, nooit automatisch benaderd. |

## Klantintake

| Prio | Onderdeel | Agent | Wat | Klaar als |
|---|---|---|---|---|
| P1 | Intakeformulier per project | – | Een link voor de klant met huisstijl, teksten, foto's, openingstijden, domein en toestemming voor social media (per beeld). | Status *intake* wordt *in aanbouw* zodra alles binnen is; ontbrekende punten zijn zichtbaar. |
| P1 | Beelden uploaden | – | Foto's en logo van de klant in Supabase Storage, als projectbeeld met `social_ok` = toestemming van de klant. | Content kan nieuwe beelden gebruiken, niet alleen portfolio-screenshots. |
| P2 | Intake-samenvatting | Content | Een samenvatting en een sitemapvoorstel uit de intake, ter goedkeuring. | Rayan keurt goed of past aan; niets gaat naar de klant zonder goedkeuring. |

## Oplevercontrole (websitecontrole)

| Prio | Onderdeel | Agent | Wat | Klaar als |
|---|---|---|---|---|
| P1 | Automatische controle bij *websitecontrole* | Auditor | De bestaande Auditor-metingen (https, viewport, titels, H1, alt-teksten, structured data, PageSpeed) op `projects.live_url`, als checklist. | Rode punten blokkeren *opgeleverd*, tenzij Rayan ze bewust accepteert. |
| P2 | Mobiel- en linkcheck | Auditor | Screenshots op 360/390/768 px en een check op kapotte links (dezelfde aanpak als de tests van de site). | Screenshots per project in HQ, ook bruikbaar als contentbeeld na toestemming. |
| P2 | Formulier- en WhatsApp-test | Auditor | Een testaanvraag via het formulier van de klantsite in testmodus. | Het formulier werkt aantoonbaar vóór oplevering. |

## Nazorg

| Prio | Onderdeel | Agent | Wat | Klaar als |
|---|---|---|---|---|
| P1 | Nazorgritme | Care | Na oplevering taken na 1 week (vragen), 1 maand (meting en review vragen) en 3 maanden (onderhoud). | Taken staan in **Aandacht nodig**, met een berichtconcept ter goedkeuring. |
| P2 | Echte reviews verzamelen | Care | Na toestemming een reviewverzoek sturen; een ontvangen review handmatig vastleggen. | Pas met echte reviews: een review-sectie op de site (CLAUDE.md). |
| P2 | Beschikbaarheid bewaken | Care | Dagelijkse check: is de klantsite bereikbaar en verloopt het certificaat? | Een melding in **Aandacht nodig** bij storing. |
| P3 | Vervolgopdrachten | Sales | Bij signalen uit de nazorg (bijv. een webshopwens) een offerteconcept. | Alleen als voorstel; prijzen uit `hq.packages`. |

## Contentstudio (vervolg)

| Prio | Onderdeel | Wat |
|---|---|---|
| P1 | Externe planner voor `/api/worker` elke 5 min | Nodig om op tijd op Instagram te plaatsen (instelling, geen code). |
| P1 | Eerste echte Instagram-koppeling | Meta-app aanmaken, koppelen, één testpost; daarna API-versie en metrics-namen controleren. |
| P2 | TikTok via een publicatiedienst | Pas na jouw akkoord over prijs en voorwaarden (zie contentstudio.md). |
| P2 | Pushmelding bij "Actie nodig" | Bijv. Web Push of een WhatsApp-bericht aan jezelf. |
| P2 | Meer formats | Bijv. "Voor wie" (branche) en "Functie uitgelicht"; elk format vraagt zijn eigen vrijgave. |
| P3 | Muziek | Alleen rechtenvrij of uit de bibliotheek van de app zelf. |
