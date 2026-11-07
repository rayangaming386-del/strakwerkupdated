import sys; import os as _os; _T=_os.path.dirname(_os.path.abspath(__file__)); sys.path.insert(0, _T); import site_common as SC
import html, json, os
import re as _re
def add_ss(doc):
    """Voegt srcset/sizes toe aan screenshots uit assets/work, afhankelijk van de plek op de pagina."""
    def ss(name, sizes):
        if name == 'cartronic-beheer': return ''
        if name.endswith('-mobiel'):
            return f' srcset="../assets/work/{name}-320.webp 320w, ../assets/work/{name}.webp 640w" sizes="{sizes}"'
        return f' srcset="../assets/work/{name}-800.webp 800w, ../assets/work/{name}.webp 1600w" sizes="{sizes}"'
    SZ = {'d': '(max-width: 760px) 100vw, 50vw', 'wide': '(max-width: 760px) 100vw, 75vw', 'p': '(max-width: 760px) 50vw, 25vw'}
    doc = _re.sub(r'(<figure class="(d|wide|p)"[^>]*><img src="\.\./assets/work/([a-z-]+)\.webp")',
                  lambda m: m.group(1) + ss(m.group(3), SZ[m.group(2)]), doc)
    doc = _re.sub(r'(<div class="screen">)(.*?)(</div>)',
                  lambda m: m.group(1) + _re.sub(r'(<img src="\.\./assets/work/([a-z-]+)\.webp")',
                                                 lambda n: n.group(1) + ss(n.group(2), '(max-width: 1240px) 96vw, 1200px'), m.group(2)) + m.group(3),
                  doc, flags=_re.S)
    doc = _re.sub(r'(<a class="d-shot"[^>]*><img src="\.\./assets/work/([a-z-]+)\.webp")',
                  lambda m: m.group(1) + ss(m.group(2), '(max-width: 900px) 92vw, 45vw'), doc)
    return doc
