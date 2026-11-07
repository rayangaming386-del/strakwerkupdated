# SEO-update 7 november 2026: wijzigingen

De nulmeting staat in `nulmeting-2026-11-07.md` en de meetafspraken in `meting.md`. De map `docs/` wordt niet gepubliceerd (`.vercelignore`).

## 1. Technisch

| Wat | Voor | Na |
|---|---|---|
| Interne notities | `/CLAUDE.md` en `/assets/work/LEESMIJ.txt` openbaar (200) | Niet meer gepubliceerd via `.vercelignore`, net als `docs/` |
| Apex-domein | `strakwerkk.nl` → www met **307** (Vercel-domeininstelling) | **Actie voor Rayan:** in Vercel op 308 zetten (zie onderaan). Als vangnet staat in `vercel.json` een permanente redirect op host `strakwerkk.nl`. |
| Oude adressen | `/service-*` → `/#prijzen` of `/#features` | `/service-starter`, `/service-pro`, `/service-onderhoud` → `/prijzen`; `/service-ecom` → `/diensten/webshop-laten-maken`; `/service-boost` → `/diensten` (allemaal 308) |
| Sitemap | 26 URL's, `changefreq`/`priority`, lastmod alleen bij artikelen | 28 canonieke URL's (200, indexeerbaar), lastmod uit git/wijzigingsdatum, geen `changefreq`/`priority` |
| Canonicals | `privacy` zonder canonical | Elke indexeerbare pagina heeft een canonical die gelijk is aan de sitemap-URL (gecontroleerd door het sitemapscript) |
| Koppen | `demo` zonder h1 | h1 "Demo beheerpaneel" |
| Menu | Ankers (`#werk`) | Echte links (`/werk`, `/diensten`, `/prijzen`, `/over-mij`, `/contact`). Op de homepage scrollen ze nog steeds vloeiend naar de sectie. |

## 2. Pagina's en URL's

**Nieuw:**

| URL | Doel |
|---|---|
| `/diensten` | Overzicht van alle diensten, branches en regio's. Is ook de tussenlaag in het kruimelpad. |
| `/werk` | Overzicht van de drie projecten, met branche, plaats, functies en live-link |
| `/prijzen` | Alle pakketten en opties met prijs, rechtstreeks uit `CONFIG`, plus vragen over de prijs |
| `/over-mij` | Wie er achter StrakWerk zit, de werkwijze en wat je kunt verwachten (alleen bestaande, geverifieerde tekst) |
| `/contact` | WhatsApp, telefoon, e-mail, een formulier (via WhatsApp of e-mail) en de vestigingsplaats |

**Samengevoegd (308):**

| Oude URL | Gaat naar | Waarom |
|---|---|---|
| `/diensten/website-laten-maken-zoetermeer` | `/` | Zoetermeer is de vestigingsplaats. De homepage is nu de Zoetermeer-pagina, zodat er geen dubbele pagina's zijn. |
| `/diensten/website-laten-maken-delft` | `/diensten/website-laten-maken` | Geen lokaal project of vestiging. De pagina was bijna gelijk aan de andere stadspagina's (doorway-risico) en zei ten onrechte "StrakWerk zit in Den Haag". |
| `/diensten/website-laten-maken-westland` | `/diensten/website-laten-maken` | Zelfde reden |

**Behouden en gecorrigeerd:**

- `/diensten/website-laten-maken-den-haag`: VAGPRO en De Tak zitten echt in Den Haag. Deze pagina toont nu beide projecten en noemt Zoetermeer als vestigingsplaats.
- `/diensten/website-laten-maken-rijswijk`: CarTronic zit echt in Rijswijk.

**Projectpagina's:**

- Nieuwe titels, omschrijvingen die niet meer halverwege worden afgekapt, en een kruimelpad StrakWerk / Werk / project.
- Een blok "Diensten in dit project" en BreadcrumbList-markup.

**Alle subpagina's:**

- Hetzelfde hoofdmenu (op mobiel een uitklapmenu).
- Een uitgebreide footer met diensten, projecten, regio, prijzen, over mij, contact en kennisbank.
- Een kruimelpad met tussenlaag (Diensten of Werk).

## 3. Lokaal en bedrijfsgegevens

- **Vestigingsplaats Zoetermeer** staat nu op deze plekken:
  - homepage: titel, omschrijving, introtekst, Over mij, contact en footer (klok "Zoetermeer")
  - Over mij, Contact, Diensten
  - structured data: `address` met addressLocality Zoetermeer, addressRegion Zuid-Holland, addressCountry NL
  - De straat en postcode zijn bewust leeg gelaten: die zijn niet gegeven en een thuisadres hoort niet openbaar zonder akkoord.
