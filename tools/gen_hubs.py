"""Overzichtspagina's: /diensten, /werk, /prijzen, /over-mij en /contact.
Prijzen komen uit CONFIG in index.html (via site_common), teksten alleen uit bestaande, geverifieerde inhoud."""
import sys, json
import os as _os; _T=_os.path.dirname(_os.path.abspath(__file__)); sys.path.insert(0, _T)
import site_common as SC
from site_common import e, eur, BASES, ITEMS, C

ROOT = SC.ROOT
ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>'
INCL = ["Ontwerp op maat, geen standaard template", "Tot 3 pagina's", "Mobiel-first: perfect op elke telefoon", "Contactformulier en WhatsApp-knop",
        "Basis-SEO en snelle laadtijd", "Eigen domein met SSL", "Binnen 7 dagen online", "Eén vast aanspreekpunt"]
P_START, P_RED = BASES['nieuw']['price'], BASES['redesign']['price']
P_SHOP = P_START + ITEMS['webshop']['price']


def page(path, title, desc, body, active='', ld=(), tint='rgba(207,174,105,.16)', cta=('/#prijzen', 'Bereken je prijs')):
    doc = SC.head(title, desc, path, ld=list(ld)) + f'''
<body style="--tint:{tint}">
{SC.promo_strip()}
{SC.header(active=active, page=path, cta=cta)}
<main>
{body}
</main>
{SC.footer()}
{SC.SCRIPTS}
</body>
</html>
'''
    open(f'{ROOT}{path}.html', 'w', encoding='utf-8').write(doc)
    return doc


def hero(crumb_items, kicker, h1, lead, extra=''):
    ch, cld = SC.crumbs(crumb_items)
    return f'''  <section class="c-hero">
    <div class="wrap">
      {ch}
      <span class="kicker">{e(kicker)}</span>
      <h1 style="font-size:clamp(2.6rem, 6.4vw, 5.4rem)">{e(h1)}</h1>
      <p class="c-lead">{lead}</p>
      {extra}
    </div>
  </section>''', cld


def sec(kicker, h2, inner, p='', top0=True):
    return f'''  <section class="c-sec"{' style="padding-top:0"' if top0 else ''}>
    <div class="wrap">
      <div class="c-head"><span class="kicker">{e(kicker)}</span><h2>{e(h2)}</h2>{f'<p>{p}</p>' if p else ''}</div>
      {inner}
    </div>
  </section>'''


def endbox(h2, p, btns):
    return f'''  <section class="c-end">
    <div class="wrap">
      <div class="c-box">
        <span class="kicker">Aan de slag</span>
        <h2>{e(h2)}</h2>
        <p>{p}</p>
        <div class="c-cta">{btns}</div>
      </div>
    </div>
  </section>'''


def card(href, small, h3, p, price=None, go='Lees meer'):
    pr = f'<span class="h-price">{price}</span>' if price else ''
    return f'<a class="h-card" href="{href}"><small>{e(small)}</small><h3>{e(h3)}</h3><p>{e(p)}</p>{pr}<span class="h-go">{e(go)} →</span></a>'


def crumb_ld(cld, path):
    cld['itemListElement'][-1]['item'] = SC.SITE + path
    return cld


WA_BTN = lambda text, label='App Rayan': f'<a class="btn" href="{SC.wa(text)}" target="_blank" rel="noopener">{e(label)}</a>'

# ---------------------------------------------------------------- /diensten
h, cld = hero([('StrakWerk', '/'), ('Diensten', None)], 'Diensten', 'Websites, redesigns en webshops.',
              f'Ik ontwerp en bouw websites op maat voor ondernemers, vanuit Zoetermeer en voor heel Nederland. Kies een dienst, zet de functies aan die je nodig hebt en je ziet direct je prijs.')
