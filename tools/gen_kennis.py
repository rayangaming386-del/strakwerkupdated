import sys; import os as _os; _T=_os.path.dirname(_os.path.abspath(__file__)); sys.path.insert(0, _T); import site_common as SC
import html, json, os
e=html.escape
ROOT=_os.path.dirname(_T); os.makedirs(ROOT+'/kennisbank', exist_ok=True)
DATE='2026-11-05'; DATE_NL='5 november 2026'
A=[
 dict(slug='google-bedrijfsprofiel-aanmaken', title='Google Bedrijfsprofiel: zo word je gevonden in Google Maps', kicker='Lokaal gevonden worden', mins=5,
  date='2026-11-06', date_nl='6 november 2026',
  desc='Met een gratis Google Bedrijfsprofiel sta je in Google Maps en in de zoekresultaten. Zo maak je het aan, verifieer je het en haal je er het meeste uit.',
  intro='Zoekt iemand een kapper, garage of sleepdienst in de buurt, dan ziet hij vaak eerst een kaartje met bedrijven. Daar sta je alleen tussen met een Google Bedrijfsprofiel. Het is gratis, en het is een van de snelste manieren om lokaal gevonden te worden.',
  body='''<h2>Wat is een Google Bedrijfsprofiel?</h2>
<p>Een Google Bedrijfsprofiel, vroeger Google Mijn Bedrijf, is je vermelding in Google Maps en in de zoekresultaten van Google. Klanten zien er in één oogopslag je openingstijden, telefoonnummer, adres of werkgebied, foto's en reviews. Een profiel aanmaken en bijhouden is gratis.</p>
<h2>Zo maak je je profiel aan</h2>
<ul>
<li><strong>Ga naar google.com/business</strong> en log in met een Google-account. Gebruik bij voorkeur een account dat bij je bedrijf hoort, niet je privéaccount.</li>
<li><strong>Vul je bedrijfsnaam in.</strong> Gebruik de naam die je ook op je gevel, je bus of je website gebruikt. Extra zoekwoorden aan je naam toevoegen mag niet volgens de regels van Google.</li>
<li><strong>Kies een categorie</strong> die precies zegt wat je doet, bijvoorbeeld autogarage of kapsalon. Later kun je extra categorieën toevoegen.</li>
<li><strong>Kies je locatie of werkgebied.</strong> Komen klanten naar jou toe, vul dan je adres in. Ga je zelf naar de klant, zoals een sleepdienst of installateur, dan kun je je adres verbergen en een werkgebied opgeven.</li>
<li><strong>Vul je telefoonnummer en website in.</strong></li>
</ul>
<h2>Verifiëren</h2>
<p>Google wil zeker weten dat je bedrijf echt bestaat en van jou is. Daarom verifieer je je profiel, bijvoorbeeld met een code via telefoon, sms of e-mail, of met een korte video van je bedrijf. Welke manier je krijgt, bepaalt Google. Pas na de verificatie is je profiel voor iedereen zichtbaar.</p>
<h2>Maak je profiel compleet</h2>
<ul>
<li><strong>Openingstijden,</strong> ook voor feestdagen. Niets is zo vervelend als een klant die voor een dichte deur staat.</li>
<li><strong>Foto's</strong> van je bedrijf en je werk. Echte foto's werken beter dan stockfoto's.</li>
<li><strong>Een korte omschrijving</strong> van wat je doet en voor wie.</li>
<li><strong>Je diensten of producten,</strong> eventueel met prijzen.</li>
</ul>
<h2>Reviews: vragen en beantwoorden</h2>
<p>Reviews helpen nieuwe klanten bij hun keuze. Vraag tevreden klanten om een review: in je profiel vind je een link die je direct kunt doorsturen, bijvoorbeeld via WhatsApp. Reageer op elke review, ook op een kritische. Bedank voor complimenten en blijf bij kritiek vriendelijk en concreet.</p>
<h2>Houd het bij</h2>
<p>Verandert er iets, zoals je openingstijden of je telefoonnummer, pas het dan meteen aan. Plaats af en toe een update of nieuwe foto's. Zo laat je zien dat je bedrijf actief is.</p>
<p class="art-tip">Liever dat ik het voor je regel? Bij je website zet ik je Google Bedrijfsprofiel op of maak ik het compleet, met foto's en openingstijden. Dat is een optie van €20 in de <a href="/#prijzen">prijscalculator</a>.</p>
<p class="art-tip art-promo"><strong>Actie:</strong> tot en met 30 november zet ik je Google Bedrijfsprofiel <strong>gratis</strong> voor je op bij elke website, net als een logo-ontwerp. <a href="/#prijzen">Bekijk de actie</a></p><script>if(Date.now()>=Date.parse("2026-12-01T00:00:00+01:00"))document.currentScript.previousElementSibling.remove()</script>'''),
 dict(slug='website-toe-aan-redesign', title='Is je website toe aan een redesign? 8 signalen', kicker='Redesign', mins=5,
  date='2026-11-06', date_nl='6 november 2026',
  desc='Hoe weet je of je website toe is aan vernieuwing? Acht duidelijke signalen, en wat je eraan kunt doen.',
  intro='Een website gaat niet kapot, maar veroudert wel. Stilletjes, terwijl jij met je bedrijf bezig bent. Herken je een paar van deze signalen, dan is het tijd voor een redesign.',
  body='''<h2>Op een telefoon is hij lastig te gebruiken</h2>
<p>Moet je inzoomen om iets te lezen, of tik je steeds op de verkeerde knop? De meeste bezoekers komen via hun telefoon. Google kijkt bovendien vooral naar de mobiele versie van je site om te bepalen waar je in de zoekresultaten komt.</p>
<h2>Hij laadt traag</h2>
<p>Duurt het lang voordat je site in beeld is, dan haken bezoekers af voordat ze zien wat je doet. Test het zelf met de <a href="/#speedcheck">gratis snelheidscheck</a> en lees <a href="/kennisbank/waarom-is-mijn-website-traag">waarom een website traag kan zijn</a>.</p>
<h2>Je browser zegt "Niet veilig"</h2>
<p>Zie je die melding naast je adres, dan mist je site een beveiligde verbinding (https). Bezoekers worden daar terecht wantrouwig van, zeker als ze een formulier moeten invullen.</p>
<h2>Je stuurt de link liever niet door</h2>
<p>Twijfel je of je een klant naar je eigen website wilt sturen, omdat hij er gedateerd uitziet? Dan doet je site je bedrijf tekort. Je website is vaak de eerste indruk die iemand van je krijgt.</p>
<h2>Zelf iets aanpassen lukt niet</h2>
<p>Zit je vast aan een oud systeem, of aan iemand die je site ooit gebouwd heeft en niet meer bereikbaar is? Dan blijft je site achter terwijl je bedrijf verandert.</p>
<h2>De informatie klopt niet meer</h2>
<p>Oude prijzen, diensten die je niet meer levert of een telefoonnummer dat niet meer werkt: het kost je klanten en vertrouwen.</p>
<h2>Er komen weinig aanvragen binnen</h2>
<p>Bezoekers moeten in een paar seconden zien wat je doet en hoe ze je bereiken. Is er geen duidelijke knop om te bellen, te appen of een aanvraag te doen, dan klikken ze door naar de concurrent.</p>
<h2>Je wordt slecht gevonden in Google</h2>
<p>Verouderde techniek, ontbrekende titels en omschrijvingen of geen pagina's voor de plaatsen waar je werkt: allemaal redenen waarom Google je minder snel laat zien.</p>
<h2>Wat levert een redesign op?</h2>
<p>Een snelle, moderne site die goed werkt op elke telefoon, die je zelf kunt bijhouden en die bezoekers duidelijk naar contact leidt. Je hoeft niet opnieuw te beginnen: je domein, je e-mail, je teksten en je foto's neem je mee.</p>
<h2>Een redesign bij StrakWerk</h2>
<p>Een redesign bij StrakWerk start op €175. Ik zet je bestaande teksten en foto's over, koppel je eigen domein en zorg dat je e-mail blijft werken. Je belangrijkste oude pagina's stuur ik door naar de nieuwe, zodat bezoekers en Google je terugvinden.</p>
<p class="art-tip">Twijfel je? Doe de <a href="/#speedcheck">gratis snelheidscheck</a>, of bekijk wat een <a href="/diensten/website-redesign">website redesign</a> precies inhoudt.</p>'''),
 dict(slug='wat-kost-een-website', title='Wat kost een website in 2026?', kicker='Prijzen', mins=5,
  desc='Wat kost een website laten maken in 2026? Een eerlijk overzicht: zelf bouwen, een freelancer of een bureau, en waar de prijs van afhangt.',
  intro='De prijs van een website loopt enorm uiteen: van een paar tientjes per maand tot duizenden euro\'s. Hoe kan dat, en wat heb je eigenlijk nodig? Een eerlijk overzicht.',
  body='''<h2>De drie routes</h2>
<p>Grofweg heb je drie manieren om aan een website te komen. Elke route heeft zijn eigen kosten en zijn eigen nadelen.</p>
<div class="art-scroll"><table class="art-tbl"><thead><tr><th>Route</th><th>Kosten</th><th>Let op</th></tr></thead><tbody>
<tr><td><strong>Zelf bouwen</strong><br>Wix, Squarespace en dergelijke</td><td data-l="Kosten">Een maandelijks abonnement, zolang je site online staat</td><td data-l="Let op">Je bouwt het zelf, met een standaard template. Extra functies kosten vaak extra apps.</td></tr>
<tr><td><strong>Freelancer</strong><br>zoals StrakWerk</td><td data-l="Kosten">Een eenmalig bedrag, bij StrakWerk vanaf €200</td><td data-l="Let op">Vraag vooraf wat er precies inbegrepen is en wat extra kost.</td></tr>
<tr><td><strong>Reclamebureau</strong></td><td data-l="Kosten">Vaak €1.500 of meer</td><td data-l="Let op">Veel mogelijk, maar je betaalt ook voor overhead en meerdere mensen.</td></tr>
</tbody></table></div>
<h2>Waar hangt de prijs van af?</h2>
<ul>
<li><strong>Aantal pagina's.</strong> Een site met één pagina is sneller klaar dan een site met een pagina per dienst.</li>
<li><strong>Functies.</strong> Een contactformulier is standaard. Een webshop, een afsprakenplanner of een kentekencheck vraagt meer werk.</li>
<li><strong>Zelf aanpassen.</strong> Wil je zelf teksten en foto's wijzigen, dan heb je een beheerpaneel nodig.</li>
<li><strong>Teksten en foto's.</strong> Lever je die zelf aan, of moeten ze nog gemaakt worden?</li>
<li><strong>Talen.</strong> Elke extra taal betekent extra pagina's en vertalingen.</li>
</ul>
<h2>Vergeet de doorlopende kosten niet</h2>
<p>Naast de bouw heb je te maken met een domeinnaam, hosting en onderhoud. Vraag altijd wat dat per jaar of per maand kost, zodat je niet verrast wordt.</p>
<h2>Wat kost een website bij StrakWerk?</h2>
<p>Bij StrakWerk zie je de prijs vooraf. Kies een pakket of stel zelf samen:</p>
<ul>
<li><strong>Starter, €200:</strong> een complete website tot 3 pagina's, mobiel, met contactformulier en WhatsApp-knop.</li>
<li><strong>Premium, €350:</strong> met beheerpaneel, aanvragen via WhatsApp, Google Bedrijfsprofiel en reviews, en extra pagina's.</li>
<li><strong>Pro, €500:</strong> met geavanceerd beheerpaneel, extra taal, blog, logo en regiopagina's.</li>
<li><strong>Redesign, €175:</strong> voor wie al een website heeft die toe is aan vernieuwing.</li>
</ul>
<p class="art-tip">Benieuwd wat jouw website kost? In de <a href="/#prijzen">prijscalculator</a> zet je zelf opties aan en zie je direct je totaal.</p>'''),
 dict(slug='wix-of-website-op-maat', title='Wix of een website op maat: wat past bij jou?', kicker='Vergelijking', mins=4,
  desc='Zelf een website bouwen met Wix of een website op maat laten maken? De voor- en nadelen op een rij, zodat je een goede keuze maakt.',
  intro='Met een websitebouwer zoals Wix of Squarespace zet je zelf een site in elkaar. Dat klinkt goedkoop en snel. Maar wanneer is het slim, en wanneer niet?',
  body='''<h2>Wanneer een websitebouwer prima is</h2>
<ul>
<li>Je hebt tijd en zin om zelf te bouwen en bij te houden.</li>
<li>Je zoekt vooral een simpel online visitekaartje.</li>
<li>Je vindt een standaard template goed genoeg.</li>
</ul>
<h2>Wanneer een website op maat beter werkt</h2>
<ul>
<li><strong>Je wilt opvallen.</strong> Een template zien je klanten ook bij concurrenten. Een ontwerp op maat past bij jouw bedrijf.</li>
<li><strong>Je hebt een specifieke functie nodig,</strong> zoals een kentekencheck, een aanvraagformulier dat in WhatsApp binnenkomt of een webshop met voertuigzoeker.</li>
<li><strong>Je hebt er geen tijd voor.</strong> Je wilt ondernemen, niet de hele avond met blokjes schuiven.</li>
<li><strong>Je wilt geen abonnement.</strong> Bij een websitebouwer betaal je zolang je site online staat. Bij een site op maat betaal je de bouw één keer.</li>
</ul>
<h2>Kun je later nog overstappen?</h2>
<p>Ja. Begin je met een websitebouwer en loop je tegen grenzen aan, dan kun je overstappen. Je domeinnaam kun je meenemen, net als je teksten en foto's. Met een website redesign zet ik je bestaande inhoud over naar een nieuw, snel ontwerp.</p>
<h2>Zelf je site aanpassen kan ook bij een site op maat</h2>
<p>Een veelgehoord argument voor Wix is dat je alles zelf kunt aanpassen. Met een beheerpaneel kan dat ook bij een site op maat: je wijzigt teksten, foto's en openingstijden zonder code.</p>
<p class="art-tip">Probeer zelf hoe dat werkt in de <a href="/demo">demo van het beheerpaneel</a>. Geen account nodig.</p>'''),
 dict(slug='waarom-is-mijn-website-traag', title='Waarom is mijn website traag? 7 oorzaken', kicker='Snelheid', mins=5,
  desc='Een trage website kost je bezoekers. De meest voorkomende oorzaken van een trage site, en wat je eraan kunt doen.',
  intro='Laadt je website traag, vooral op een telefoon? Dan haken bezoekers af voordat ze zien wat je doet. Dit zijn de meest voorkomende oorzaken.',
  body='''<h2>1. Te grote afbeeldingen</h2>
<p>Een foto rechtstreeks van je telefoon is al gauw een paar megabyte. Laat afbeeldingen verkleinen tot de maat waarop ze getoond worden, en gebruik een modern formaat zoals WebP.</p>
<h2>2. Alles laadt in één keer</h2>
<p>Afbeeldingen onderaan de pagina hoeven pas te laden als de bezoeker erheen scrolt. Dat heet lazy loading en het scheelt veel laadtijd.</p>
<h2>3. Te veel plug-ins en scripts</h2>
<p>Elke plug-in, chatknop of tracker laadt extra code. Kijk kritisch wat je echt nodig hebt.</p>
<h2>4. Langzame hosting</h2>
<p>Goedkope gedeelde hosting kan traag reageren. Moderne hosting met een CDN zet je site dicht bij je bezoekers.</p>
<h2>5. Lettertypes van externe diensten</h2>
<p>Lettertypes die van een externe server komen, zorgen voor extra wachttijd. Zelf gehoste lettertypes laden sneller en zijn beter voor de privacy.</p>
<h2>6. Een verouderde website</h2>
<p>Oude websitesystemen en thema's zijn vaak niet gemaakt voor de telefoon. Soms is opnieuw bouwen sneller en goedkoper dan blijven repareren.</p>
<h2>7. Geen onderhoud</h2>
<p>Zonder updates stapelen problemen zich op. Regelmatig onderhoud houdt je site snel en veilig.</p>
<h2>Zo test je de snelheid zelf</h2>
<p>Ga naar <a href="https://pagespeed.web.dev" target="_blank" rel="noopener">PageSpeed Insights</a> van Google, vul je adres in en bekijk vooral de score voor mobiel. Groen is goed.</p>
<p class="art-tip">Is je site traag en verouderd? Met een <a href="/diensten/website-redesign">website redesign vanaf €175</a> krijg je een snelle, moderne site, met je eigen domein en inhoud.</p>'''),
 dict(slug='checklist-website-laten-maken', title='Website laten maken? Deze checklist helpt je op weg', kicker='Checklist', mins=4,
  desc='Wat heb je nodig als je een website laat maken? Een praktische checklist: van domeinnaam tot teksten en foto\'s.',
  intro='Je wilt een website laten maken. Hoe beter je voorbereid bent, hoe sneller en beter het resultaat. Loop deze checklist door voor je begint.',
  body='''<h2>Over je bedrijf</h2>
<ul>
<li>Wat doe je, en voor wie?</li>
<li>Wat wil je dat een bezoeker doet: bellen, appen, een afspraak maken of iets kopen?</li>
<li>Wie zijn je concurrenten, en welke websites vind je mooi?</li>
</ul>
<h2>Wat je aanlevert</h2>
<ul>
<li><strong>Je logo,</strong> liefst als los bestand. Heb je er nog geen, dan kan er een gemaakt worden.</li>
<li><strong>Foto's</strong> van je werk, je bedrijf of je producten. Eigen foto's werken beter dan stockfoto's.</li>
<li><strong>Teksten</strong> over je diensten. Een paar zinnen per dienst is een goed begin; het kan ook voor je geschreven worden.</li>
<li><strong>Contactgegevens</strong> en openingstijden.</li>
</ul>
<h2>Techniek</h2>
<ul>
<li><strong>Domeinnaam:</strong> heb je er al een, of moet er een geregistreerd worden?</li>
<li><strong>E-mail:</strong> gebruik je al e-mail op je domein? Dan moet die blijven werken.</li>
<li><strong>Bestaande website:</strong> welke pagina's moeten blijven bestaan, zodat je je plek in Google niet kwijtraakt?</li>
</ul>
<h2>Functies</h2>
<ul>
<li>Wil je zelf teksten en foto's aanpassen? Dan heb je een beheerpaneel nodig.</li>
<li>Heb je extra functies nodig, zoals een webshop, afspraken plannen of een kentekencheck?</li>
<li>Moet de site in meerdere talen?</li>
</ul>
<h2>Na de lancering</h2>
<ul>
<li>Zet je Google Bedrijfsprofiel op en houd het bij.</li>
<li>Vraag tevreden klanten om een review.</li>
<li>Spreek af wie updates en kleine aanpassingen doet.</li>
</ul>
<p class="art-tip">Alles op een rij? Stel je website samen in de <a href="/#prijzen">prijscalculator</a> en stuur je keuze met één tik via WhatsApp.</p>'''),
]
def head(title,desc,url,ld):
    return f'''<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<meta name="theme-color" content="#0B0E13">
<link rel="canonical" href="{url}">
<meta property="og:type" content="article">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:image" content="https://www.strakwerkk.nl/assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="/assets/fonts/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/fonts/fonts.css">
<link rel="stylesheet" href="/assets/case.css">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
<script>window.va=window.va||function(){{(window.vaq=window.vaq||[]).push(arguments)}};</script>
<script defer src="/_vercel/insights/script.js"></script>
</head>
<body style="--tint:rgba(207,174,105,.14)">
<a class="promo-strip" href="/#prijzen" data-until="2026-12-01T00:00:00+01:00"><b>Actie</b><span class="l">Gratis logo en Google Bedrijfsprofiel bij elke website</span><span class="s">Gratis logo + profiel</span><em data-cd>t/m 30 november</em></a><script>if(Date.now()>=Date.parse("2026-12-01T00:00:00+01:00"))document.currentScript.previousElementSibling.remove()</script>
{SC.header(page=url)}
'''
FOOT=SC.footer()+'''
<script src="/assets/js/gsap.min.js"></script>
<script src="/assets/js/ScrollTrigger.min.js"></script>
<script src="/assets/js/SplitText.min.js"></script>
<script src="/assets/js/lenis.min.js"></script>
<script src="/assets/case.js"></script>
</body>
</html>
'''
END=''
BASE='https://www.strakwerkk.nl/kennisbank/'
BASE_IDX='https://www.strakwerkk.nl/kennisbank'
crumb=lambda items: {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":i+1,"name":n,"item":u} for i,(n,u) in enumerate(items)]}
for i,a in enumerate(A):
    url=BASE+a['slug']; others=[x for x in A if x is not a][:3]
    ld=[{"@context":"https://schema.org","@type":"Article","headline":a['title'],"description":a['desc'],"datePublished":a.get('date',DATE),"dateModified":a.get('date',DATE),
         "author":{"@type":"Person","name":"Rayan","url":"https://www.strakwerkk.nl/over-mij"},"publisher":{"@type":"Organization","@id":SC.ORG_ID,"name":"StrakWerk","logo":{"@type":"ImageObject","url":"https://www.strakwerkk.nl/icon-512.png"}},
         "mainEntityOfPage":url,"image":"https://www.strakwerkk.nl/assets/og.png","inLanguage":"nl-NL"},
        crumb([("StrakWerk","https://www.strakwerkk.nl/"),("Kennisbank",BASE_IDX),(a['title'],url)])]
    more=''.join(f'<a href="/kennisbank/{o["slug"]}">{e(o["title"])}</a>' for o in others)
    doc=head(a['title']+' | StrakWerk',a['desc'],url,ld)+f'''<main>
  <section class="c-hero">
    <div class="wrap art" style="display:grid; gap:20px; justify-items:start">
      <nav class="crumbs" aria-label="Kruimelpad"><a href="/">StrakWerk</a><span aria-hidden="true">/</span><a href="/kennisbank">Kennisbank</a></nav>
      <span class="kicker">{e(a['kicker'])}</span>
      <h1 style="font-size:clamp(2.3rem, 5.4vw, 4rem)">{e(a['title'])}</h1>
      <p class="c-lead">{e(a['intro'])}</p>
      <div class="art-meta"><span>Door <a href="/over-mij">Rayan</a></span><span>{a.get('date_nl',DATE_NL)}</span><span>{a['mins']} min lezen</span></div>
    </div>
  </section>
  <section class="c-sec" style="padding-top:0">
    <div class="wrap art"><div class="art-body">
{a['body']}
    </div></div>
  </section>
  <section class="c-end">
    <div class="wrap">
      <div class="c-box">
        <span class="kicker">Aan de slag</span>
        <h2>Een website die wél werkt?</h2>
        <p>Kies een pakket vanaf €200 of stel zelf je website samen. Je ziet direct wat het kost.</p>
        <div class="c-cta"><a class="btn btn--gold" href="/#prijzen">Bereken je prijs</a><a class="btn" href="https://wa.me/31623462397?text=Hoi%20Rayan%2C%20ik%20heb%20een%20vraag%20over%20mijn%20website." target="_blank" rel="noopener">App Rayan</a></div>
      </div>
      <div class="c-head" style="margin:clamp(48px, 7vw, 80px) 0 18px"><span class="kicker">Lees ook</span></div>
      <nav class="d-more" aria-label="Meer artikelen">{more}</nav>
{END}
    </div>
  </section>
</main>
'''+FOOT
    open(f"{ROOT}/kennisbank/{a['slug']}.html",'w').write(doc)
# overzicht
cards=''.join(f'<a class="kb-card" href="/kennisbank/{a["slug"]}"><small>{e(a["kicker"])} · {a["mins"]} min</small><h2>{e(a["title"])}</h2><p>{e(a["desc"])}</p><span>Lees artikel →</span></a>' for a in A)
ld=[{"@context":"https://schema.org","@type":"CollectionPage","name":"Kennisbank","url":BASE_IDX,"hasPart":[{"@type":"Article","headline":a['title'],"url":BASE+a['slug']} for a in A]},
    crumb([("StrakWerk","https://www.strakwerkk.nl/"),("Kennisbank",BASE_IDX)])]
doc=head('Kennisbank: tips over je website | StrakWerk','Praktische artikelen over websites voor ondernemers: wat kost een website, Wix of maatwerk, een trage site, Google Bedrijfsprofiel, een redesign en een checklist.',BASE_IDX,ld)+f'''<main>
  <section class="c-hero">
    <div class="wrap" style="display:grid; gap:20px; justify-items:start">
      <nav class="crumbs" aria-label="Kruimelpad"><a href="/">StrakWerk</a><span aria-hidden="true">/</span><span>Kennisbank</span></nav>
      <span class="kicker">Kennisbank</span>
      <h1 style="font-size:clamp(2.6rem, 6vw, 4.8rem)">Slimmer met je website.</h1>
      <p class="c-lead">Praktische uitleg voor ondernemers, zonder vakjargon. Over prijzen, keuzes en hoe je beter gevonden wordt.</p>
    </div>
  </section>
  <section class="c-sec" style="padding-top:0">
    <div class="wrap"><div class="kb-list feat">{cards}</div></div>
  </section>
</main>
'''+FOOT
open(f"{ROOT}/kennisbank.html",'w').write(doc)
json.dump([[a['slug'],a['title'],a['kicker'],a['mins'],a['desc'],a.get('date',DATE)] for a in A], open(_T + '/kennis-list.json','w'))
print('ok', len(A))