- **Werkgebied ongewijzigd** (Zoetermeer, Den Haag, Rijswijk, Delft, Westland en de rest van Nederland op afstand). Er is geen servicegebied aangepast op basis van aannames.
- **Organisatie-markup:**
  - één `@id` (`https://www.strakwerkk.nl/#organisatie`) waar dienstpagina's en artikelen naar verwijzen
  - `alternateName` "StrakWerk Webdesign"
  - WebSite-markup met dezelfde uitgever
  - Prijzen in `hasOfferCatalog` verwijzen naar `/prijzen`.
- **Geen review- of beoordelingsmarkup.** Er zijn nog geen echte reviews.
- **FAQPage-markup op homepage en dienstpagina's bewust laten staan.** Google toont FAQ-resultaten niet meer, maar zegt zelf dat de markup geen kwaad doet. Andere diensten kunnen hem nog gebruiken, en hij komt overeen met de zichtbare vragen.

## 4. Titels en omschrijvingen (belangrijkste)

| Pagina | Titel na de update |
|---|---|
| `/` | StrakWerk \| Webdesign uit Zoetermeer, websites vanaf €200 |
| `/diensten` | Diensten: websites, redesigns en webshops \| StrakWerk |
| `/werk` | Werk: websites gebouwd door StrakWerk |
| `/prijzen` | Prijzen: websites vanaf €200, vaste prijzen \| StrakWerk |
| `/over-mij` | Over mij: Rayan van StrakWerk \| Webdesign uit Zoetermeer |
| `/contact` | Contact \| StrakWerk, webdesign uit Zoetermeer |
| `/werk/vagpro` | VAGPRO: website met kentekencheck \| StrakWerk |
| `/werk/detak` | Sleepdienst De Tak: website in drie talen \| StrakWerk |
| `/werk/cartronic` | CarTronic: webshop met voertuigzoeker \| StrakWerk |

Omschrijving van de homepage (182 → 148 tekens): "StrakWerk is een webdesignbedrijf uit Zoetermeer. Websites op maat vanaf €200 en redesigns vanaf €175, voor heel Nederland. Bereken direct je prijs."

## 5. Zoekwoorden per pagina (zonder volumes)

Er zijn geen zoekvolumes gebruikt, omdat er geen betrouwbare bron beschikbaar was. De koppeling is gebaseerd op zoekintentie en is een inschatting.

| Onderwerp / zoekintentie | Pagina | Opmerking |
|---|---|---|
| strakwerk, strakwerk webdesign, strakwerkk | `/` | Merk. Let op: er bestaat ook een stukadoor "SK StrakWerk". |
| webdesign Zoetermeer, website laten maken Zoetermeer, webdesigner Zoetermeer | `/` | Plus het Google Bedrijfsprofiel. Het lokale pakket weegt hier waarschijnlijk zwaar (inschatting). |
| website laten maken (algemeen, prijs) | `/diensten/website-laten-maken` | Commercieel |
| wat kost een website | `/kennisbank/wat-kost-een-website` | Informatief, linkt door naar `/prijzen` |
| prijzen / pakketten StrakWerk | `/prijzen` | |
| website laten vernieuwen, website redesign | `/diensten/website-redesign` | Informatief: `/kennisbank/website-toe-aan-redesign` |
| webshop laten maken | `/diensten/webshop-laten-maken` | Bewijs: CarTronic |
| website garage / autobedrijf | `/diensten/website-garage` | Bewijs: VAGPRO, CarTronic |
| website sleepdienst | `/diensten/website-sleepdienst` | Bewijs: De Tak |
| website kapper, horeca, bouw | Bijbehorende branchepagina | Nog geen project als bewijs. Sterker maken zodra er een klant in die branche is. |
| website laten maken Den Haag / Rijswijk | Stadspagina's | Alleen waar echte projecten zitten |

## 6. Snelheid (homepage, mobiel, lab)

Gemeten met Lighthouse 12.8.2 op een lokale server. De versies voor en na zijn afwisselend gemeten onder dezelfde omstandigheden, 4 runs per versie.

| | Voor | Na |
|---|---|---|
| Prestaties (mediaan) | 87 (81–91) | 92 (81–95) |
| Total Blocking Time | 369 ms | 182 ms |
| LCP-element | decoratieve wandtegel | introtekst (de echte inhoud) |
| Desktop | 100 | 100 |

Met echte vertraging (4x CPU en trage 4G via Chrome) bleven FCP en LCP gelijk (~0,9 s en ~1,2 s), en de laadtijd daalde van 3,2 naar 2,9 s.

