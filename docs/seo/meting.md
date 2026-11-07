# Meten: klikken en echte aanvragen

## Wat Vercel Analytics telt

Vercel Analytics telt anoniem, zonder cookies en zonder persoonsgegevens. Een event betekent dat iemand op een knop **klikte** en dat WhatsApp, de telefoon of de mail **opende** met een kant-en-klaar bericht. Of het bericht ook echt verstuurd is, kan de site niet zien. Eigen events zijn in Vercel alleen zichtbaar op een Pro-abonnement.

| Event | Wanneer |
|---|---|
| Offerte naar WhatsApp | Knop "Verstuur via WhatsApp" bij de offerte (homepage). Data: pakket, totaal |
| Intake naar WhatsApp | Knop "Plan een gratis intake" bij de offerte |
| Formulier naar WhatsApp / Formulier naar e-mail | Contactformulier op de homepage of `/contact`. Data: soort aanvraag, plek |
| WhatsApp, Bellen, E-mail | Elke andere WhatsApp-, bel- of maillink. Data: plek (sectie of pagina) |
| Naar calculator | Klik naar `/#prijzen` vanaf een subpagina |
| Pakket gekozen, Optie aan, Tip gevolgd, Keuzehulp | Gebruik van de calculator |
| Offerte gekopieerd, Offerte-link gekopieerd, Offerte PDF | Offerte bewaard of gedeeld |
| Snelheidscheck, Demo geopend, Demo bekeken, Demo: ik wil dit | Overige acties |

## Echte aanvragen tellen

Echte aanvragen tel je in WhatsApp en in je mailbox. Elke knop opent WhatsApp met een eigen begintekst, zodat je in WhatsApp ziet waar een bericht vandaan komt:

| Begint met | Komt van |
|---|---|
| "Hoi StrakWerk, ik wil graag een website. Mijn keuze: …" (met offertelink `?cfg=`) | Offerte uit de calculator |
| "Hoi StrakWerk, ik wil mijn website laten vernieuwen. Mijn keuze: …" | Offerte met redesign |
| "Hoi Rayan, ik wil graag een gratis intakegesprek plannen." | Intakeknop bij de offerte |
| "Hoi StrakWerk!" + Naam / Bedrijf / Ik zoek | Contactformulier (homepage of `/contact`) |
| "Hoi StrakWerk, ik wil graag een website." | Knoppen op de homepage (hero, contact, menu) |
| "Hoi StrakWerk, ik heb een vraag." | Zwevende WhatsApp-knop en mobiele balk |
| "Hoi Rayan, ik wil graag een website." | Over mij, footer van de homepage, `/contact` |
| "Hoi Rayan, ik las over [dienst] en wil graag meer weten." | Dienst- of stadspagina |
| "Hoi Rayan, ik zag het project van [project] …" | Projectpagina |
| "Hoi Rayan, ik zag je projecten …" | `/werk` |
| "Hoi Rayan, ik wil graag weten welke dienst bij mijn bedrijf past." | `/diensten` |
| "Hoi Rayan, ik heb een vraag over de prijzen." | `/prijzen` |
| "Hoi Rayan, ik heb een vraag over een website." | Menu en footer van subpagina's, 404, kennisbank |
| "Hoi Rayan, ik heb de snelheid van … getest." | Gratis snelheidscheck |

Mails van het formulier hebben als onderwerp "Websiteaanvraag" (eventueel "van [bedrijf]").

## Maandelijks bijhouden

Houd elke maand dezelfde vijf dingen bij:

1. **Search Console › Prestaties:**
   - klikken en vertoningen, gesplitst in zoekopdrachten **met** en **zonder** "strakwerk"
   - top 10 pagina's
   - gemiddelde positie van "webdesign zoetermeer" en "website laten maken zoetermeer"
2. **Search Console › Pagina's (indexering):**
   - aantal geïndexeerde pagina's
   - redenen waarom pagina's niet geïndexeerd zijn
3. **Search Console › Core Web Vitals** (alleen als er genoeg verkeer is voor velddata).
4. **Vercel Analytics:**
   - bezoekers per pagina
   - events "Offerte naar WhatsApp" en "Formulier naar WhatsApp/e-mail"
5. **WhatsApp en mail:** aantal echte aanvragen per begintekst (tabel hierboven) en hoeveel daarvan opdracht werden.
