# SEO-nulmeting strakwerkk.nl, 7 november 2026

Vastgelegd vóór de SEO-update, zodat het effect later te beoordelen is. Alle cijfers hieronder zijn zelf gemeten of letterlijk overgenomen. Waar data ontbreekt, staat dat erbij.

## Wat niet beschikbaar was

- **Google Search Console:** geen toegang. Onbekend welke pagina's geïndexeerd zijn, welke zoekopdrachten vertoningen of klikken opleveren en of er indexeringsfouten zijn.
- **Vercel Analytics:** geen toegang tot het dashboard. Bezoekersaantallen en events zijn dus niet bekeken.
- **Google Bedrijfsprofiel:** geen toegang. NAP-gegevens (naam, adres, telefoon) zijn niet tegen het profiel vergeleken.
- **Velddata (CrUX / echte gebruikers):** de PageSpeed Insights API gaf `429 Quota exceeded`, dus er is geen velddata opgehaald. Bij weinig verkeer heeft Google vaak ook geen velddata. De snelheidscijfers hieronder zijn daarom **alleen labdata**.

## Live controle (curl, 7 nov 2026)

| Adres | Resultaat |
|---|---|
| `https://www.strakwerkk.nl/` en subpagina's | 200 |
| `https://strakwerkk.nl/*` (zonder www) | **307 (tijdelijk)** naar www, voor elk pad |
| `/index.html`, `*.html`, trailing slash | 308 naar de schone URL (goed) |
| `/service-pro.html` (oude pagina) | 308 → `/service-pro` → `/#prijzen` (2 stappen) |
| `/CLAUDE.md`, `/assets/work/LEESMIJ.txt` | **200: interne notities openbaar te lezen** |
| `/diensten`, `/werk`, `/prijzen`, `/contact`, `/over-mij` | 404 (geen overzichtspagina's) |
| Niet-bestaande pagina | echte 404 met eigen 404-pagina (goed) |
| `http://` → `https://` | niet te controleren vanaf deze omgeving (proxy laat alleen HTTPS toe) |

De 307 verklaart waarschijnlijk waarom Google `https://strakwerkk.nl` liet zien. Bij een tijdelijke redirect toont Google volgens de eigen documentatie vaak de bron-URL, bij een permanente de doel-URL.

## Inventaris (28 HTML-pagina's)

- Titels en omschrijvingen zijn uniek: geen dubbele titels of omschrijvingen.
- De omschrijving van de homepage is 182 tekens. Die wordt in Google afgekapt.
- Projectpagina's: omschrijvingen zijn midden in een woord afgekapt op 155 tekens. Titels zijn algemeen ("VAGPRO | Project van StrakWerk") en er is geen structured data.
- `demo.html` heeft geen h1. `privacy.html` heeft geen canonical.
- Stadspagina's (Den Haag, Rijswijk, Delft, Zoetermeer, Westland) volgen hetzelfde sjabloon. Delft, Zoetermeer en Westland hebben geen lokaal project als bewijs, en Delft en Zoetermeer zeggen ten onrechte "StrakWerk zit in Den Haag".
- Structured data:
  - Homepage: ProfessionalService zonder adres, met `areaServed` Nederland + 5 steden, plus WebSite en FAQPage.
  - Dienstpagina's: Service, FAQPage en BreadcrumbList.
  - Kennisbank: Article en BreadcrumbList.
  - Google toont FAQ-resultaten niet meer, dus de FAQPage-markup levert niets op.
- Footer-klok: "Den Haag". De vestigingsplaats is Zoetermeer.
- Sitemap: 26 URL's met `changefreq`/`priority` (Google negeert die) en alleen `lastmod` bij de artikelen.
- robots.txt: alles toegestaan en de sitemap wordt genoemd (goed).

## Lighthouse (lab, lokaal)

Lighthouse 12.8.2, gesimuleerde Moto G Power, trage 4G en 4x CPU-vertraging. Gemeten op een lokale server, dus zonder Vercel-CDN, compressie of HTTP/2. Gebruik de cijfers alleen om vóór en na te vergelijken, niet als echte gebruikerscijfers.

| Pagina | Prestaties | LCP | TBT | CLS | Toegankelijkheid / Best practices / SEO |
|---|---|---|---|---|---|
| Homepage mobiel (mediaan van 3) | 90 (62, 90, 95) | 2,9 s | 254 ms | 0,002 | 100 / 100 / 100 |
| Homepage desktop | 100 | 0,7 s | 37 ms | 0,001 | 100 / 100 / 100 |
| /diensten/website-laten-maken mobiel | 99 | 2,1 s | 31 ms | 0 | 100 / 100 / 100 |
| /werk/vagpro mobiel | 96 | 2,7 s | 22 ms | 0 | 100 / 100 / 100 |
| /kennisbank/wat-kost-een-website mobiel | 100 | 1,7 s | 0 ms | 0 | 100 / 100 / 100 |
| /demo mobiel | 100 | 1,4 s | 0 ms | 0 | 100 / 100 / 100 |

Wat opviel op de homepage (mobiel):

- **Het grootste element bovenaan is een decoratieve tegel uit de bewegende projectenwand.** De tekst is het niet. De tegels laden met lage prioriteit, en op telefoons met een hoge pixeldichtheid worden de 720px-versies opgehaald.
- **Vóór de eerste weergave worden ~320 KB opgehaald,** waaronder afbeeldingen van verborgen kolommen en de videoposter verderop.
- **De scripts blokkeren de parser.** Onder het "Nieuw"-label wordt de kop eerst getoond, dan verborgen en daarna ingeschoven. Dat is een zichtbare flits, en het label wisselt van "Nieuw" naar "Actie".

## Zoekwoorden en concurrentie

Er zijn geen zoekvolumes of moeilijkheidsscores beschikbaar en die zijn ook niet geschat. De zoekresultaten zijn bekeken met een zoektool die vanuit de VS zoekt, dus de Nederlandse resultaten kunnen afwijken.

- **"webdesign Zoetermeer" / "website laten maken Zoetermeer":** vooral vergelijkingssites (Trustoo, Sortlist) en lokale freelancers en bureaus met reviews. Een compleet Google Bedrijfsprofiel en echte reviews wegen hier waarschijnlijk zwaar (inschatting).
- **"StrakWerk":** ook een stukadoorsbedrijf "SK StrakWerk" (Werkspot/Instagram). De merknaam is dus niet uniek. De combinatie "StrakWerk Webdesign" plus Zoetermeer moet consequent terugkomen.
- **"website laten vernieuwen" / "webshop laten maken":** vooral prijsgidsen en artikelen van bureaus en vergelijkingssites.

## Prioriteitenlijst (vóór de update)

1. **Hoog:**
   - apex-redirect 307 → 308 (Vercel-instelling, door Rayan)
   - interne notities niet meer publiceren
   - verkeerde vestigingsplaats (Den Haag → Zoetermeer)
   - stadspagina's zonder eigen waarde (Delft, Zoetermeer, Westland)
2. **Middel:**
   - overzichtspagina's Diensten, Werk, Prijzen, Over mij en Contact, met een vast menu met echte URL's
   - kruimelpad met tussenniveau
   - betere titels en omschrijvingen
   - structured data opschonen (adres Zoetermeer, @id, geen FAQPage)
   - sitemap met kloppende lastmod
3. **Lager:**
   - mobiele laadvolgorde (wandtegels, scripts, flits in de hero)
   - meting: klik apart van echte aanvraag
   - interne links tussen diensten, projecten, prijzen en contact
