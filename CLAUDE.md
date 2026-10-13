# StrakWerk website

Eén-pagina site voor StrakWerk (websites voor ondernemers, vanaf €200). Alle communicatie met de eigenaar is in het Nederlands.

## Structuur
- `index.html`: de hele site in één bestand (HTML, CSS en JS, animaties met GSAP + ScrollTrigger).
- Prijzen en opties van de configurator staan onderaan in het script in het blok `CONFIG` (WhatsApp-nummer, basisprijs, opties, presets per portfolio-klant).
- `assets/work/`: screenshots van projecten (`*-mobiel.webp`, `cartronic-beheer.webp`). Ontbreekt een bestand, dan toont de site een mock-up.
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
- Echte klantreviews (bijv. Karim van CarTronic) voor een review-sectie.
- Btw: zijn prijzen incl. of excl. btw? KvK-nummer voor in de footer.
- Domein: controleren of strakwerkk.nl in Vercel aan dit project gekoppeld is.