main3 = ''.join([
    card('/diensten/website-laten-maken', 'Nieuwe website', 'Website laten maken', "Een complete website op maat tot 3 pagina's, mobiel-first, met contactformulier en WhatsApp-knop.", f'vanaf {eur(P_START)} <span>eenmalig</span>'),
    card('/diensten/website-redesign', 'Al een website', 'Website redesign', "Je bestaande site opnieuw opgebouwd in een snel, modern ontwerp. Je domein, teksten en foto's gaan mee.", f'vanaf {eur(P_RED)} <span>eenmalig</span>'),
    card('/diensten/webshop-laten-maken', 'Online verkopen', 'Webshop laten maken', 'Producten, winkelwagen en online betalen met iDEAL, met een beheerpaneel voor je producten en voorraad.', f'vanaf {eur(P_SHOP)} <span>eenmalig</span>'),
])
branches = ''.join([
    card('/diensten/website-garage', 'Garages & autobedrijven', 'Website voor garages', 'Kentekencheck via de RDW, aanvragen via WhatsApp en een pagina per dienst. Zoals bij VAGPRO en CarTronic.'),
    card('/diensten/website-sleepdienst', 'Sleep- en transportbedrijven', 'Website voor sleepdiensten', 'Pech melden in een paar tikken, met kenteken, locatie en meerdere talen. Zoals bij Sleepdienst De Tak.'),
    card('/diensten/website-kapper', 'Kappers & beauty', 'Website voor kappers en salons', 'Klanten plannen zelf hun afspraak, met reviews, routekaart en Google Bedrijfsprofiel.'),
    card('/diensten/website-horeca', 'Restaurants & horeca', 'Website voor horeca', 'Menukaart, sfeerbeelden, reviews en een routekaart, ook in de taal van je toeristen.'),
    card('/diensten/website-bouwbedrijf', 'Bouw & installatie', 'Website voor bouw en installatie', "Laat je projecten zien en ontvang offerte-aanvragen, met pagina's voor de plaatsen waar je werkt."),
])
regio = ''.join([
    card('/diensten/website-laten-maken-den-haag', 'Den Haag', 'Website laten maken in Den Haag', 'VAGPRO en Sleepdienst De Tak zitten in Den Haag. Bekijk wat ik daar bouwde.'),
    card('/diensten/website-laten-maken-rijswijk', 'Rijswijk', 'Website laten maken in Rijswijk', 'Voor CarTronic in Rijswijk bouwde ik een webshop met voertuigzoeker en beheerpaneel.'),
])
top_opts = ['beheer', 'beheerpro', 'kenteken', 'kentekenfoto', 'aanvraag', 'booking', 'taal', 'gbp']
opts = ''.join(f'<article class="f"><span class="ic">{ICON}</span><h3>{e(ITEMS[k]["name"])}</h3><p>{e(ITEMS[k]["desc"])}</p><span class="amt">{e(SC.opt_price(k))}</span></article>' for k in top_opts)
body = h + '\n' + sec('Wat ik bouw', 'Kies waar je begint.', f'<div class="h-cards">{main3}</div>', top0=False) + '\n' \
    + sec('Per branche', 'Gebouwd voor jouw branche.', f'<div class="h-cards">{branches}</div>', 'Elke branche heeft andere functies nodig. Op deze pagina\'s zie je wat er past bij jouw soort bedrijf.') + '\n' \
    + sec('In de regio', 'Vanuit Zoetermeer.', f'<div class="h-cards two">{regio}</div>', 'StrakWerk zit in Zoetermeer. Ondernemers buiten de regio help ik op afstand, via WhatsApp, telefoon en e-mail.') + '\n' \
    + sec('Functies', 'Zet erbij wat je nodig hebt.', f'<div class="feat">{opts}</div><p class="note" style="margin-top:22px">Dit is een greep uit de opties. Bekijk <a href="/prijzen" style="color:var(--gold)">alle prijzen</a> of stel je site samen in de <a href="/#prijzen" style="color:var(--gold)">calculator</a>.</p>', 'Elke optie heeft een vaste prijs, die je vooraf ziet.') + '\n' \
    + endbox('Benieuwd wat het voor jou kost?', 'Stel je website samen in de calculator en stuur je keuze met één tik via WhatsApp. Of app me, dan denk ik met je mee.',
             f'<a class="btn btn--gold" href="/#prijzen">Bereken je prijs</a>{WA_BTN("Hoi Rayan, ik wil graag weten welke dienst bij mijn bedrijf past.")}')
