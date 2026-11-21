# Klanten winnen: hoe het kantoor werkt

Alles draait binnen de bestaande HQ-inlog en de bestaande Vercel-functies. Er komt één publieke functie bij (`api/public.js`), dus 5 van de 12 functies op Hobby zijn in gebruik. Extra kosten: €0. AI is optioneel; zonder AI draait alles op gewone code.

## Schermen (mobiel eerst)
- **/hq/vandaag**: het startscherm. Je ziet wie op antwoord wacht, berichten die je zelf moet versturen (kopiëren + WhatsApp/mail-link), offertes die aandacht vragen, keuzes voor jou, actieve projecten met capaciteit en het ochtendoverleg met acties. Bovenaan staat een opdrachtveld in gewone taal en een pauzeknop. Met "Echt / Test & demo" wissel je tussen echte gegevens en testgegevens.
- **/hq/klanten**: per klant één kaart met behoefte, antwoordconcept, offerte, project, contactgronden, afspraken, observaties, websitestatus en de hele geschiedenis.
- **/hq/kantoor**: overleg, scorekaarten, routes & fouten, Scout, experimenten, partners, resultaten en instellingen.
- **/intake?t=…**: de persoonlijke intake-link voor een klant, zonder account en alleen voor dat ene project.

## Het traject
1. **Aanvraag**: via het formulier op de site (`/api/public/aanvraag`, naast WhatsApp/mail), plakken in HQ of het opdrachtveld. Dubbele inzendingen geven één kaart. Herkomst komt uit de campagnelink (utm_campaign), het WhatsApp-zoekwoord of een partnercode (`?ref=`). Zonder spoor blijft de herkomst "onbekend".
2. **Sales**: herkent de behoefte, ziet wat ontbreekt en zet een antwoord klaar in jouw stijl, met prijzen uit `CONFIG`. Het offerteconcept komt uit de prijslijst. Extra wensen moeten eerst beoordeeld worden. Versturen en akkoord doe alleen jij (rol eigenaar). Bij getoonde interesse plant HQ maximaal 2 opvolgingen (na 3 en 7 dagen). Elke reactie stopt die opvolgingen.
3. **Akkoord → project**: het project krijgt de afgesproken inhoud en prijs, plus een intake-link. Is de intake compleet, dan komt er een bouwbriefing voor Claude. Feedback die buiten de afspraken valt, wordt een voorstel met meerprijs. Een opleverkandidaat gaat eerst langs de Auditor.
4. **Opgeleverd**: na 14 dagen een nazorgbericht. Een reviewverzoek staat als concept klaar; jij verstuurt het, en er is geen beloning tenzij je daar een regel voor instelt.
5. **Betaling**: echt vastleggen (bank/contant). Een simulatie kan alleen bij testgegevens.

## Route B: zelf bedrijven vinden
- **Scout** zoekt via OpenStreetMap (gratis, open data). Per bedrijf legt hij vast:
  - de bron en de datum;
  - de websitestatus: gevonden, alleen sociaal profiel, onzeker, of "geen eigen website gevonden na deze controles". Elke controle staat zichtbaar op de kaart;
  - of het bedrijf actief lijkt;
  - de prioriteit;
  - of het bedrijf al in HQ staat.
  Segmenten zijn werkhypotheses die je aan en uit kunt zetten.
- **Auditor** bekijkt de site zoals een klant op een telefoon dat doet: diensten, afspraak, prijs, contact. Elke observatie krijgt de exacte pagina, het bewijs (bijvoorbeeld HTTP 404) en één passende dienst. Een oud uiterlijk telt alleen als zwak signaal. Jij markeert een observatie als "klopt" of "klopt niet"; dat telt mee in de scorekaart.
- **Acquisitie** beoordeelt twee dingen apart:
  - Past het bedrijf bij StrakWerk?
  - Mogen we het via dit kanaal benaderen? Daarvoor kijkt HQ naar de contactgrond (met bron, datum, reikwijdte en onderbouwing), afmeldingen, de frequentie en de route.

  Een openbaar e-mailadres alleen is geen contactgrond. Zonder contactgrond wordt er niets verstuurd: het onderzoek blijft bewaard en het probleem gaat anoniem als input naar Marketing.

  De mail zelf bevat één observatie, één suggestie en één vraag, met een duidelijke afzender en een afmeldlink (ook als one-click-header). Vlak voor elke verzending controleert HQ alles opnieuw: is er gereageerd, wat is de offertestatus, is de klant afgemeld, staat de route op pauze, is de daglimiet bereikt.

