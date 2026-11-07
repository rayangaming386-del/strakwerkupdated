# StrakWerk website

Site van StrakWerk, webdesignbedrijf uit **Zoetermeer** (websites voor ondernemers, vanaf €200). Alle communicatie met de eigenaar is in het Nederlands.

## Structuur
- `index.html`: de homepage in één bestand (HTML, CSS en JS). De bibliotheken laden met `defer` en het hoofdscript draait in een `DOMContentLoaded`-callback: functies zijn dus niet globaal (testscripts kunnen `totals()` e.d. niet meer direct aanroepen).
- Overzichtspagina's in de root (cleanUrls): `diensten.html` (`/diensten`), `werk.html` (`/werk`), `prijzen.html` (`/prijzen`, alle prijzen uit `CONFIG`), `over-mij.html` (`/over-mij`) en `contact.html` (`/contact`, met formulier naar WhatsApp of e-mail via `assets/case.js`).
- Menu: overal dezelfde vijf links met echte URL's (Werk, Diensten, Prijzen, Over mij, Contact). Op de homepage hebben ze `data-sec` en scrollen ze naar de sectie (`#werk`, `#features`, `#prijzen`, `#over`, `#contact`); actieve menu-items via `buildNav()`. Subpagina's: pil-menu `.snav`, op mobiel uitklapmenu `.smenu` (`<details>`), uitgebreide footer `.sfoot`, kruimelpad met tussenlaag (StrakWerk / Diensten / ..., StrakWerk / Werk / ...).
- Generators staan in `tools/` (niet gepubliceerd): `site_common.py` (menu, footer, kruimelpad, projectkaarten, leest `CONFIG` uit `index.html`), `gen_cases.py` (werk/), `gen_diensten.py` (diensten/), `gen_kennis.py` (kennisbank), `gen_hubs.py` (de vijf overzichtspagina's) en `gen_sitemap.py`. Pas teksten aan in de generator, draai hem (`python3 tools/gen_hubs.py` enz.) en daarna `python3 tools/gen_sitemap.py`. `privacy.html`, `404.html` en `demo.html` zijn met de hand gemaakt (menu/footer daar met de hand bijwerken).
- `werk/vagpro.html`, `werk/detak.html`, `werk/cartronic.html`: projectpagina's (stijl in `assets/case.css`, gedrag in `assets/case.js`). Bereikbaar als `/werk/vagpro` enz. (Vercel cleanUrls). Links naar `/?preset=<project>#prijzen` vullen de configurator vooraf in.
- Bibliotheken staan lokaal in `assets/js/` (GSAP 3.13 + ScrollTrigger, SplitText, DrawSVGPlugin, Lenis 1.3.4), geen CDN.
- Effecten: vloeiend scrollen (Lenis, `window.__lenis`), koppen per regel (SplitText), hero-laptop zoomt in bij scrollen (alleen desktop, `.zoomer`), dienstenband die reageert op scrollsnelheid (`.marquee`), levende tegels (kenteken typt zichzelf, Google #9 naar #1, WhatsApp "typt..."), prijzen in tabs met vliegend kaartje naar de offerte, werkwijze-iconen tekenen zichzelf (DrawSVG), sectie "Voor wie" (`#branches`, presets per branche in `CONFIG.presets`), footer met grote CTA en klok.
- Prijzen en opties van de configurator staan onderaan in het script in het blok `CONFIG`:
  - `bases` = de pakketten: `nieuw` (Starter €200), `premium` (€350), `pro` (€500), `redesign` (€175). `incl` per pakket = opties die erin zitten (aantallen bij qty-opties, bijv. `pagina:2`). Inbegrepen opties staan vergrendeld op "Inbegrepen"; opties die botsen met iets inbegrepens (`excl`) zijn uitgeschakeld. Logica: `inclOf()`, `enforce()`, `setBase()`.
  - Opties per groep (`nieuw:true` toont een Nieuw-label), presets (`base:"redesign"` kiest de redesign-basis).
  - `promo`: tijdelijke actie (nu t/m 30 november 2026: logo-ontwerp en Google Bedrijfsprofiel gratis bij elke website). Verloopt vanzelf via `until`, ook als de pagina open staat (`promoUI(false)` haalt de gratis opties weer uit de offerte). Rood (`--red`) met live aftelling: hero-pill `#promoPill` (in plaats van `#newPill`), blok `#promoBar` met dagen/uur/min/sec boven de pakketten, en in de mobiele balk (`.mbar.has-promo`). Aftelvelden: `data-cd="blocks"`, `"short"`, `"dh"`, `"dhs"`; `promoTick()` werkt ze elke seconde bij.
  - Calculator-extra's (alles afgeleid uit `CONFIG`, geen vaste getallen in de HTML): voordeel in de offerte (`pkgSave()` = losse waarde min pakketprijs, `promoSave()` = actie), "Bespaar"-labels op de pakketkaarten, slimme tip als een groter pakket goedkoper of even duur uitkomt (`bestUpgrade()`), keuzehulp in 3 vragen (`#kh`), vergelijkingstabel (`#pkCmp`), keuze onthouden in localStorage (`sw-offerte-v1`, met melding "Je vorige keuze staat weer klaar"), deellink `?cfg=pakket~optie~optie.aantal` (gaat vóór `?preset=`), offerte als PDF via `printQuote()` (print-CSS alleen actief met `html.pq`, gewone Ctrl+P blijft normaal).
- Contact: bel- en maillinks (tel:/mailto:) in contactblok, footer en mobiel menu; werkgebied (`.c-area`): Zoetermeer (thuisbasis, goud), Den Haag en Rijswijk als link naar hun stadspagina, Delft en Westland als tekst, plus "de rest van Nederland, op afstand" (werkgebied niet aanpassen zonder akkoord van Rayan); formulier kan ook via e-mail (`#f-mail`, onderwerp en tekst ingevuld).
- Gratis snelheidscheck (`#speedcheck` in de sectie Nieuw): opent Google PageSpeed Insights voor het ingevulde adres en biedt daarna een WhatsApp-link om de uitslag te sturen.
- Kennisbank-teaser op de homepage (`#kennis`, de 3 nieuwste artikelen) en een lijst in de footer; bij een nieuw artikel beide bijwerken (komen uit dezelfde lijst als de generator).
- Structuurdata op de homepage: ProfessionalService met `@id` `https://www.strakwerkk.nl/#organisatie` (subpagina's verwijzen hiernaar), `alternateName` "StrakWerk Webdesign", `address` met alleen plaats/provincie/land (Zoetermeer, Zuid-Holland, NL; geen straat of postcode zonder akkoord), `hasOfferCatalog` (de pakketprijzen, url `/prijzen`), `areaServed` (Nederland + Den Haag, Rijswijk, Delft, Zoetermeer, Westland) en `contactPoint`; WebSite met `@id` en `publisher`; `FAQPage` gemaakt uit de FAQ op de pagina (Google toont FAQ-resultaten niet meer, maar de markup is onschadelijk en bewust behouden). Bij nieuwe prijzen of FAQ-vragen die ook bijwerken. Nooit review- of beoordelingsmarkup zonder echte reviews.
- Sectie `#nieuw` promoot de nieuwe diensten: website redesign (oud/nieuw-schuif, `#cv`) en kentekenherkenning met camera (scan-animatie, `.scan`). Knoppen `data-pick-base` en `data-pick-opt` zetten iets aan in de offerte en scrollen naar de prijzen.
- Foto-achtergronden per sectie: `.sec-photo` met getinte, wazige foto's uit `assets/bg/ph-*.webp` (gemaakt uit de klantscreenshots, duotoon in goud/koper/teal/indigo).
- `assets/work/`: screenshots van projecten. Desktop (`vagpro*.webp` incl. over/zakelijk/contact, `detak*.webp` incl. de/aanvraag/onderweg, `cartronic.webp`, `cartronic-dashboard.webp`, 1600x905) staan in een laptopframe, mobiel (`*-mobiel.webp`) in een telefoon ervoor. Elk project heeft een paginawissel onder de laptop (`.shot-tabs`, wisselt automatisch). Nieuwe desktop-screenshots: scrollbalk rechts en de blauwe laadbalk bovenin wegknippen.
- Achtergronden: in de hero een bewegende, schuine wand van eigen projecten (`.wall`, kleine versies in `assets/bg/`), korrel over de hele site (`assets/bg/grain.webp`), een zachte gloed per sectie (`#id::before`) en de werkplekfoto `assets/setup.webp` (1600x1200) in "Over mij" en licht wazig achter het contactblok (`.cta-photo`).
- Subpagina's (werk/, diensten/, kennisbank) hebben een actiebalk `.promo-strip` direct na `<body>`, met een inline script dat hem na de einddatum meteen verwijdert. Bij een nieuwe actie: `CONFIG.promo` op de homepage, `PROMO_UNTIL` in `tools/site_common.py` (balk op alle gegenereerde subpagina's, ook het actievak op `/prijzen`), de balk in `privacy.html`/`404.html` als die er staat, en `data-until` van `#promoPill` (inline script zet het juiste hero-label al vóór de eerste weergave) aanpassen (of weghalen).
- `kennisbank.html` (overzicht, in de root zodat `/kennisbank` werkt met cleanUrls) en `kennisbank/*.html` (zes artikelen, nieuwste eerst; elk met eigen datum). Het artikel over Google Bedrijfsprofiel heeft een actievak `.art-promo` dat na de einddatum zichzelf verwijdert. Gebruiken absolute paden (`/assets/...`, `/kennisbank/...`). Artikelen bevatten geen verzonnen cijfers.
- `privacy.html` (privacyverklaring, gelinkt in de footers) en `404.html` (Vercel toont die automatisch; gebruikt absolute paden `/assets/...`).
- Lettertypes lokaal in `assets/fonts/` (`fonts.css`, Geist + Geist Mono), geen Google Fonts.
- `vercel.json`: permanente redirects (308) van oude pagina's (`/service-*` naar `/prijzen`, `/diensten/webshop-laten-maken` of `/diensten`), van de samengevoegde stadspagina's (Zoetermeer naar `/`, Delft en Westland naar `/diensten/website-laten-maken`) en een vangnet van host `strakwerkk.nl` naar www. `robots.txt`, `sitemap.xml` (gemaakt door `tools/gen_sitemap.py`: alleen canonieke, indexeerbare pagina's, lastmod = laatste wijziging, geen changefreq/priority).
- `.vercelignore`: `CLAUDE.md`, `docs/`, `tools/` en `assets/work/LEESMIJ.txt` worden niet gepubliceerd. `docs/seo/` bevat de nulmeting, het wijzigingsoverzicht en de meethandleiding van de SEO-update van 7 november 2026.
- Projectpagina's worden gegenereerd met `tools/gen_cases.py`; pas bij wijzigingen alle drie de bestanden in `werk/` consistent aan.
- `diensten/*.html`: acht dienst- en branchepagina's voor Google (website laten maken, redesign, webshop, garage, sleepdienst, kapper, horeca, bouw) plus twee stadspagina's (`website-laten-maken-den-haag`, `-rijswijk`), alleen waar echte projecten zitten. Delft, Zoetermeer en Westland zijn in november 2026 samengevoegd (geen eigen lokale waarde, doorway-risico); maak geen nieuwe stadspagina's zonder echt lokaal project of echte lokale inhoud. Zelfde stijl als de projectpagina's, met Service/FAQ/Breadcrumb-structuurdata (stadspagina's met `areaServed` = de stad). Stadspagina's noemen alleen projecten die echt in die plaats zitten (VAGPRO en De Tak: Den Haag, CarTronic: Rijswijk) en tonen die als projectkaarten; StrakWerk zelf zit in Zoetermeer. Links vanuit "Voor wie", de redesign-kaart en de footer. Pas bij wijzigingen alle pagina's consistent aan.
- Meten: alle pagina's hebben de Vercel Analytics-stub (`window.va`) vóór het insights-script. Eigen events (een event = een klik die WhatsApp/bellen/mail opent, géén ontvangen aanvraag; zie `docs/seo/meting.md`): WhatsApp, Bellen, E-mail, Formulier naar WhatsApp, Formulier naar e-mail, Offerte naar WhatsApp, Intake naar WhatsApp, Offerte gekopieerd, Offerte-link gekopieerd, Offerte PDF, Pakket gekozen, Optie aan, Tip gevolgd, Keuzehulp, Snelheidscheck, Demo geopend, Demo bekeken, Demo: ik wil dit, Naar calculator. Zonder cookies en zonder persoonsgegevens. Eigen events zijn in Vercel alleen zichtbaar op een Pro-abonnement.
- `demo.html`: interactieve demo van het beheerpaneel (Basis/Geavanceerd), live voorbeeldsite ernaast, wijzigingen alleen in localStorage (`sw-demo-v1`). Demo-foto's in `assets/demo/`. Bezoekersaantallen in het dashboard zijn gemarkeerd als "Voorbeeld".
- `assets/video/configurator.mp4`: schermopname van ~10 s van de configurator met de pakketten (Premium + kentekencheck + afspraken). Opgenomen met een datum ná de actie, zodat er geen actie in beeld is. Opnieuw opnemen als de calculator er anders uit gaat zien.
- `assets/og.png`: preview-afbeelding (1200x630) met CarTronic-laptop en De Tak-telefoon.
- Mobiel: balk onderaan door de hele site (buiten de hero en het contactblok), bij de prijzen met je totaal.
- Snelheid (Lighthouse-lab, 7 november 2026, live op Vercel): homepage mobiel ~93 (LCP ~2,6 s, TBT ~150 ms), desktop 100, subpagina's 97-100, toegankelijkheid/best practices/SEO overal 100 (404 heeft bewust noindex). Links in lopende tekst altijd onderstrepen (`.tl` op subpagina's), anders zakt toegankelijkheid. Velddata (echte bezoekers) is nog niet bekend. Afspraken die dat zo houden:
  - Bibliotheken met `defer`, hoofdscript na `DOMContentLoaded`. Op telefoons/tablets (`html.noload`) wordt de hero-inhoud niet verborgen en opnieuw ingeschoven (dat gaf een flits); op desktop wel, achter de loader.
  - Op telefoons is de introtekst (`.hero .lead`) het LCP-element: houd decoratieve wandtegels daar kleiner (`.wcol.d` 180px, `sizes` 120px/50px zodat de `-360`/`-150`-varianten laden).
  - De videoposter (`data-poster`) laadt pas in de buurt van het scherm.
  - De intro-loader draait alleen op desktop met muis (`html.noload` op telefoons/tablets).
  - Getinte sectiefoto's laden pas in de buurt van het scherm (`.sec-photo.ld`).
  - Screenshots hebben `srcset`-varianten: `-800.webp` (desktop-screenshots 1600x905), `-320.webp` (mobiel 640 breed), muur `assets/bg/*-360.webp`. Maak die varianten ook voor nieuwe screenshots.
  - Koppen worden pas in regels gesplitst (SplitText) als ze binnen 700px van het scherm komen.
  - De kleurvlekken in de hero bewegen via CSS-animaties (`.hero-bg.anim`), niet via GSAP.
  - Lettertype-declaraties staan inline in de `<head>` van de homepage (subpagina's laden `assets/fonts/fonts.css`).
- Elke push naar `main` gaat automatisch live via Vercel.

## Stijlafspraken (belangrijk)
- Donker + goud, met accenten in blauw, koper, indigo en teal. Origineel STRAK/WERK-logo.
- **Geen** nummering (01, 02…) bij secties of stappen. Secties krijgen een klein gouden label (`.kicker`).
- **Geen** browserbolletjes (rood/geel/groen) op mock-ups.
- **Geen** decoratieve liggende streepjes of lijntjes.
- Screenshots zonder statusbalk en adresbalk.
- Veel beweging, maar respecteer `prefers-reduced-motion` (rustige versie zonder animaties).
- **Nooit** `scroll-behavior:smooth` in CSS: dat breekt de metingen van ScrollTrigger (animaties verspringen na terugscrollen). Lenis doet het vloeiende scrollen.
- Vastgezette secties (hero, werk) alleen op desktop. Hero-zoom start op scrollpositie 0. Elementen binnen een vastgezette sectie niet als eigen trigger gebruiken. Geen 3D-draai/schaal-animaties in de horizontale projectenstrook (die overlappen elkaar).
- Test na wijzigingen: herberekenen (`ScrollTrigger.refresh()`) halverwege de pagina mag geen startposities veranderen.
- Altijd testen op desktop én mobiel: geen console-fouten, niets dat horizontaal buiten beeld schuift.
- Let op: `main` heeft `overflow-x:clip`, dus te brede inhoud geeft géén horizontale scroll maar wordt stil afgeknipt. Test daarom ook of elementen buiten beeld vallen (op 320, 360, 390 en 768 px). Grid-kinderen met brede inhoud (tabellen) hebben `min-width:0` nodig (zie `.cfg > *`).
- Nooit reviews, klantcitaten of cijfers verzinnen; die komen van de eigenaar.

## Eigenaar
- Rayan, oprichter van StrakWerk, gevestigd in Zoetermeer (geen straat of postcode op de site). Sectie `#over` ("Over mij") tussen Prijzen en Werkwijze, en de pagina `/over-mij`.
- Rayan wil **niet** met een foto op de site: geen portret toevoegen of vragen. De werkplekfoto blijft.
- Geen KvK-nummer: niets over KvK of btw op de site zetten.
- Nog geen reviews: geen review-sectie of beoordelingen tonen tot Rayan echte reviews aanlevert.

## Portfolio
- VAGPRO (kentekencheck), De Tak (aanvraag via WhatsApp, meertalig, regiopagina's), CarTronic (webshop + geavanceerd beheerpaneel). CarTronic staat live op https://cartronic.nl (`CONFIG.cartronicUrl`, ook in `werk/cartronic.html`).
- Teller staat op "20+ sites live".

## Openstaande punten (input van eigenaar nodig)
- CarTronic werkplaats- en hero-screenshot opnieuw laten sturen als bestand (alleen merken/video's/contact/reviews zijn binnen).
- Echte oude site van een klant voor de oud/nieuw-schuif (nu een nagebouwd voorbeeld van een verouderde site).
- Volledige pagina-screenshots (van boven tot onder) per site, voor schermen die meescrollen.
- Per project: wat wilde de klant en wat leverde het op (geen resultaten verzinnen).
- De tekst in "Over mij" is geschreven zonder harde feiten (geen leeftijd, jaren ervaring of aantallen); vul die alleen aan met info van Rayan.
- Echte klantreviews zodra Rayan ze heeft (dan pas een review-sectie maken).
- Na 30 november: de actie verdwijnt vanzelf. Haal daarna `CONFIG.promo`, de `.promo-strip` op de subpagina's en het actievak in het Google Bedrijfsprofiel-artikel weg (of vervang door een nieuwe actie).
- Domein: gecontroleerd, de live site is deze repository. Wel: `strakwerkk.nl` stuurt met een tijdelijke **307** naar www; in Vercel (Settings > Domains > strakwerkk.nl > Edit) op **308 Permanent** zetten.
- Google Search Console: domeinproperty toevoegen, sitemap indienen, indexering aanvragen voor de nieuwe pagina's (geen toegang vanuit Claude).
- Google Bedrijfsprofiel: naam exact "StrakWerk", gegevens gelijk aan de site; eventuele profielen (Instagram, LinkedIn) doorgeven voor `sameAs`.