page('/diensten', 'Diensten: websites, redesigns en webshops | StrakWerk',
     f'Wat StrakWerk voor je bouwt: een website op maat vanaf {eur(P_START)}, een redesign vanaf {eur(P_RED)} of een webshop vanaf {eur(P_SHOP)}. Ook per branche, met vaste prijzen.',
     body, active='/diensten', ld=[crumb_ld(cld, '/diensten')])

# ---------------------------------------------------------------- /werk
h, cld = hero([('StrakWerk', '/'), ('Werk', None)], 'Werk', 'Websites die ik bouwde.',
              'Een selectie van mijn projecten. Per site zie je voor wie hij is, waar het bedrijf zit en welke functies erin zitten. Alle drie staan live.')
cards = ''.join(SC.project_card(s, eager=(i == 0), heading='h2') for i, s in enumerate(['vagpro', 'detak', 'cartronic']))
links = ''.join(f'<a href="/diensten/{s}">{e(n)}</a>' for s, n in [('website-garage', 'Website voor garages'), ('website-sleepdienst', 'Website voor sleepdiensten'),
                                                                   ('webshop-laten-maken', 'Webshop laten maken'), ('website-laten-maken-den-haag', 'Website laten maken in Den Haag'),
                                                                   ('website-laten-maken-rijswijk', 'Website laten maken in Rijswijk')])
body = h + '\n' + f'''  <section class="c-sec" style="padding-top:0">
    <div class="wrap"><div class="h-cards">{cards}</div></div>
  </section>
''' + sec('Diensten', 'Ook zoiets voor jouw bedrijf?', f'<nav class="d-more" aria-label="Diensten bij deze projecten">{links}<a href="/diensten">Alle diensten</a></nav>',
          'Deze projecten laten zien wat er kan. Op de dienstpagina\'s lees je hoe het voor jouw soort bedrijf werkt.') + '\n' \
    + endbox("Wat kost zo'n site?", 'In de calculator kies je dezelfde functies als in deze projecten en zie je direct je prijs.',
             f'<a class="btn btn--gold" href="/#prijzen">Bereken je prijs</a>{WA_BTN("Hoi Rayan, ik zag je projecten en wil graag een website.")}')
page('/werk', 'Werk: websites gebouwd door StrakWerk',
     'Bekijk websites die StrakWerk bouwde: VAGPRO met kentekencheck, Sleepdienst De Tak met aanvragen via WhatsApp in drie talen, en de webshop van CarTronic.',
     body, active='/werk', ld=[crumb_ld(cld, '/werk'),
                              {"@context": "https://schema.org", "@type": "CollectionPage", "name": "Werk van StrakWerk", "url": SC.SITE + '/werk',
                               "hasPart": [{"@type": "WebPage", "name": SC.PROJECTS[s]['name'], "url": f"{SC.SITE}/werk/{s}"} for s in ['vagpro', 'detak', 'cartronic']]}],
     tint='rgba(120,110,255,.14)')

# ---------------------------------------------------------------- /prijzen
promo_on = True  # de actie verdwijnt via data-until/inline script vanzelf, net als de promo-strip


def incl_list(key):
    own = BASES[key].get('incl') or {}
    out = []
    for oid, n in own.items():
        it = ITEMS[oid]
        out.append((f'{n}× ' if it.get('qty') and n > 1 else '') + it['name'])
    return out


def loose_value(key):
    own = BASES[key].get('incl') or {}
    return P_START + sum(ITEMS[oid]['price'] * n for oid, n in own.items())


pk = []
for key, top in [('nieuw', False), ('premium', True), ('pro', False), ('redesign', False)]:
    b = BASES[key]
    if key == 'nieuw':
        lis = INCL[:6]
    elif key == 'redesign':
        lis = ["Je bestaande site opnieuw opgebouwd", "Strak, snel en mobiel ontwerp", "Je teksten en foto's gaan mee", "Je domein blijft, je e-mail blijft werken"]
    else:
        lis = ['Alles van Starter'] + incl_list(key)
    save = loose_value(key) - b['price'] if b.get('incl') else 0
    note = f'<p>Losse waarde {eur(loose_value(key))}, je bespaart {eur(save)}.</p>' if save > 0 else ''
    pk.append(f'''<article class="pk-c{' top' if top else ''}"><small>{e(b['sub'])}</small><h3>{e(b['name'])}</h3><div class="pk-p">{eur(b['price'])}<span>eenmalig</span></div><p>{e(b['pitch'])}.</p>{note}<ul>{''.join(f'<li>{e(x)}</li>' for x in lis)}</ul><a class="btn{' btn--gold' if top else ''}" href="/?cfg={key}#prijzen">Kies {e(b['name'])}</a></article>''')
