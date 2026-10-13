# StrakWerk website

Eén-pagina site voor StrakWerk (websites voor ondernemers, vanaf €200). Alle communicatie met de eigenaar is in het Nederlands.

## Structuur
- `index.html`: de hele site in één bestand (HTML, CSS en JS, animaties met GSAP + ScrollTrigger).
- Prijzen en opties van de configurator staan onderaan in het script in het blok `CONFIG` (WhatsApp-nummer, basisprijs, opties, presets per portfolio-klant).
- `assets/work/`: screenshots van projecten. Desktop (`vagpro.webp`, `detak.webp`, `detak-de.webp`, `cartronic.webp`, `cartronic-dashboard.webp`, 1600x905) staan in een laptopframe, mobiel (`*-mobiel.webp`) in een telefoon ervoor. De Tak heeft een NL/DE-wissel, CarTronic een wissel Website/Beheer (`.shot-tabs`). Nieuwe desktop-screenshots: scrollbalk rechts en de blauwe laadbalk bovenin wegknippen.
- Achtergronden: in de hero een bewegende, schuine wand van eigen projecten (`.wall`, kleine versies in `assets/bg/`), korrel over de hele site (`assets/bg/grain.webp`), een zachte gloed per sectie (`#id::before`) en de werkplekfoto `assets/setup.webp` (met AI 4x opgeschaald van 335x597, licht wazig en donker) achter het contactblok (`.cta-photo`).
- `assets/og.png`: preview-afbeelding voor delen via WhatsApp/socials.
- `vercel.json` (redirects van oude pagina's zoals `/service-pro.html`), `robots.txt`, `sitemap.xml`.
- Elke push naar `main` gaat automatisch live via Vercel.

## Stijlafspraken (belangrijk)
- Donker + goud, met accenten in blauw, koper, indigo en teal. Origineel STRAK/WERK-logo.
- **Geen** nummering (01, 02…) bij secties of stappen.
- **Geen** browserbolletjes (rood/geel/groen) op mock-ups.
- **Geen** decoratieve liggende streepjes of lijntjes.
- Screenshots zonder statusbalk en adresbalk.
- Veel beweging, maar respecteer `prefers-reduced-motion` (rustige versie zonder animaties).
- Altijd testen op desktop én mobiel: geen console-fouten, niets dat horizontaal buiten beeld schuift.
- Nooit reviews, klantcitaten of cijfers verzinnen; die komen van de eigenaar.

## Portfolio
- VAGPRO (kentekencheck), De Tak (aanvraag via WhatsApp, meertalig, regiopagina's), CarTronic (webshop + geavanceerd beheerpaneel, `CONFIG.cartronicUrl`).
- Teller staat op "20+ sites live".

## Openstaande punten (input van eigenaar nodig)
- Foto van de eigenaar + naam en kort verhaal voor een "Over mij"-sectie.
- Echte klantreviews (bijv. Karim van CarTronic) voor een review-sectie.
- Btw: zijn prijzen incl. of excl. btw? KvK-nummer voor in de footer.
- Domein: controleren of strakwerkk.nl in Vercel aan dit project gekoppeld is.
