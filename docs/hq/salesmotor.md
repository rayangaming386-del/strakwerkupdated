# Salesmotor: elke dag dichter bij een verkochte website

Doel: zo veel mogelijk echte, betalende klanten, met het meeste AI-tegoed op winnen en overtuigen.
Alles hieronder draait in HQ (`/hq`). Versturen, geld en beslissingen blijven altijd bij Rayan.

## Een werkdag

1. **Ochtend** (na het ochtendoverleg, alleen op werkdagen uit je beschikbaarheid): HQ zet een
   **bel- en bezoeklijst** klaar onder Vandaag (standaard 5 + 5, instelbaar). Per bedrijf een
   belcoach of bezoekcoach: opening, aanleiding met bewijs, drie vragen, het voorstel met de prijs
   uit de prijslijst, antwoorden op bezwaren, de afsluiter en het recht van bezwaar.
2. **Na elk gesprek of bezoek** één tik op de uitkomst. Zei iemand ja op "Mag ik je een voorbeeld
   appen of mailen?", vink dat aan: de toestemming wordt vastgelegd (met datum en bron).
3. **Voorbeeldsite**: met één knop een persoonlijk voorbeeld van de nieuwe site (`/voorbeeld/<code>`),
   alleen met openbare gegevens. Opent de klant hem, dan krijg je meteen een melding ("dit is het
   beste moment om te bellen").
4. **Bericht na het gesprek**: HQ schrijft een kort persoonlijk bericht met de voorbeeldsite en het
   voorstel (prijs uit CONFIG). WhatsApp verstuur je zelf met de knop, e-mail met één klik vanuit HQ.
   Na 7 dagen staat een opvolging voor je klaar; reageert de klant, dan vervalt die.
5. **Offerte**: de klant krijgt een link naar `/offerte`, ziet wat hij krijgt, geeft online akkoord
   (naam + vinkje) en ziet de aanbetaling (standaard 50%, met je IBAN) en de intake-link.
6. **Meldingen** (Vandaag, en per e-mail binnen 5 minuten, behalve in je stille uren): nieuwe
   aanvraag, offerte bekeken, akkoord, voorbeeldsite geopend, reactie met interesse, verwijzing.

## Waar komen klanten vandaan

| Route | Hoe | Wat Rayan doet |
|---|---|---|
| Gratis websitecheck | `/websitecheck` (ook vanaf het homepageblok "Gratis check") | Bellen of appen: de bezoeker gaf met een vinkje toestemming |
| Aanvraag via de site | Formulier → klantkaart met antwoordconcept | Snel antwoorden (wint opdrachten) |
| Bellen | Alleen bv, nv, stichting, vereniging, coöperatie, of met toestemming, of een klant | Belcoach volgen, uitkomst tikken |
| Langsgaan | Eenmanszaak of vof met echte potentie (geen site of bewezen probleem, actief, adres bekend), of na een positief gesprek | Bezoekcoach volgen, toestemming vragen voor een bericht |
| Bestaande klanten | Kantoor › Instellingen › Bestaande klanten | Review, verwijslink of onderhoud klaarzetten en versturen |
| Video's en partners | Contentstudio en partnerlinks | Zie de eigen documenten |

## Regels die HQ afdwingt (Telecommunicatiewet, AVG)

- **Mail en WhatsApp** voor verkoop alleen met toestemming, als de klant zelf contact zocht, of
  aan een bestaande klant (eigen, vergelijkbare diensten, en alleen als hij bij het geven van zijn
  gegevens de kans kreeg om berichten te weigeren). Elk bericht zegt hoe je je afmeldt: e-mail met
  een afmeldlink, WhatsApp met "stuur 'stop'". "Stop" als antwoord telt als afmelding.
- **Bellen** voor verkoop sinds 1 juli 2021: een eenmanszaak, vof of maatschap is een natuurlijk
  persoon en bel je alleen met toestemming of als klant (ook binnen drie jaar na het einde van de
  klantrelatie). Een rechtspersoon mag je bellen, met in elk gesprek de mogelijkheid om bezwaar te
  maken (staat in de belcoach). Bel met een zichtbaar nummer. Openbare gegevens (website, KvK,
  Google) zijn geen toestemming.
- **Rechtsvorm**: Scout herkent hem alleen bij een sterk signaal (de rechtsvorm in de naam, of de
  eigen naam met "B.V." op de eigen site). Anders "onbekend" = niet bellen, tot je hem op de
  klantkaart vastlegt na controle in het KvK-register (gratis zoeken op kvk.nl).
- **Terugbellen afgesproken** = toestemming voor dat telefoontje (wordt vastgelegd).
- **"Niet meer benaderen"** geldt voor alle kanalen, voor altijd, en zet de voorbeeldsite offline.
- **Reviews**: nooit met een beloning (regels van Google). Verwijzingen mogen wel een beloning
  hebben, maar alleen als je die zelf instelt.
- **Geen verzonnen claims**: AI-teksten voor klanten gaan door een controle (geen cijfers, prijzen,
  reviews, garanties, "beste", links). Afgekeurde tekst valt terug op een vaste, eerlijke tekst.
  Prijzen komen altijd uit CONFIG.

## AI-tegoed: het geld volgt betalende klanten

- Drie soorten werk: **overtuigen** (voorbeeldsite, bericht na het gesprek: het beste model),
  **werk** (belcoach, offertes) en **snel** (samenvatting van de websitecheck: het goedkoopste model).
- Budget per post binnen je HQ-limiet: voorbeeldsite 25%, acquisitie 20%, websitecheck 20%, sales
  15%, controle 5%, overig 15%. Is een post op, dan pauzeren alleen die taken tot de volgende periode.
- Vanaf 3 betaalde klanten in 90 dagen schuift de verdeling (voor websitecheck, voorbeeldsite en
  acquisitie) naar de route die echt klanten opleverde. Zie Kantoor › Instellingen › AI-budget per post.
- Zonder bevestigd tegoed of met AI uit werkt alles met vaste teksten.

## Instellingen (Kantoor › Instellingen › Verkoop)

IBAN en tenaamstelling (offertepagina), aanbetaling en geldigheid, e-mailadres voor meldingen
(niet het afzendadres: mail aan jezelf geeft vaak geen pushmelding), Google-reviewlink, beloning
voor een verwijzing, belafspraken/bezoeken/websitechecks per dag.

## Gratis websitecheck (`/websitecheck`)

Controleert bereikbaarheid, https, mobiel, bellen/appen, werkende knoppen (zoals een klant ze
volgt), titel en omschrijving, hoofdkop en alt-teksten. Advies alleen bij echte problemen (pakket
Redesign; Afspraken plannen bij een kapotte afspraakroute), met prijzen uit CONFIG. Tegen misbruik:
dagmaximum, 5 per bezoeker per dag (wisselende hash, geen IP-adres), honeypot, herkomstcontrole,
recente uitslag van hetzelfde domein hergebruikt. Gebruik en aanvragen staan in Kantoor.

## Bewaren

Websitecheck zonder gegevens: 90 dagen (bezoekershash 2 dagen). Voorbeeldsite: verloopt na 45
dagen, verwijderd 60 dagen later. Zie ook `docs/hq/privacy.md` en `/privacy`.

## Techniek

Migraties 006 (salesmotor), 007 (rechtsvorm) en 008 (berichtsoorten voor bestaande klanten).
Code: `api/_lib/klant/calls.js` (lijst, uitkomst, berichten), `preview.js`, `sitecheck.js`,
`clients.js`, `legalform.js`, `notify.js`, `quote-public.js`, `claims.js`; schermen in
`hq/assets/views/sales-ui.js`. Tests: `tests/sales.test.mjs`, `tests/legalform.test.mjs`.
