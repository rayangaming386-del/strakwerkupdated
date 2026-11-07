import sys; import os as _os; _T=_os.path.dirname(_os.path.abspath(__file__)); sys.path.insert(0, _T); import site_common as SC
import html, os, json
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
IC={
 'plate':'<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 12h.01M10 12h8"/>',
 'wa':'<path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z"/>',
 'pages':'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
 'handshake':'<path d="M8 12l3 3 5-5"/><circle cx="12" cy="12" r="9"/>',
 'phone':'<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
 'globe':'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
 'pin':'<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
 'map':'<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
 'book':'<path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4z"/><path d="M8 8h6"/>',
 'cam':'<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8 7l2-3h4l2 3"/>',
 'cart':'<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11.5l2-8H6"/>',
 'car':'<path d="M5 16l1.5-5A2 2 0 0 1 8.4 9.5h7.2a2 2 0 0 1 1.9 1.5L19 16"/><rect x="3" y="16" width="18" height="4" rx="1.5"/>',
 'panel':'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M13 9h5M13 13h5"/>',
 'box':'<path d="M3 7l9-4 9 4v10l-9 4-9-4V7z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
 'video':'<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
}
P=[
 dict(slug='vagpro', name='VAGPRO', title='VAGPRO: website met kentekencheck | StrakWerk',
  desc='Voor VAG-specialist VAGPRO in Den Haag bouwde StrakWerk een website met kentekencheck via de RDW, aanvragen via WhatsApp en een pagina per dienst.',
  serv=[('website-garage','Website voor garages'),('website-laten-maken','Website laten maken'),('website-laten-maken-den-haag','Website laten maken in Den Haag')], kind=['Autospecialist','Den Haag'], tint='rgba(255,110,40,.16)', live='https://vagpro.nl', preset='vagpro',
  lead='Een onafhankelijke VAG-specialist voor Volkswagen, Audi, SEAT, Škoda en Cupra. De site laat zien wat de werkplaats kan en zet bezoekers met één kenteken direct op het goede spoor.',
  shots=[('vagpro.webp','Home'),('vagpro-over.webp','Over'),('vagpro-zakelijk.webp','Zakelijk'),('vagpro-contact.webp','Contact')],
  mobile='vagpro-mobiel.webp',
  feats=[('plate','Kentekencheck via de RDW','Bezoekers vullen hun kenteken in en zien direct merk, model en bouwjaar. Zo weten ze meteen of hun auto erbij hoort.'),
         ('wa','Aanvraag via WhatsApp','Het contactformulier stuurt de aanvraag kant-en-klaar door naar WhatsApp, inclusief de gegevens van de auto.'),
         ('pages','Pagina per dienst','Achteruitrijcamera, CarPlay en Android Auto, codering en storingsdiagnose hebben elk een eigen pagina.'),
         ('handshake','Zakelijke pagina','Een aparte pagina voor garages, dealers en specialisten die VAG-werk willen uitbesteden.'),
         ('phone','Mobiel eerst','Gebouwd voor de telefoon: grote knoppen, snel laden en direct bellen of appen.'),
         ('pin','Lokaal vindbaar','Technische SEO en lokale gegevens, zodat de werkplaats in Den Haag goed gevonden wordt.')]),
 dict(slug='detak', name='Sleepdienst De Tak', title='Sleepdienst De Tak: website in drie talen | StrakWerk',
  desc='Sleepdienst De Tak uit Den Haag: hulp aanvragen via WhatsApp met kenteken en locatie, in drie talen en met regiopagina\'s. Gebouwd door StrakWerk.',
  serv=[('website-sleepdienst','Website voor sleepdiensten'),('website-garage','Website voor garages'),('website-laten-maken-den-haag','Website laten maken in Den Haag')], kind=['Sleep- en bergingsdienst','Den Haag'], tint='rgba(245,196,0,.16)', live='https://sleepdienstdetak.nl', preset='detak',
  lead='Een sleepdienst die dag en nacht klaarstaat. Bij pech telt elke minuut, dus de site is gebouwd om in een paar tikken hulp aan te vragen, in drie talen.',
  shots=[('detak.webp','Home NL'),('detak-de.webp','Home DE'),('detak-aanvraag.webp','Aanvraag'),('detak-werkgebied.webp','Werkgebied'),('detak-onderweg.webp','Onderweg')],
  mobile='detak-mobiel.webp',
  feats=[('wa','Pech melden via WhatsApp','Kies pech, transport of verkopen, vul je kenteken in en je aanvraag staat netjes in WhatsApp.'),
         ('plate','Kentekencheck en herkenning','Typ het kenteken of maak er een foto van: merk, model en bouwjaar verschijnen direct, zodat de sleepdienst weet wat er opgehaald moet worden.'),
         ('pin','Gebruik mijn locatie','Met één knop deelt de klant zijn locatie, handig langs de snelweg of in een onbekende straat.'),
         ('globe','Nederlands, Engels en Duits','De hele site in drie talen, voor klanten en chauffeurs uit het buitenland.'),
         ('map','Werkgebied en regiopagina\'s','Pagina\'s per plaats en een kaart van het werkgebied, van Den Haag tot heel Europa.'),
         ('book','Kennisbank en FAQ','Antwoorden op veelgestelde vragen, goed voor bezoekers en voor Google.')]),
 dict(slug='cartronic', name='CarTronic', title='CarTronic: webshop met voertuigzoeker | StrakWerk',
  desc='Voor retrofit-specialist CarTronic in Rijswijk bouwde StrakWerk een webshop met iDEAL, een voertuigzoeker per merk en model en een geavanceerd beheerpaneel.',
  serv=[('webshop-laten-maken','Webshop laten maken'),('website-garage','Website voor garages'),('website-laten-maken-rijswijk','Website laten maken in Rijswijk')], kind=['Retrofit & webshop','Rijswijk'], tint='rgba(120,110,255,.18)', live='https://cartronic.nl', preset='cartronic',
  lead='Een retrofit-specialist voor originele fabrieksopties. Met een complete webshop, een voertuigzoeker per merk en model, en een beheerpaneel waarin de eigenaar zelf alles aanpast.',
  shots=[('cartronic.webp','Home'),('cartronic-dashboard.webp','Beheer'),('cartronic-merken.webp','Merken'),('cartronic-videos.webp','Video\'s'),('cartronic-contact.webp','Contact')],
  mobile='cartronic-mobiel.webp', extra=('cartronic-beheer.webp','Beheermenu'),
  feats=[('cart','Webshop met iDEAL','Producten, winkelwagen en online betalen, met bestellingen die direct in het beheerpaneel binnenkomen.'),
         ('car','Voertuigzoeker','Klanten kiezen hun merk en model, of zoeken op kenteken, en zien alleen de opties die op hun auto passen.'),
         ('panel','Geavanceerd beheerpaneel','Producten, merken en modellen, diensten, teksten, SEO en portfolio: de eigenaar past alles zelf aan.'),
         ('box','Voorraad en acties','Het dashboard toont lage voorraad, openstaande bestellingen en lopende acties in één oogopslag.'),
         ('video','Portfolio en video\'s','Werk uit de werkplaats in beeld, met projecten en video\'s die de eigenaar zelf toevoegt.'),
         ('pages','Pagina\'s per merk','Volkswagen, Audi, SEAT en Škoda met hun modellen, overzichtelijk en goed vindbaar.')]),
]
def svg(k): return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{IC[k]}</svg>'
ARROW='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
for i,p in enumerate(P):
    nxt=P[(i+1)%len(P)]
    e=html.escape
    imgs=''.join(f'<img src="../assets/work/{f}" alt="{e(p["name"])}: {e(l)}" {"class=\"on\" " if j==0 else ""}loading="{"eager" if j==0 else "lazy"}">' for j,(f,l) in enumerate(p['shots']))
    tabs=''.join(f'<button type="button" aria-pressed="{"true" if j==0 else "false"}">{e(l)}</button>' for j,(f,l) in enumerate(p['shots']))
    feats=''.join(f'<article class="f"><span class="ic">{svg(k)}</span><h3>{e(t)}</h3><p>{e(d)}</p></article>' for k,t,d in p['feats'])
    gal=f'<figure class="p"><img src="../assets/work/{p["mobile"]}" alt="{e(p["name"])} op mobiel" loading="lazy"><figcaption>Mobiel</figcaption></figure>'
    rest=p['shots'][1:]
    if 'extra' in p: gal+=f'<figure class="wide"><img src="../assets/work/{p["shots"][1][0]}" alt="{e(p["name"])}: {e(p["shots"][1][1])}" loading="lazy"><figcaption>{e(p["shots"][1][1])}</figcaption></figure><figure class="p"><img src="../assets/work/{p["extra"][0]}" alt="{e(p["name"])}: {e(p["extra"][1])}" loading="lazy" style="object-position:top"><figcaption>{e(p["extra"][1])}</figcaption></figure><figure class="d" style="grid-column:span 9"><img src="../assets/work/{p["shots"][0][0]}" alt="{e(p["name"])}: {e(p["shots"][0][1])}" loading="lazy"><figcaption>{e(p["shots"][0][1])}</figcaption></figure>'
    if 'extra' in p:
        more=p['shots'][2:]
        gal+=''.join(f'<figure class="d"{' style="grid-column:span 12"' if k==len(more)-1 and len(more)%2 else ''}><img src="../assets/work/{f}" alt="{e(p["name"])}: {e(l)}" loading="lazy"><figcaption>{e(l)}</figcaption></figure>' for k,(f,l) in enumerate(more))
    else:
        gal=f'<figure class="wide"><img src="../assets/work/{rest[0][0]}" alt="{e(p["name"])}: {e(rest[0][1])}" loading="lazy"><figcaption>{e(rest[0][1])}</figcaption></figure>'+gal
        gal+=''.join(f'<figure class="d"><img src="../assets/work/{f}" alt="{e(p["name"])}: {e(l)}" loading="lazy"><figcaption>{e(l)}</figcaption></figure>' for f,l in rest[1:])
    title=p['title']; desc=p['desc']; url=f"https://www.strakwerkk.nl/werk/{p['slug']}"
    ch,cld=SC.crumbs([('StrakWerk','/'),('Werk','/werk'),(p['name'],None)])
    cld['itemListElement'][-1]['item']=url
    servl=''.join(f'<a href="/diensten/{s_}">{e(n_)}</a>' for s_,n_ in p['serv'])
    doc=f'''<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<meta name="theme-color" content="#0B0E13">
<link rel="canonical" href="https://www.strakwerkk.nl/werk/{p['slug']}">
<meta property="og:type" content="article">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:image" content="https://www.strakwerkk.nl/assets/work/{p['shots'][0][0]}">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="../assets/fonts/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="../assets/fonts/fonts.css">
<link rel="stylesheet" href="../assets/case.css">
<script type="application/ld+json">{json.dumps(cld, ensure_ascii=False)}</script>
<script>window.va=window.va||function(){{(window.vaq=window.vaq||[]).push(arguments)}};</script>
<script defer src="/_vercel/insights/script.js"></script>
</head>
<body style="--tint:{p['tint']}">
<a class="promo-strip" href="/#prijzen" data-until="2026-12-01T00:00:00+01:00"><b>Actie</b><span class="l">Gratis logo en Google Bedrijfsprofiel bij elke website</span><span class="s">Gratis logo + profiel</span><em data-cd>t/m 30 november</em></a><script>if(Date.now()>=Date.parse("2026-12-01T00:00:00+01:00"))document.currentScript.previousElementSibling.remove()</script>
{SC.header(active='/werk', cta=(f"/?preset={p['preset']}#prijzen", "Wat kost zo'n site?"))}
<main>
  <section class="c-hero">
    <div class="wrap">
      {ch}
      <span class="kicker">Project</span>
      <h1>{e(p['name'])}</h1>
      <div class="c-kind">{''.join(f'<span>{e(k)}</span>' for k in p['kind'])}</div>
      <p class="c-lead">{e(p['lead'])}</p>
      <div class="c-cta"><a class="btn btn--gold" href="{p['live']}" target="_blank" rel="noopener">Bekijk live ↗</a><a class="btn" href="../?preset={p['preset']}#prijzen">Bereken zo'n site</a></div>
    </div>
  </section>
  <section class="c-stage" aria-label="Schermafbeeldingen">
    <div class="wrap">
      <div class="win"><div class="screen">{imgs}</div></div>
      {f'<div class="tabs" role="group" aria-label="Pagina kiezen">{tabs}</div>' if len(p['shots'])>1 else ''}
    </div>
  </section>
  <section class="c-sec">
    <div class="wrap">
      <div class="c-head"><span class="kicker">Wat er gebouwd is</span><h2>Op maat, tot in de details.</h2><p>De functies die deze site voor {e(p['name'])} laten werken.</p></div>
      <div class="feat">{feats}</div>
      <div class="c-head" style="margin:clamp(40px, 6vw, 64px) 0 18px"><span class="kicker">Diensten in dit project</span></div>
      <nav class="d-more" aria-label="Diensten in dit project">{servl}</nav>
    </div>
  </section>
  <section class="c-sec" style="padding-top:0">
    <div class="wrap">
      <div class="c-head"><span class="kicker">In beeld</span><h2>Desktop en mobiel.</h2><p>Klik op een afbeelding om hem groot te bekijken.</p></div>
      <div class="gal">{gal}</div>
    </div>
  </section>
  <section class="c-end">
    <div class="wrap">
      <div class="c-box">
        <span class="kicker">Jouw project</span>
        <h2>Ook zo'n site voor jouw bedrijf?</h2>
        <p>Stel je site samen met dezelfde opties en zie direct wat het kost. Of stuur een appje, dan denk ik met je mee.</p>
        <div class="c-cta"><a class="btn btn--gold" href="../?preset={p['preset']}#prijzen">Bereken je prijs</a><a class="btn" href="https://wa.me/31623462397?text={quote('Hoi Rayan, ik zag het project van '+p['name']+' en wil ook zo\'n website.')}" target="_blank" rel="noopener">App Rayan</a></div>
      </div>
      <nav class="next" aria-label="Volgend project"><a href="{nxt['slug']}"><small>Volgend project</small><b>{e(nxt['name'])}</b></a><a class="arrow" href="{nxt['slug']}" aria-label="Naar {e(nxt['name'])}">{ARROW}</a></nav>
    </div>
  </section>
</main>
{SC.footer()}
<div class="lb" id="lb" hidden><img alt=""></div>
<script src="../assets/js/gsap.min.js"></script>
<script src="../assets/js/ScrollTrigger.min.js"></script>
<script src="../assets/js/SplitText.min.js"></script>
<script src="../assets/js/lenis.min.js"></script>
<script src="../assets/case.js"></script>
</body>
</html>
'''
    open(f'{ROOT}/werk/{p["slug"]}.html','w').write(add_ss(doc))
print('ok')