from urllib.parse import quote
ROOT=_os.path.dirname(_T)
os.makedirs(ROOT+'/diensten', exist_ok=True)
e=html.escape
OPT={ # id: (naam, prijs, omschrijving)
 'beheer':('Beheerpaneel basis','+€50',"Zelf teksten, foto's, openingstijden en bedrijfsgegevens aanpassen."),
 'beheerpro':('Beheerpaneel geavanceerd','+€75','Letterlijk alles zelf aanpassen, van diensten en prijzen tot je webshop.'),
 'kenteken':('Kentekencheck (RDW)','+€25','Klant typt een kenteken en ziet direct merk, model en bouwjaar.'),
 'kentekenfoto':('Kentekenherkenning met camera','+€35','Klant maakt een foto van de kentekenplaat, de site vult het kenteken zelf in.'),
 'aanvraag':('Aanvraag via WhatsApp','+€15','Een formulier dat aanvragen kant-en-klaar naar je WhatsApp stuurt.'),
 'locatie':('Locatie delen','+€10','Met één tik deelt de klant zijn locatie in de aanvraag.'),
 'booking':('Afspraken plannen','+€35','Klanten kiezen zelf een datum en tijd, ook buiten openingstijden.'),
 'calculator':('Prijscalculator','+€35','Klanten stellen zelf hun prijs samen en sturen hem direct door.'),
 'chat':('Chatassistent','+€45','Beantwoordt dag en nacht de meest gestelde vragen.'),
 'webshop':('Webshop','+€95','Producten, winkelwagen en online betalen met iDEAL.'),
 'taal':('Extra taal','+€25 per taal','Je site ook in het Engels, Duits of een andere taal.'),
 'regio':("Regiopagina's",'+€25','Beter gevonden in Google in de plaatsen om je heen.'),
 'reviews':('Google reviews & kaart','+€10','Je beste reviews en een routekaart op je site.'),
 'blog':('Blog of kennisbank','+€25','Artikelen en antwoorden op vragen, goed voor Google.'),
 'portfolio':("Portfolio & video's",'+€15','Laat je werk zien met projecten, foto\'s en video\'s.'),
 'gbp':('Google Bedrijfsprofiel','+€20',"Je profiel in Google Maps compleet, met foto's en openingstijden."),
 'pagina':('Extra pagina','+€15 per pagina','Bijvoorbeeld een pagina per dienst.'),
 'logo':('Logo-ontwerp','+€25','Een strak logo in een paar varianten.'),
 'teksten':('Teksten laten schrijven','+€20','Teksten die klanten overtuigen en goed vindbaar zijn in Google.'),
 'vacatures':('Vacaturepagina','+€10','Vacatures plaatsen, sollicitaties komen binnen via WhatsApp of mail.'),
 'onderhoud':('Hosting & onderhoud','€15 per maand','Updates, back-ups en kleine aanpassingen.'),
}
SHOT={
 'vagpro':('../assets/work/vagpro.webp','VAGPRO, autospecialist','../werk/vagpro'),
 'detak':('../assets/work/detak.webp','Sleepdienst De Tak','../werk/detak'),
 'detakaanvraag':('../assets/work/detak-aanvraag.webp','Aanvraag met kentekencheck bij Sleepdienst De Tak','../werk/detak'),
 'cartronic':('../assets/work/cartronic.webp','CarTronic, retrofit en webshop','../werk/cartronic'),
 'cartronicbeheer':('../assets/work/cartronic-dashboard.webp','Beheerpaneel en webshop van CarTronic','../werk/cartronic'),
}
INCL=["Ontwerp op maat, geen standaard template","Tot 3 pagina's","Mobiel-first: perfect op elke telefoon","Contactformulier en WhatsApp-knop","Basis-SEO en snelle laadtijd","Eigen domein met SSL","Binnen 7 dagen online","Eén vast aanspreekpunt"]
OPT={k:(v[0],SC.opt_price(k),v[2]) for k,v in OPT.items()}
P=[
 dict(slug='website-laten-maken', projects=['vagpro','detak','cartronic'], nav='Website laten maken', title='Website laten maken vanaf €200 | StrakWerk',
  desc='Een website op maat laten maken vanaf €200. Snel, mobiel en vindbaar in Google, binnen 7 dagen online. Kies zelf je opties en zie direct je prijs.',
  kicker='Website laten maken', h1='Een website op maat, vanaf €200.', price='€200', pnote='eenmalig, je kiest zelf de rest',
  lead='Geen standaard template en geen maandelijks abonnement. Ik ontwerp en bouw je website zelf, met precies de functies die jouw bedrijf nodig heeft.',
  shot='vagpro', preset='', intro=["Een goede website is vaak het eerste wat een klant van je ziet. Hij moet snel laden, goed werken op een telefoon en in één oogopslag laten zien wat je doet en hoe je bereikbaar bent.",
   "Bij StrakWerk start je met een complete basiswebsite van €200. Daarbovenop kies je alleen de functies die je echt nodig hebt, zoals een beheerpaneel, een kentekencheck of een webshop. Je ziet de prijs direct in de calculator op de homepage, zonder verrassingen achteraf."],
  feats=['beheer','aanvraag','pagina','reviews','gbp','teksten'],
  faq=[("Wat kost een website laten maken?","Een complete basiswebsite kost €200 eenmalig. Extra functies hebben een vaste prijs per optie, die je zelf kiest in de prijscalculator."),
       ("Hoe snel staat mijn website online?","Een basiswebsite staat meestal binnen 7 dagen online. Voor grotere opties, zoals een webshop, hoor je vooraf hoe lang het duurt."),
       ("Moet ik zelf iets doen?","Je vertelt wat je bedrijf doet en levert je logo en foto's aan, als je die hebt. Teksten kan ik ook voor je schrijven.")],
  more=['website-redesign','webshop-laten-maken','website-garage','website-kapper']),
 dict(slug='website-redesign', nav='Website redesign', title='Website vernieuwen vanaf €175 | StrakWerk',
  desc='Je bestaande website laten vernieuwen vanaf €175. Modern, snel en mobiel, met je eigen domein, teksten en foto\'s. Binnen een week online.',
  kicker='Website redesign', h1='Je oude website, strak vernieuwd.', price='€175', pnote='eenmalig, voor een bestaande site',
  lead='Heb je al een website, maar is hij verouderd, traag of slecht leesbaar op een telefoon? Ik bouw hem opnieuw op, en neem je domein, teksten en foto\'s mee.',
  shot='cartronic', preset='redesign', intro=["Veel websites zijn ooit gemaakt en daarna nooit meer aangepast. Ze laden traag, zien er op een telefoon rommelig uit of passen niet meer bij hoe je bedrijf nu is. Bezoekers haken dan af voordat ze contact opnemen.",
   "Met een website redesign krijg je een volledig nieuw ontwerp, gebouwd op snelle, moderne techniek. Je bestaande domein blijft gewoon werken, net als je e-mail. Je teksten en foto's zet ik over, en waar nodig verbeter ik ze."],
  feats=['beheer','teksten','pagina','gbp','reviews','onderhoud'],
  faq=[("Wat is het verschil met een nieuwe website?","Bij een redesign heb je al een site met teksten, foto's en een domein. Die neem ik mee, daarom start een redesign op €175 in plaats van €200."),
       ("Blijft mijn e-mail werken?","Ja. Ik koppel je bestaande domein aan de nieuwe site en zorg dat je e-mail ongestoord blijft werken."),
       ("Raak ik mijn plek in Google kwijt?","Ik zet je belangrijkste pagina's netjes door naar de nieuwe site, zodat bezoekers en Google je terugvinden.")],
  more=['website-laten-maken','webshop-laten-maken','website-horeca','website-bouwbedrijf']),
 dict(slug='webshop-laten-maken', projects=['cartronic'], nav='Webshop laten maken', title='Webshop laten maken vanaf €295 | StrakWerk',
  desc='Een webshop laten maken vanaf €295, met iDEAL, voorraadbeheer en een beheerpaneel waarin je alles zelf aanpast.',
  kicker='Webshop laten maken', h1='Verkopen via je eigen webshop.', price='€295', pnote='basis website + webshop',
  lead='Producten, winkelwagen en online betalen met iDEAL, in een webshop die bij je merk past. Met een beheerpaneel waarin je zelf producten, prijzen en voorraad beheert.',
  shot='cartronicbeheer', preset='winkel', intro=["Een eigen webshop geeft je controle: geen hoge commissies van een platform en een winkel die er precies uitziet zoals jij wilt.",
   "Een webshop bij StrakWerk start op €295: de basiswebsite van €200 plus de webshop van €95. Met het geavanceerde beheerpaneel beheer je zelf producten, voorraad en bestellingen. Bij CarTronic draait zo'n webshop al live, met een voertuigzoeker per merk en model."],
  feats=['webshop','beheerpro','portfolio','blog','teksten','onderhoud'],
  faq=[("Hoe betalen klanten?","Klanten rekenen af met iDEAL en andere gangbare betaalmethoden via een betrouwbare betaalprovider."),
       ("Kan ik zelf producten toevoegen?","Ja, met het beheerpaneel voeg je zelf producten toe en pas je prijzen en voorraad aan. In de demo op deze site kun je het uitproberen."),
       ("Hoeveel producten kan ik verkopen?","Dat maakt niet uit: van een handvol producten tot een complete catalogus.")],
  more=['website-laten-maken','website-garage','website-redesign','website-kapper']),
 dict(slug='website-garage', projects=['vagpro','cartronic'], nav='Website voor garages', title='Website voor garages en autobedrijven | StrakWerk',
  desc='Een website voor je garage of autobedrijf, met kentekencheck via de RDW, aanvragen via WhatsApp en pagina\'s per dienst. Vanaf €200.',
  kicker='Garages & autobedrijven', h1='Een website voor je garage.', price='€200', pnote='vanaf, plus de opties die je kiest',
  lead='Klanten checken hun auto op kenteken, zien je diensten en sturen meteen een aanvraag. Zoals bij VAGPRO en CarTronic.',
  shot='vagpro', preset='garage', intro=["Bij een garage begint bijna elke vraag met: welke auto heeft de klant? Met een kentekencheck via de RDW verschijnen merk, model en bouwjaar direct, zodat je meteen weet waar het over gaat.",
   "Met een aanvraagformulier dat rechtstreeks in je WhatsApp binnenkomt, mis je geen klant meer. Pagina's per dienst, zoals APK, onderhoud of diagnose, zorgen dat je beter gevonden wordt in Google. VAGPRO en CarTronic werken al met deze functies."],
  feats=['kenteken','kentekenfoto','aanvraag','booking','pagina','gbp'],
  faq=[("Hoe werkt de kentekencheck?","De klant typt het kenteken in en de site haalt merk, model en bouwjaar op uit de openbare gegevens van de RDW."),
       ("Kan ik een webshop toevoegen voor onderdelen?","Ja. CarTronic verkoopt bijvoorbeeld originele opties via een webshop met voertuigzoeker."),
       ("Kunnen klanten zelf een afspraak plannen?","Ja, met de optie Afspraken plannen kiezen klanten zelf een datum en tijd.")],
  more=['website-sleepdienst','webshop-laten-maken','website-laten-maken','website-redesign']),
 dict(slug='website-sleepdienst', projects=['detak'], nav='Website voor sleepdiensten', title='Website voor sleep- en transportbedrijven | StrakWerk',
  desc='Een website voor je sleepdienst of transportbedrijf: pech melden via WhatsApp, kentekenherkenning, locatie delen en meertalig. Vanaf €200.',
  kicker='Sleep- en transportbedrijven', h1='Snel gevonden bij pech.', price='€200', pnote='vanaf, plus de opties die je kiest',
  lead='Bij pech telt elke minuut. Met een site waarop klanten in een paar tikken hulp aanvragen, inclusief kenteken en locatie. Zoals bij Sleepdienst De Tak.',
  shot='detakaanvraag', preset='sleep', intro=["Iemand met pech langs de weg wil maar één ding: snel hulp. Je website moet dan direct duidelijk zijn, met een groot telefoonnummer en een aanvraag die binnen een minuut verstuurd is.",
   "Bij Sleepdienst De Tak vult de klant zijn kenteken in of maakt er een foto van, deelt met één knop zijn locatie en verstuurt alles via WhatsApp. De site is beschikbaar in drie talen en heeft pagina's per regio, zodat De Tak in de hele omgeving gevonden wordt."],
  feats=['kentekenfoto','kenteken','locatie','aanvraag','taal','regio'],
  faq=[("Werkt het ook 's nachts?","Ja. Aanvragen komen direct in je WhatsApp binnen, op elk moment van de dag."),
       ("Kan de site in meerdere talen?","Ja. De Tak heeft zijn site in het Nederlands, Engels en Duits. Elke extra taal kost €25."),
       ("Wat doen regiopagina's?","Met een pagina per plaats of regio word je beter gevonden door mensen die in die plaats zoeken naar een sleepdienst.")],
  more=['website-garage','website-laten-maken','website-redesign','website-bouwbedrijf']),
 dict(slug='website-kapper', nav='Website voor kappers & beauty', title='Website voor kappers en beautysalons | StrakWerk',
  desc='Een website voor je kapsalon of beautysalon, waarop klanten zelf een afspraak plannen. Met reviews, routekaart en Google Bedrijfsprofiel. Vanaf €200.',
  kicker='Kappers & beauty', h1='Klanten plannen zelf hun afspraak.', price='€200', pnote='vanaf, plus de opties die je kiest',
  lead='Een site die past bij de sfeer van je salon, waarop klanten dag en nacht zelf een afspraak inplannen. Zo heb jij je handen vrij.',
  shot=None, preset='beauty', intro=["Telefoontjes tijdens het knippen of behandelen zijn onhandig. Met online afspraken plannen kiezen klanten zelf een datum en tijd, ook 's avonds of in het weekend.",
   "Laat met foto's zien wat je maakt, toon je beste Google-reviews en zorg met een compleet Google Bedrijfsprofiel dat je goed gevonden wordt in Google Maps."],
  feats=['booking','reviews','gbp','portfolio','beheer','logo'],
  faq=[("Hoe werkt online afspraken plannen?","Klanten kiezen een behandeling, een datum en een tijd. Jij krijgt de afspraak binnen en kunt hem bevestigen."),
       ("Kan ik zelf foto's toevoegen?","Ja, met het beheerpaneel pas je zelf foto's en teksten aan. Probeer het in de demo."),
       ("Wat is een Google Bedrijfsprofiel?","Dat is je vermelding in Google Maps en de zoekresultaten, met je openingstijden, foto's en reviews.")],
  more=['website-horeca','website-laten-maken','website-redesign','webshop-laten-maken']),
 dict(slug='website-horeca', nav='Website voor horeca', title='Website voor restaurants en horeca | StrakWerk',
  desc='Een website voor je restaurant, café of lunchroom, met menukaart, reviews, routekaart en meertalig voor toeristen. Vanaf €200.',
  kicker='Restaurants & horeca', h1='Een website die honger maakt.', price='€200', pnote='vanaf, plus de opties die je kiest',
  lead='Je menukaart, sfeerbeelden, reviews en een routekaart, op een site die snel laadt op elke telefoon. Ook in de taal van je toeristen.',
  shot=None, preset='horeca', intro=["Gasten bekijken je website meestal op hun telefoon, vaak vlak voordat ze besluiten waar ze gaan eten. Dan moet je menukaart direct te vinden zijn en je adres met één tik in de navigatie staan.",
   "Met het beheerpaneel pas je zelf je menukaart en openingstijden aan, bijvoorbeeld bij een seizoensmenu of een feestdag. Met een extra taal bedien je ook toeristen."],
  feats=['reviews','taal','beheer','gbp','pagina','teksten'],
  faq=[("Kan ik mijn menukaart zelf aanpassen?","Ja, met het beheerpaneel pas je zelf gerechten, prijzen en openingstijden aan."),
       ("Kunnen gasten reserveren?","Ja, met de optie Afspraken plannen kunnen gasten zelf een moment kiezen."),
       ("Is meertalig duur?","Elke extra taal kost €25, eenmalig.")],
  more=['website-kapper','website-laten-maken','website-redesign','webshop-laten-maken']),
 dict(slug='website-bouwbedrijf', nav='Website voor bouw & installatie', title='Website voor bouw- en installatiebedrijven | StrakWerk',
  desc='Een website voor je bouw- of installatiebedrijf: laat je projecten zien, ontvang offerte-aanvragen en word gevonden in jouw regio. Vanaf €200.',
  kicker='Bouw & installatie', h1='Laat zien wat je bouwt.', price='€200', pnote='vanaf, plus de opties die je kiest',
  lead='Een site met je beste projecten, een offerte-aanvraag die direct binnenkomt en pagina\'s voor de plaatsen waar je werkt.',
  shot=None, preset='bouw', intro=["In de bouw en installatie overtuigt je werk het meest. Met een portfolio laat je projecten zien met foto's en een korte uitleg, zodat klanten direct zien wat je kunt.",
   "Een offerte-aanvraag via WhatsApp maakt het makkelijk om contact op te nemen. Met regiopagina's word je gevonden in de plaatsen waar je wilt werken."],
  feats=['portfolio','aanvraag','regio','calculator','pagina','gbp'],
  faq=[("Kan ik zelf projecten toevoegen?","Ja, met het geavanceerde beheerpaneel voeg je zelf projecten met foto's toe."),
       ("Kunnen klanten zelf een prijs berekenen?","Ja, met een prijscalculator, zoals op deze site, stellen klanten zelf een indicatie samen."),
       ("Werkt dit ook voor zzp'ers?","Zeker. De basis van €200 is juist gemaakt voor zelfstandigen en kleine bedrijven.")],
  more=['website-laten-maken','website-redesign','website-kapper','website-sleepdienst']),
]

