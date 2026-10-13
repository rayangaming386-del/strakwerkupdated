# StrakWerk website

Eén-pagina site voor StrakWerk (websites voor ondernemers, vanaf €200). Alle communicatie met de eigenaar is in het Nederlands.

## Structuur
- `index.html`: de homepage in één bestand (HTML, CSS en JS).
- `werk/vagpro.html`, `werk/detak.html`, `werk/cartronic.html`: projectpagina's (stijl in `assets/case.css`, gedrag in `assets/case.js`). Bereikbaar als `/werk/vagpro` enz. (Vercel cleanUrls). Links naar `/?preset=<project>#prijzen` vullen de configurator vooraf in.
- Bibliotheken staan lokaal in `assets/js/` (GSAP 3.13 + ScrollTrigger, SplitText, DrawSVGPlugin, Lenis 1.3.4), geen CDN.
- Effecten: vloeiend scrollen (Lenis, `window.__lenis`), koppen per regel (SplitText), hero-laptop zoomt in bij scrollen (alleen desktop, `.zoomer`), dienstenband die reageert op scrollsnelheid (`.marquee`), levende tegels (kenteken typt zichzelf, Google #9 naar #1, WhatsApp "typt..."), prijzen in tabs met vliegend kaartje naar de offerte, werkwijze-iconen tekenen zichzelf (DrawSVG), sectie "Voor wie" (`#branches`, presets per branche in `CONFIG.presets`), footer met grote CTA en klok.
- Prijzen en opties van de configurator staan onderaan in het script in het blok `CONFIG` (WhatsApp-nummer, basisprijs, opties, presets per portfolio-klant).
- `assets/work/`: screenshots van projecten. Desktop (`vagpro*.webp` incl. over/zakelijk/contact, `detak*.webp` incl. de/aanvraag/onderweg, `cartronic.webp`, `cartronic-dashboard.webp`, 1600x905) staan in een laptopframe, mobiel (`*-mobiel.webp`) in een telefoon ervoor. Elk project heeft een paginawissel onder de laptop (`.shot-tabs`, wisselt automatisch). Nieuwe desktop-screenshots: scrollbalk rechts en de blauwe laadbalk bovenin wegknippen.
- Achtergronden: in de hero een bewegende, schuine wand van eigen projecten (`.wall`, kleine versies in `assets/bg/`), korrel over de hele site (`assets/bg/grain.webp`), een zachte gloed per sectie (`#id::before`) en de werkplekfoto `assets/setup.webp` (1600x1200) in "Over mij" en licht wazig achter het contactblok (`.cta-photo`).
- `assets/og.png`: preview-afbeelding voor delen via WhatsApp/socials.
- `vercel.json` (redirects van oude pagina's zoals `/service-pro.html`), `robots.txt`, `sitemap.xml`.
- Elke push naar `main` gaat automatisch live via Vercel.

## Stijlafspraken (belangrijk)
- Donker + goud, met accenten in blauw, koper, indigo en teal. Origineel STRAK/WERK-logo.
- **Geen** nummering (01, 02…) bij secties of stappen. Secties krijgen een klein gouden label (`.kicker`).
- **Geen** browserbolletjes (rood/geel/groen) op mock-ups.
- **Geen** decoratieve liggende streepjes of lijntjes.
- Screenshots zonder statusbalk en adresbalk.
- Veel beweging, maar respecteer `prefers-reduced-motion` (rustige versie zonder animaties).
- Altijd testen op desktop én mobiel: geen console-fouten, niets dat horizontaal buiten beeld schuift.
- Nooit reviews, klantcitaten of cijfers verzinnen; die komen van de eigenaar.

## Eigenaar
- Rayan, oprichter van StrakWerk. Sectie `#over` ("Over mij") tussen Prijzen en Werkwijze.

## Portfolio
- VAGPRO (kentekencheck), De Tak (aanvraag via WhatsApp, meertalig, regiopagina's), CarTronic (webshop + geavanceerd beheerpaneel, `CONFIG.cartronicUrl`).
- Teller staat op "20+ sites live".

## Openstaande punten (input van eigenaar nodig)
- Screenshots die mid-gesprek gestuurd zijn kwamen niet als bestand binnen: De Tak werkgebied, CarTronic werkplaats/reviews/merken/video's/contact. Opnieuw laten sturen.
- Volledige pagina-screenshots (van boven tot onder) per site, voor schermen die meescrollen.
- Screenshots van een oude klantsite, voor een oud-versus-nieuw-schuif.
- Per project: wat wilde de klant en wat leverde het op (geen resultaten verzinnen).
- Portretfoto van Rayan voor de "Over mij"-sectie (nu staat daar de werkplekfoto). De tekst in "Over mij" is geschreven zonder harde feiten (geen leeftijd, jaren ervaring of aantallen); vul die alleen aan met info van Rayan.
- Echte klantreviews (bijv. Karim van CarTronic) voor een review-sectie.
- Btw: zijn prijzen incl. of excl. btw? KvK-nummer voor in de footer.
- Domein: controleren of strakwerkk.nl in Vercel aan dit project gekoppeld is.