groups = ''.join(f'''<div class="pt-g"><h3>{e(g['title'])}</h3><table class="pt"><tbody>{''.join(f'<tr><th scope="row">{e(it["name"])}</th><td>{e(it["desc"])}</td><td class="p">{e(SC.opt_price(it["id"]))}</td></tr>' for it in g['items'])}</tbody></table></div>''' for g in C['groups'])
promo = C.get('promo') or {}
promo_box = ''
if promo:
    free = ' en '.join(ITEMS[k]['name'].replace('Logo-ontwerp', 'logo-ontwerp') for k in promo['free'])
    promo_box = (f'<p class="art-tip art-promo" style="margin-top:22px" data-until="{promo["until"]}"><strong>{e(promo["label"])}:</strong> {e(free)} gratis bij elke website.</p>'
                 f'<script>if(Date.now()>=Date.parse("{promo["until"]}"))document.currentScript.previousElementSibling.remove()</script>')
faq = [("Wat is het verschil tussen Starter, Premium en Pro?", f"Starter ({eur(P_START)}) is een complete website tot 3 pagina's. Premium ({eur(BASES['premium']['price'])}) voegt daar onder meer een beheerpaneel, aanvragen via WhatsApp, Google reviews en je Bedrijfsprofiel aan toe. Pro ({eur(BASES['pro']['price'])}) heeft het geavanceerde beheerpaneel, een extra taal, een blog, een logo en regiopagina's. Bij elk pakket kun je losse opties bijzetten."),
       (f"Wat krijg ik voor {eur(P_START)}?", "Een complete website tot 3 pagina's: mobiel-first, met contactformulier, WhatsApp-knop, basis-SEO en je eigen domein met SSL. Alles daarbovenop kies je zelf bij de opties."),
       ("Kan ik later nog opties toevoegen?", "Altijd. Je betaalt dan alleen de prijs van de optie die je erbij neemt."),
       ("Ik heb al een website. Wat kost vernieuwen?", f"Een website redesign start op {eur(P_RED)}. Ik bouw je site opnieuw op en neem je teksten en foto's mee. Je bestaande domein koppel ik aan de nieuwe site en je e-mail blijft gewoon werken."),
       ("Zijn er kosten per maand?", f"In de calculator staan twee maandelijkse opties: {ITEMS['onderhoud']['name']} ({SC.opt_price('onderhoud')}: {ITEMS['onderhoud']['desc'][0].lower() + ITEMS['onderhoud']['desc'][1:-1]}) en {ITEMS['onderhoudplus']['name']} ({SC.opt_price('onderhoudplus')}: {ITEMS['onderhoudplus']['desc'][0].lower() + ITEMS['onderhoudplus']['desc'][1:-1]}). Wat er voor jouw site nodig is, bespreken we in de intake.")]