CITIES=[
 dict(slug='website-laten-maken-den-haag', nav='Website laten maken Den Haag', city='Den Haag', projects=['vagpro','detak'], title='Website laten maken in Den Haag vanaf €200 | StrakWerk',
  desc='Een website laten maken in Den Haag? StrakWerk uit Zoetermeer bouwde onder meer de sites van VAGPRO en Sleepdienst De Tak. Op maat, vanaf €200.',
  kicker='Den Haag', h1='Een website laten maken in Den Haag.', price='€200', pnote='vanaf, kies zelf je opties',
  lead='StrakWerk zit in Zoetermeer, vlak naast Den Haag. Twee van mijn projecten staan in Den Haag, en je hebt één vast aanspreekpunt dat dezelfde dag reageert.',
  shot='vagpro', preset='', intro=["Wie in Den Haag een garage, sleepdienst of kapper zoekt, kijkt meestal naar bedrijven in de buurt. Een website die snel laadt, goed werkt op de telefoon en duidelijk laat zien waar je zit en wat je doet, helpt je dan om gevonden en gekozen te worden.",
   "Twee van mijn projecten zitten in Den Haag: VAGPRO, een specialist in Volkswagen, Audi, SEAT en Škoda, en Sleepdienst De Tak, die vanuit Den Haag in de hele regio rijdt. Zij werken met een kentekencheck, aanvragen via WhatsApp en pagina's per regio.",
   "Een complete Starter-website kost €200. Wil je zelf teksten aanpassen en aanvragen via WhatsApp ontvangen, dan is Premium (€350) vaak de beste keuze."],
  feats=['regio','gbp','aanvraag','reviews','kenteken','pagina'],
  faq=[("Waar zit StrakWerk?","In Zoetermeer, vlak naast Den Haag. Ik werk voor ondernemers in de regio en, op afstand, in de rest van Nederland."),
       ("Kunnen we elkaar spreken over mijn website?","Ja. Het intakegesprek is gratis, via WhatsApp, telefonisch of op een andere manier die jou uitkomt."),
       ("Hoe word ik beter gevonden in Den Haag?","Met een compleet Google Bedrijfsprofiel, lokale SEO en eventueel regiopagina's voor de wijken en plaatsen waar je werkt.")],
  more=['website-laten-maken-rijswijk','website-laten-maken','website-garage','website-sleepdienst']),
 dict(slug='website-laten-maken-rijswijk', nav='Website laten maken Rijswijk', city='Rijswijk', projects=['cartronic'], title='Website laten maken in Rijswijk vanaf €200 | StrakWerk',
  desc='Een website laten maken in Rijswijk? StrakWerk uit Zoetermeer bouwde de webshop van CarTronic in Rijswijk. Snel, mobiel en op maat, vanaf €200.',
  kicker='Rijswijk', h1='Een website laten maken in Rijswijk.', price='€200', pnote='vanaf, kies zelf je opties',
  lead='Van een eenvoudige bedrijfssite tot een complete webshop, zoals bij CarTronic in Rijswijk. StrakWerk zit in Zoetermeer, niet ver van Rijswijk, en je hebt één vast aanspreekpunt.',
  shot='cartronic', preset='', intro=["Of je nu een werkplaats, winkel of dienstverlener in Rijswijk hebt: klanten zoeken je eerst online op, vaak op hun telefoon. Dan moet je site snel laden en direct duidelijk maken wat je doet en hoe ze je bereiken.",
   "CarTronic, een specialist in originele fabrieksopties voor auto's, zit in Rijswijk. Voor CarTronic bouwde ik een website met webshop, voertuigzoeker per merk en model, en een geavanceerd beheerpaneel waarin de eigenaar zelf producten en teksten aanpast.",
   "Heb je al een website die toe is aan vernieuwing? Met een redesign (€175) neem ik je domein, teksten en foto's mee naar een strak, snel ontwerp."],
  feats=['webshop','beheerpro','gbp','aanvraag','regio','pagina'],
  faq=[("Kun je ook een webshop maken voor mijn bedrijf in Rijswijk?","Ja. Een webshop begint vanaf €295: de Starter-website plus de webshop-optie. Bij CarTronic draait er al een live."),
       ("Mijn site is oud. Moet ik helemaal opnieuw beginnen?","Nee, met een redesign vanaf €175 bouw ik je site opnieuw op en neem ik je bestaande inhoud mee."),
       ("Hoe snel is mijn site online?","Een Starter-website staat meestal binnen 7 dagen online.")],
  more=['website-laten-maken-den-haag','webshop-laten-maken','website-redesign','website-laten-maken']),
]
P=P+CITIES
BY={p['slug']:p for p in P}
ARROW='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>'
for p in P:
    url=f"https://www.strakwerkk.nl/diensten/{p['slug']}"
    calc=f"../?preset={p['preset']}#prijzen" if p['preset'] else "../#prijzen"
    wa="https://wa.me/31623462397?text="+quote(f"Hoi Rayan, ik las over {p['nav'].lower()} en wil graag meer weten.")
    if p['shot']:
        src,cap,link=SHOT[p['shot']]
        visual=f'<a class="d-shot" href="{link}"><img src="{src}" alt="{e(cap)}" loading="eager"><small>{e(cap)}: bekijk het project →</small></a>'
    else:
        visual='<a class="d-shot" href="../demo"><img src="../assets/demo/foto-goud.webp" alt="" loading="eager" style="aspect-ratio:1600/905"><small>Probeer zelf hoe je je site aanpast in de demo →</small></a>'
    feats=''.join(f'<article class="f"><span class="ic">{ICON}</span><h3>{e(OPT[k][0])}</h3><p>{e(OPT[k][2])}</p><span class="amt">{e(OPT[k][1])}</span></article>' for k in p['feats'])
    faq=''.join(f'<details><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q,a in p['faq'])
    more=''.join(f'<a href="{m}">{e(BY[m]["nav"])}</a>' for m in p['more'])
    ch,cld=SC.crumbs([("StrakWerk","/"),("Diensten","/diensten"),(p['nav'] if 'city' not in p else f"Website laten maken in {p['city']}",None)])
    cld['itemListElement'][-1]['item']=url
    projs=p.get('projects') or []
    if projs:
        ph=(f"Projecten in {p['city']}." if 'city' in p else ("Zo ziet dat eruit." if len(projs)>1 else "Zo ziet dat eruit."))
        pk=("Lokaal gebouwd" if 'city' in p else "Voorbeelden")
        projsec=f'''  <section class="c-sec" style="padding-top:0">
    <div class="wrap">
      <div class="c-head"><span class="kicker">{pk}</span><h2>{e(ph)}</h2></div>
      <div class="h-cards{' two' if len(projs)==2 else ''}">{''.join(SC.project_card(x) for x in projs)}</div>
    </div>
  </section>
'''
    else: projsec=''

    ld=json.dumps([
      {"@context":"https://schema.org","@type":"Service","name":p['nav'],"serviceType":p['nav'],"description":p['desc'],"url":url,
       "provider":SC.provider(),
       "areaServed":({"@type":"City","name":p['city']} if 'city' in p else {"@type":"Country","name":"Nederland"}),"offers":{"@type":"Offer","price":p['price'].replace('€',''),"priceCurrency":"EUR"}},
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":a}} for q,a in p['faq']]},
      cld
    ], ensure_ascii=False)
    doc=f'''<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(p['title'])}</title>
<meta name="description" content="{e(p['desc'])}">
<meta name="theme-color" content="#0B0E13">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{e(p['title'])}">
<meta property="og:description" content="{e(p['desc'])}">
<meta property="og:image" content="https://www.strakwerkk.nl/assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="../assets/fonts/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="../assets/fonts/fonts.css">
<link rel="stylesheet" href="../assets/case.css">
<script type="application/ld+json">{ld}</script>
<script>window.va=window.va||function(){{(window.vaq=window.vaq||[]).push(arguments)}};</script>
<script defer src="/_vercel/insights/script.js"></script>
</head>
<body style="--tint:rgba(207,174,105,.16)">
<a class="promo-strip" href="/#prijzen" data-until="2026-12-01T00:00:00+01:00"><b>Actie</b><span class="l">Gratis logo en Google Bedrijfsprofiel bij elke website</span><span class="s">Gratis logo + profiel</span><em data-cd>t/m 30 november</em></a><script>if(Date.now()>=Date.parse("2026-12-01T00:00:00+01:00"))document.currentScript.previousElementSibling.remove()</script>
{SC.header(active='/diensten', cta=(calc.replace('../','/'), 'Bereken je prijs'))}
<main>
  <section class="c-hero">
    <div class="wrap d-hero">
      <div>
        {ch}
        <span class="kicker">{e(p['kicker'])}</span>
        <h1>{e(p['h1'])}</h1>
        <p class="c-lead">{e(p['lead'])}</p>
        <div class="d-price"><b>{e(p['price'])}</b><span>{e(p['pnote'])}</span></div>
        <div class="c-cta"><a class="btn btn--gold" href="{calc}">Bereken je prijs</a><a class="btn" href="{wa}" target="_blank" rel="noopener">App Rayan</a></div>
      </div>
      {visual}
    </div>
  </section>
  <section class="c-sec" style="padding-top:clamp(24px, 4vw, 48px)">
    <div class="wrap">
      <div class="c-head"><span class="kicker">Waarom</span><h2>{e(p.get('why') or (f"Waarom StrakWerk in {p['city']}?" if 'city' in p else f"{p['nav']} bij StrakWerk."))}</h2></div>
      <div class="d-text">{''.join(f'<p>{e(t)}</p>' for t in p['intro'])}</div>
    </div>
  </section>
{projsec}  <section class="c-sec" style="padding-top:0">
    <div class="wrap">
      <div class="c-head"><span class="kicker">Altijd inbegrepen</span><h2>Dit krijg je in de basis.</h2></div>
      <ul class="d-incl">{''.join(f'<li>{e(x)}</li>' for x in INCL)}</ul>
    </div>
  </section>
  <section class="c-sec" style="padding-top:0">
    <div class="wrap">
      <div class="c-head"><span class="kicker">Functies die passen</span><h2>Kies wat je nodig hebt.</h2><p>Elke optie heeft een vaste prijs. Zet ze aan in de calculator en je ziet direct je totaal.</p></div>
      <div class="feat">{feats}</div>
    </div>
  </section>
  <section class="c-sec" style="padding-top:0">
    <div class="wrap">
      <div class="c-head"><span class="kicker">Vragen</span><h2>Veelgestelde vragen.</h2></div>
      <div class="d-faq">{faq}</div>
    </div>
  </section>
  <section class="c-end">
    <div class="wrap">
      <div class="c-box">
        <span class="kicker">Aan de slag</span>
        <h2>Benieuwd wat het voor jou kost?</h2>
        <p>De calculator staat al ingevuld met de opties die het best bij je passen. Pas aan wat je wilt en stuur je offerte via WhatsApp.</p>
        <div class="c-cta"><a class="btn btn--gold" href="{calc}">Bereken je prijs</a><a class="btn" href="../demo">Probeer het beheerpaneel</a></div>
      </div>
      <div class="c-head" style="margin:clamp(48px, 7vw, 80px) 0 18px"><span class="kicker">Meer diensten</span></div>
      <nav class="d-more" aria-label="Andere diensten">{more}<a href="/diensten">Alle diensten</a><a href="/prijzen">Alle prijzen</a></nav>
    </div>
  </section>
</main>
{SC.footer()}
<script src="../assets/js/gsap.min.js"></script>
<script src="../assets/js/ScrollTrigger.min.js"></script>
<script src="../assets/js/SplitText.min.js"></script>
<script src="../assets/js/lenis.min.js"></script>
<script src="../assets/case.js"></script>
</body>
</html>
'''
    open(f"{ROOT}/diensten/{p['slug']}.html",'w').write(add_ss(doc))
assert [(p['slug'],p['nav']) for p in P if 'city' not in p]==SC.DIENSTEN, 'DIENSTEN in site_common.py bijwerken'
assert [(p['slug'],p['city']) for p in P if 'city' in p]==SC.STEDEN, 'STEDEN in site_common.py bijwerken'
# overzicht voor andere scripts
json.dump({'diensten':[[p['slug'],p['nav']] for p in P if 'city' not in p],'steden':[[p['slug'],p['city']] for p in P if 'city' in p]}, open(_T + '/diensten-list.json','w'))
print('ok', len(P))