## Route A: marketing
Het ochtendoverleg zet terugkerende problemen per doelgroep als marketingactie neer, bijvoorbeeld "video voor salons zonder eigen website". In de Contentstudio maak je daar een video van met een campagnelink. Aanvragen via die link worden herleid tot in de resultaten.

## Ochtendoverleg en scorekaarten
- **Overleg**: elke dag om 08:30 Nederlandse tijd (instelbaar). Het overleg bevat:
  - de cijfers van gisteren;
  - wie er wacht;
  - waar het vastloopt, met bewijs;
  - maximaal 5 acties met reden, bijdrage, afdeling en volgende stap;
  - wat er met de vorige acties is gebeurd.

  Warme aanvragen gaan altijd voor. Is de capaciteit vol, dan schuiven acquisitie en marketing naar achteren. De cijfers komen uit gewone code. Alleen met bevestigd AI-tegoed komt er één AI-samenvatting bij.
- **Scorekaarten**: altijd aantallen naast percentages. Punten zijn er alleen voor uitkomsten, nooit voor volume.
- **Eigen fouten**: een fout verlaagt de score van de afdeling en maakt een correctietaak aan. Bij een bericht dat na een afmelding toch verstuurd is, of bij een dubbele verzending, gaat de e-mailroute op pauze. De route gaat pas weer open als jij "hersteld" kiest en de zelftest slaagt.
- **Experimenten**: per afdeling loopt maar één wijziging tegelijk. Wat succes is, leg je vooraf vast. Bij weinig gegevens toont HQ "nog onvoldoende bewijs". Promptversies kun je terugzetten.

## Wat vanzelf draait (cron via `/api/worker`)
- Geplande berichten die aan de beurt zijn, krijgen een verzendtaak.
- Controle op eigen fouten.
- Het ochtendoverleg.
- Herinneringen voor een intake (klaargezet; jij verstuurt ze, maximaal 2).
- Elke dinsdag een Scout-ronde, alleen als je die aanzet.
- Elke maandag voorstellen voor conversie en vindbaarheid uit echte bezoekersgegevens.

Met de pauzeknop stopt alles behalve de controle op eigen fouten.

## Standaard uit (jij activeert)
| Wat | Hoe aanzetten |
|---|---|
| E-mail automatisch inplannen | Kantoor › Routes: "Automatisch aan" (eerst bevestigen dat je de voorwaarden van je mailprovider hebt gecontroleerd) |
| E-mail echt versturen | SMTP instellen (hieronder) én "Live aan". Zonder deze twee komt alles in proefstand ("TEST") |
| Wekelijkse Scout-ronde | Kantoor › Instellingen |
| AI-samenvatting overleg | AI-budget bevestigen (Contentstudio › AI-budget) |

## Koppelingen (allemaal gratis)
Zet de waarden in Vercel › Settings › Environment Variables, nooit in Git of in de chat.
- **E-mail versturen**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, en eventueel `MAIL_FROM`. Bij Gmail is dat smtp.gmail.com, poort 465, met een app-wachtwoord. Controleer de limieten en voorwaarden van je provider.
- **Reacties automatisch binnen**: `HQ_INBOUND_SECRET`. Stuur binnenkomende mail door naar `POST /api/public/inbound` met de header `x-hq-inbound-secret` en JSON `{from, subject, text, in_reply_to, message_id}`. Dat kan bijvoorbeeld met een gratis Cloudflare Email Worker op een eigen domein. Zonder deze koppeling plak je reacties zelf in de klantkaart; HQ classificeert ze dan net zo.
- **OpenStreetMap**: heeft geen sleutel nodig. Optioneel kun je met `OVERPASS_URL` een andere server kiezen.

WhatsApp en telefoon hebben geen gratis automatische route. Daarvoor zet HQ altijd een kopieerknop en een link klaar.

## Demo en tests
- `npm run demo:klanten` (lokale database) doorloopt scenario A, B en C met testgegevens en sluit af met het overleg van de volgende ochtend. Schermafbeeldingen staan in `docs/hq/demo/klanten/`.
- `tests/klant.test.mjs` test:
  - de scenario's A, B en C;
  - een dubbele aanvraag;
  - een reactie tijdens een geplande opvolging;
  - afmelden;
  - een eigen fout met pauze en herstel;
  - een ontbrekende koppeling;
  - een overleg zonder AI-tegoed;
  - hervatten na een fout;
  - het opdrachtveld.
