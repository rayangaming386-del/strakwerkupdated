# Privacy-beoordeling StrakWerk HQ en bezoekersmeting

Dit is een werkdocument, geen juridisch advies. Het beschrijft wat er technisch gebeurt, zodat de
privacyverklaring klopt. Er wordt niet beweerd dat het geheel "AVG-proof" is.

## Bezoekersmeting (`assets/sw-metrics.js` → `api/collect.js` → `hq.analytics_events`)

**Wat wordt opgeslagen per event:** eventnaam (vaste lijst), pad zonder querystring/fragment,
hostnaam van de verwijzer, utm_source/medium/campaign (opgeschoond; e-mailadressen en lange
cijferreeksen worden weggegooid), apparaatcategorie, servertijd, omgeving (productie/preview/test),
een willekeurig event-id (tegen dubbel tellen) en per event alleen toegestane velden
(`pakket`, `project`, `plek` uit vaste lijsten).

**Wat niet:** geen cookies, geen IP-adres, geen volledige URL, geen formulierinhoud, geen
WhatsApp-tekst, geen e-mailadressen, geen fingerprinting, geen sessie-opnames, geen profielen.

**Bezoekerscode:** `sha256(dagzout | IP | user-agent)`, afgekapt. Het dagzout staat alleen in de
database en wordt na 2 dagen gewist. Dit is pseudonimisering: zolang het zout bestaat, is de code
in theorie te herleiden door wie de database én het IP-adres heeft. Het blijft dus persoonsgegeven.

**Bewaartermijnen (`api/_lib/retention.js`, dagelijks via cron):** dagzout 2 dagen; bezoekerscode
31 dagen (daarna alleen dagtotalen in `hq.analytics_daily`); events 13 maanden; taakstappen 12 maanden.

**Toestemming:** de meting leest of schrijft niets op het apparaat behalve het optionele
uitzet-signaal (`localStorage: sw-meten`). Het verzenden van een meetbericht door een script kan
volgens de EDPB-richtsnoeren 2/2023 toch onder de cookieregel (art. 11.7a Telecommunicatiewet)
vallen. Voor analytics met weinig of geen gevolgen voor de privacy geldt in Nederland een
uitzondering op de toestemmingsplicht. De inrichting is daarop gericht (eigen gebruik, geen
delen, geen profielen, korte termijnen, opt-out, GPC/DNT gerespecteerd). **Eigen beoordeling van
de eigenaar nodig.** Wil je toch toestemming vragen: zet `data-sw-consent="required"` op `<html>`;
dan meet het script pas na `__swMetrics.optIn()` (een toestemmingsbanner moet dan nog worden gebouwd).

**Vercel Web Analytics** blijft zoals het was (al in de privacyverklaring). Dat is een tweede
verwerking; overweeg of beide nodig zijn.

**Beperkingen:** adblockers, GPC/DNT en opt-out zorgen voor ondertelling; verwijzers ontbreken vaak;
iPads tellen meestal als desktop; "actief" = gemeten activiteit in de laatste 5 minuten, niet "kijkt nu".
Een doorlopende conversietrechter wordt bewust niet getoond.

## CRM en agents

- Leads bevatten zakelijke gegevens; bij eenmanszaken zijn dat persoonsgegevens. Grondslag
  waarschijnlijk gerechtvaardigd belang; vastleggen in een eigen afweging.
- Scout/Auditor bekijken alleen de openbare homepage (+ robots.txt), als gewone bezoeker, met een
  herkenbare user-agent. Geen scans, geen formulieren.
- Met `ANTHROPIC_API_KEY` gaat paginatekst en metingen naar Anthropic (verwerker, VS). Zonder
  sleutel blijft alles binnen eigen systemen (behalve optioneel Google PageSpeed).
- Mail en WhatsApp voor verkoop (Telecommunicatiewet art. 11.7): alleen met voorafgaande
  toestemming (ook bij bedrijven), na eigen contact van de klant, of aan een bestaande klant voor
  eigen vergelijkbare diensten (alleen als die bij het geven van zijn gegevens berichten kon
  weigeren), met in elk bericht een afmeldmogelijkheid. HQ dwingt dit af per kanaal.
- Bellen voor verkoop (sinds 1 juli 2021): een eenmanszaak, vof of maatschap alleen met
  toestemming of als (oud-)klant; een rechtspersoon wel, met recht van bezwaar in elk gesprek. HQ
  legt daarvoor de rechtsvorm vast (naam, eigen site of KvK-register) en zet alleen toegestane
  bedrijven op de bellijst. Langsgaan: alleen bij echte potentie; bezwaar = nooit meer contact.
- Persoonlijke voorbeeldsites (`/voorbeeld/<code>`): alleen openbare gegevens, noindex, geheime
  link, duidelijk gemarkeerd als voorbeeld, telt bezoeken zonder cookies (eigenaar telt niet),
  verloopt na 45 dagen, offline bij bezwaar, verwijderd 60 dagen na verlopen.
- Gratis websitecheck: alleen publieke pagina's, uitslag achter geheime link (alleen hash
  opgeslagen), bezoekershash per dag (geen IP) na 2 dagen gewist, check zonder gegevens na 90
  dagen verwijderd. Gegevens achterlaten alleen met een vinkje voor contact (toestemming).
- Offertepagina: akkoord met naam en vinkje; bewijs = naam, tijdstip en IP-hash. Vinkje "liever
  geen berichten over andere diensten" voorkomt de grond "bestaande klant".
- Meldingen aan de eigenaar (e-mail): titel en korte tekst, nooit testgegevens, niet in stille uren.
- Verwijderen van een lead (eigenaar, met bevestiging) verwijdert ook taken, goedkeuringen, offertes
  en betalingen die eraan hangen. Controlelog blijft (bevat geen inhoud, alleen acties en id's).

## Dienstverleners

Cloudflare (hosting, Workers, e-mailroutering), Supabase (database, authenticatie), Google (Gmail
API voor e-mail; PageSpeed Insights), optioneel Anthropic (Claude API). Tot de overstap ook Vercel
(hosting, Web Analytics). Controleer per partij de verwerkersovereenkomst en doorgiftegrondslag
(Supabase-project in EU-regio kiezen).