Wat er is veranderd:

- **Scripts:** de bibliotheken laden met `defer` en het hoofdscript start na het inlezen van de pagina.
- **Hero op telefoons en tablets:** de inhoud wordt niet meer verborgen en opnieuw ingeschoven. Dat gaf een zichtbare flits.
- **Actielabel:** het staat vanaf de eerste weergave goed ("Actie" in plaats van eerst "Nieuw").
- **Achtergrondwand op telefoons:** kleinere afbeeldingen (360px- en nieuwe 150px-varianten) en tegels van 180px breed.
- **Videoposter:** wordt pas geladen als de video in de buurt komt, en op mobiel (waar de video verborgen is) helemaal niet.

Let op:

- Dit zijn **labcijfers**. Velddata van echte bezoekers was niet beschikbaar (de PageSpeed-API gaf een quotumfout). Of de Core Web Vitals in het veld goed zijn, is dus niet bekend.
- Het gesimuleerde mobiele LCP blijft rond de 3 s. Dat komt doordat de decoratieve wand veel kleine afbeeldingen tegelijk ophaalt. De wand pas na het laden tonen zou dat verbeteren, maar verandert de eerste indruk. Dat is bewust niet gedaan.

### Live gemeten na publicatie

Lighthouse tegen https://www.strakwerkk.nl (Vercel-CDN), 7 november 2026. Ook dit is labdata.

| Pagina | Prestaties | LCP | TBT |
|---|---|---|---|
| Homepage mobiel (3 runs) | 93 (96, 93, 92) | 2,6 s | 148 ms |
| Homepage desktop | 100 | 0,7 s | 16 ms |
| /prijzen, /diensten, /contact, /werk/vagpro mobiel | 97–100 | 1,4–1,8 s | 34–118 ms |

Toegankelijkheid, best practices en SEO zijn 100. De enige uitzondering is de 404-pagina, die bewust `noindex` heeft. Links in lopende tekst op de nieuwe pagina's en de privacyverklaring zijn nu onderstreept. Ze waren alleen aan hun kleur te herkennen, waardoor de toegankelijkheid op 94–95 uitkwam.

## 7. Meting

- **Eventnamen geven nu aan dat het om een klik gaat:**
  - "Offerte naar WhatsApp"
  - "Intake naar WhatsApp"
  - "Formulier naar WhatsApp" en "Formulier naar e-mail"
  - "WhatsApp", "Bellen", "E-mail" en "Naar calculator" (op elke subpagina met `plek` = pagina)
- Een ontvangen aanvraag tel je in WhatsApp of je mailbox; zie `meting.md`.
- De privacyverklaring noemt nu ook het anoniem tellen van knopklikken.

## 8. Bewust niet gedaan

- **Geen straat of postcode in de markup.** Die zijn niet aangeleverd.
- **Werkgebied, categorie en openingstijden niet aangepast.**
- **Geen reviews, cijfers of resultaten toegevoegd.**
- **Geen nieuwe stadspagina's of massa-artikelen.**
- **Branchepagina's kapper, horeca en bouw behouden.** Ze hebben elk een eigen inhoud (andere functies per branche). Ze beloven geen projecten die er niet zijn.

## Nog nodig van Rayan

1. **Vercel → Project → Settings → Domains → `strakwerkk.nl` → Edit:** "Redirect to www.strakwerkk.nl" met status **308 Permanent**. Nu staat daar 307.
2. **Google Search Console:**
   - Domeinproperty `strakwerkk.nl` toevoegen en verifiëren via een DNS-record.
   - Sitemap `https://www.strakwerkk.nl/sitemap.xml` indienen.
   - Met URL-inspectie indexering aanvragen voor `/`, `/diensten`, `/werk`, `/prijzen`, `/over-mij` en `/contact`.
   - Een ingediende sitemap of indexeringsaanvraag is geen garantie op opname.
3. **Google Bedrijfsprofiel:**
   - Naam precies "StrakWerk", zonder zoekwoorden erachter.
   - Categorie die past (bijvoorbeeld "Websiteontwerper"). Kies die zelf in het profiel.
   - Servicegebied zoals je het echt bedient, met adres verborgen als je geen klanten op locatie ontvangt.
   - Telefoon 06 2346 2397 en website `https://www.strakwerkk.nl/`.
   - Zorg dat deze gegevens overal gelijk zijn.
4. **Echte reviews:** vraag ze aan klanten via het Bedrijfsprofiel. Pas daarna een review-sectie op de site.
5. **Geef door of er profielen zijn** (bijvoorbeeld Instagram of LinkedIn). Die kunnen dan als `sameAs` in de markup.