faq_html = ''.join(f'<details><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q, a in faq)
h, cld = hero([('StrakWerk', '/'), ('Prijzen', None)], 'Prijzen', 'Vaste prijzen, vooraf bekend.',
              f'Kies een pakket of begin met Starter en zet zelf de opties aan die je nodig hebt. Elke optie heeft een vaste prijs, dus je weet vooraf wat je website kost.',
              extra=f'<div class="c-cta"><a class="btn btn--gold" href="/#prijzen">Stel je website samen</a>{WA_BTN("Hoi Rayan, ik heb een vraag over de prijzen.", "Vraag het Rayan")}</div>')
body = h + '\n' + f'''  <section class="c-sec" style="padding-top:0">
    <div class="wrap">
      <div class="c-head"><span class="kicker">Pakketten</span><h2>Vier pakketten.</h2><p>Bij elk pakket kun je losse opties bijzetten. Een pakket is voordeliger dan dezelfde opties los.</p></div>
      <div class="pk">{''.join(pk)}</div>
      {promo_box}
    </div>
  </section>
''' + sec('Altijd inbegrepen', 'Dit zit in elke website.', f'<ul class="d-incl">{"".join(f"<li>{e(x)}</li>" for x in INCL)}</ul>') + '\n' \
    + sec('Losse opties', 'Alle opties en prijzen.', f'<div class="pt-wrap">{groups}</div>', 'Deze prijzen zijn dezelfde als in de calculator op de homepage.') + '\n' \
    + sec('Vragen', 'Vragen over de prijs.', f'<div class="d-faq">{faq_html}</div>', 'Meer achtergrond lees je in <a href="/kennisbank/wat-kost-een-website" style="color:var(--gold)">Wat kost een website in 2026?</a>') + '\n' \
    + endbox('Zie direct je totaal.', 'In de calculator stel je je website samen en zie je je totaalprijs. Je keuze stuur je met één tik via WhatsApp, of je bewaart hem als PDF.',
             f'<a class="btn btn--gold" href="/#prijzen">Bereken je prijs</a>{WA_BTN("Hoi Rayan, ik heb een vraag over de prijzen.")}')
page('/prijzen', 'Prijzen: websites vanaf €200, vaste prijzen | StrakWerk'.replace('€200', eur(P_START)),
     f"Alle prijzen van StrakWerk op een rij: Starter {eur(P_START)}, Premium {eur(BASES['premium']['price'])}, Pro {eur(BASES['pro']['price'])} en redesign {eur(P_RED)}, plus de vaste prijs van elke optie.",
     body, active='/prijzen', ld=[crumb_ld(cld, '/prijzen')])

# ---------------------------------------------------------------- /over-mij
h, cld = hero([('StrakWerk', '/'), ('Over mij', None)], 'Over mij', 'Hoi, ik ben Rayan.',
              'Achter StrakWerk zit geen groot bureau, maar ik. StrakWerk is mijn webdesignbedrijf in Zoetermeer: ik ontwerp en bouw elke website zelf, voor ondernemers in heel Nederland.')
story = '''<div class="d-hero" style="align-items:start">
        <div class="d-text">
          <p>Ik ontwerp en bouw elke website zelf, van het eerste idee tot de dag dat hij live staat.</p>
          <p>Ik ben met StrakWerk begonnen omdat ik zag hoe vaak ondernemers vastzitten aan een standaard template, of duizenden euro's kwijt zijn bij een bureau. Dat kan slimmer. Ik combineer een strak ontwerp met techniek die echt iets voor je doet, zoals een kentekencheck via de RDW of een beheerpaneel waarin je zelf alles aanpast.</p>
          <p>Geen accountmanager ertussen en geen wachtrij: je appt mij en je praat direct met degene die je site bouwt.</p>
        </div>
        <figure class="about-fig"><img src="/assets/setup.webp" alt="De werkplek van Rayan: drie schermen met code op een houten bureau" width="1600" height="1200" loading="lazy"><figcaption>Hier wordt je site gebouwd</figcaption></figure>
      </div>'''
expect = ''.join(f'<article class="f"><span class="ic">{ICON}</span><h3>{e(t)}</h3><p>{e(d)}</p></article>' for t, d in [
    ('Eén vast aanspreekpunt', 'Van intake tot oplevering praat je met dezelfde persoon: degene die je site bouwt.'),
    ('Direct contact', 'Gewoon via WhatsApp, telefoon of e-mail. Je hoort dezelfde dag van me.'),
    ('Vaste prijzen', 'Vooraf bekend, zonder verrassingen. Elke optie heeft een vaste prijs.'),
    ('Op maat gebouwd', 'Geen standaard template, maar een ontwerp dat past bij jouw bedrijf.'),
    ('Mobiel-first', 'Gebouwd voor de telefoon, waar de meeste bezoekers je site bekijken.'),
    ('Zelf aanpassen kan', 'Met een beheerpaneel pas je zelf teksten en foto\'s aan. Probeer het in de demo.')])
steps = ''.join(f'<article class="f"><small style="font:600 .74rem var(--f-mono); letter-spacing:.12em; text-transform:uppercase; color:var(--gold)">{e(k)}</small><h3>{e(t)}</h3><p>{e(d)}</p></article>' for k, t, d in [
    ('Gratis', 'Intake', 'Een kort gesprek of WhatsApp over je bedrijf, je doel en de functies die je nodig hebt. Je weet direct waar je aan toe bent.'),
    ('Jij geeft feedback', 'Ontwerp', 'Je krijgt een eerste versie die je op je eigen telefoon bekijkt. Niet goed? Dan pas ik het aan tot het klopt.'),
    ('Op maat gebouwd', 'Development', 'Snel, mobiel-first en vindbaar in Google. Functies zoals de kentekencheck of het beheerpaneel bouw ik erin.'),
    ('Binnen 7 dagen', 'Live & support', 'Je site gaat online op je eigen domein. Daarna help ik met updates, of pas je het zelf aan.')])
projs = ''.join(SC.project_card(s) for s in ['vagpro', 'detak', 'cartronic'])
body = h + '\n' + f'''  <section class="c-sec" style="padding-top:0">
    <div class="wrap">
      {story}
    </div>
  </section>
''' + sec('Wat je kunt verwachten', 'Zo werk ik.', f'<div class="feat">{expect}</div>') + '\n' \
    + sec('Werkwijze', 'Van eerste appje tot live site.', f'<div class="steps">{steps}</div><p class="note" style="margin-top:22px">Wat heb ik van jou nodig? Lees de <a href="/kennisbank/checklist-website-laten-maken" style="color:var(--gold)">checklist voor je website</a>.</p>') + '\n' \
    + sec('Projecten', 'Wat ik bouwde.', f'<div class="h-cards">{projs}</div>') + '\n' \
    + endbox('Zullen we iets strak bouwen?', 'Stuur een appje met wat je zoekt. Je hoort dezelfde dag van me.',
             f'<a class="btn btn--gold" href="{SC.wa("Hoi Rayan, ik wil graag een website.")}" target="_blank" rel="noopener">App Rayan</a><a class="btn" href="/#prijzen">Bereken je prijs</a>')
page('/over-mij', 'Over mij: Rayan van StrakWerk | Webdesign uit Zoetermeer',
     'Achter StrakWerk zit geen groot bureau, maar Rayan. Ik ontwerp en bouw elke website zelf, vanuit Zoetermeer. Zo werk ik en dit kun je van me verwachten.',
     body, active='/over-mij', ld=[crumb_ld(cld, '/over-mij'),
                                  {"@context": "https://schema.org", "@type": "AboutPage", "name": "Over StrakWerk", "url": SC.SITE + '/over-mij', "about": {"@id": SC.ORG_ID}}])

# ---------------------------------------------------------------- /contact
h, cld = hero([('StrakWerk', '/'), ('Contact', None)], 'Contact', 'Contact met StrakWerk.',
              'Stuur een appje met wat je zoekt, bel even of stuur een mail. Je hoort dezelfde dag van me, en het intakegesprek is gratis.')
cts = f'''<div class="ct-grid">
        <div class="ct"><small>WhatsApp</small><b>{SC.TEL_TXT}</b><p>Het snelst: stuur een appje met wat je zoekt.</p><a class="btn btn--gold" href="{SC.wa("Hoi Rayan, ik wil graag een website.")}" target="_blank" rel="noopener">App Rayan</a></div>
        <div class="ct"><small>Telefoon</small><b>{SC.TEL_TXT}</b><p>Liever even bellen? Dat kan op hetzelfde nummer.</p><a class="btn" href="tel:{SC.TEL}">Bel direct</a></div>
        <div class="ct"><small>E-mail</small><b>{SC.MAIL}</b><p>Handig als je bijlagen of een uitgebreide vraag hebt.</p><a class="btn" href="mailto:{SC.MAIL}?subject={SC.quote("Vraag over een website")}">Stuur een mail</a></div>
      </div>'''
form = f'''<form class="form ct" id="lead" novalidate>
        <div class="c-grid2"><div class="field"><label for="f-naam">Naam</label><input id="f-naam" autocomplete="name" placeholder="Je naam"></div>
        <div class="field"><label for="f-bedrijf">Bedrijf</label><input id="f-bedrijf" autocomplete="organization" placeholder="Bedrijfsnaam"></div></div>
        <div class="field"><label for="f-type">Waar ben je naar op zoek?</label><select id="f-type"><option>Een nieuwe website</option><option>Een webshop</option><option>Mijn huidige site vernieuwen</option><option>Een extra functie op mijn site</option><option>Iets anders</option></select></div>
        <div class="field"><label for="f-msg">Bericht</label><textarea id="f-msg" placeholder="Bijvoorbeeld: ik heb een garage en wil een site met kentekencheck."></textarea></div>
        <a class="btn btn--gold" id="f-send" href="https://wa.me/{SC.WA}" target="_blank" rel="noopener">Verstuur via WhatsApp</a>
        <p class="note">Je bericht opent in WhatsApp, klaar om te versturen. Liever e-mail? <a id="f-mail" href="mailto:{SC.MAIL}" style="color:var(--gold)">Verstuur via e-mail</a></p>
      </form>'''
where = f'''<div class="d-text">
        <p>StrakWerk is een webdesignbedrijf uit Zoetermeer. Ik werk voor ondernemers in Zoetermeer, Den Haag, Rijswijk, Delft, het Westland en de rest van Nederland, op afstand.</p>
        <p>Projecten in de buurt: <a href="/werk/vagpro" style="color:var(--gold)">VAGPRO</a> en <a href="/werk/detak" style="color:var(--gold)">Sleepdienst De Tak</a> in Den Haag, en <a href="/werk/cartronic" style="color:var(--gold)">CarTronic</a> in Rijswijk.</p>
      </div>'''
nexts = ''.join(f'<article class="f"><small style="font:600 .74rem var(--f-mono); letter-spacing:.12em; text-transform:uppercase; color:var(--gold)">{e(k)}</small><h3>{e(t)}</h3><p>{e(d)}</p></article>' for k, t, d in [
    ('Dezelfde dag', 'Je bericht', 'Je stuurt een appje, belt of mailt. Je hoort dezelfde dag van me.'),
    ('Gratis', 'Intake', 'Een kort gesprek of WhatsApp over je bedrijf, je doel en de functies die je nodig hebt.'),
    ('Vooraf bekend', 'Vaste prijs', 'Je weet direct waar je aan toe bent: elke optie heeft een vaste prijs, die je ook zelf in de calculator ziet.')])
body = h + '\n' + f'''  <section class="c-sec" style="padding-top:0">
    <div class="wrap">
      {cts}
    </div>
  </section>
''' + sec('Bericht', 'Vertel kort wat je zoekt.', form, 'Vul in wat je weet. Je bericht gaat via WhatsApp of e-mail, er wordt niets op deze site opgeslagen.') + '\n' \
    + sec('Na je bericht', 'Zo gaat het verder.', f'<div class="feat">{nexts}</div>') + '\n' \
    + sec('Waar', 'Vanuit Zoetermeer.', where) + '\n' \
    + endbox('Eerst zelf rekenen?', 'Stel je website samen in de calculator en stuur je keuze met één tik via WhatsApp.',
             '<a class="btn btn--gold" href="/#prijzen">Bereken je prijs</a><a class="btn" href="/prijzen">Bekijk alle prijzen</a>')
page('/contact', 'Contact | StrakWerk, webdesign uit Zoetermeer',
     f'Neem contact op met StrakWerk, webdesign uit Zoetermeer: app of bel {SC.TEL_TXT} of mail {SC.MAIL}. Je hoort dezelfde dag van me.',
     body, active='/contact', ld=[crumb_ld(cld, '/contact'),
                                 {"@context": "https://schema.org", "@type": "ContactPage", "name": "Contact met StrakWerk", "url": SC.SITE + '/contact', "about": {"@id": SC.ORG_ID}}])
print('ok hubs')
