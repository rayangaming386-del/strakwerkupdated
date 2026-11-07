"""Gedeelde onderdelen voor alle subpagina's van strakwerkk.nl (menu, footer, kruimelpad, CONFIG-prijzen).
Gebruikt door gen_cases.py, gen_diensten.py, gen_kennis.py en gen_hubs.py."""
import html, json, subprocess, re, os
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://www.strakwerkk.nl'
ORG_ID = SITE + '/#organisatie'
WA = '31623462397'
TEL = '+31623462397'
TEL_TXT = '06 2346 2397'
MAIL = 'strakwerkk@gmail.com'
CITY = 'Zoetermeer'
PROMO_UNTIL = '2026-12-01T00:00:00+01:00'
e = html.escape


def config():
    """Leest het CONFIG-blok uit index.html, zodat prijzen op subpagina's altijd gelijk zijn aan de calculator."""
    s = open(ROOT + '/index.html', encoding='utf-8').read()
    i = s.index('const CONFIG = {') + len('const CONFIG = ')
    j = s.index('\n};', i) + 2
    js = 'const C = ' + s[i:j] + '; process.stdout.write(JSON.stringify(C));'
    return json.loads(subprocess.run(['node', '-e', js], capture_output=True, text=True, check=True).stdout)


C = config()
ITEMS = {it['id']: it for g in C['groups'] for it in g['items']}
BASES = C['bases']


def eur(n):
    return '€' + (str(int(n)) if float(n).is_integer() else f'{n:.2f}'.replace('.', ','))


def opt_price(oid):
    it = ITEMS[oid]
    if it.get('monthly'):
        return f"{eur(it['price'])} per maand"
    if it.get('qty'):
        return f"+{eur(it['price'])} per {it.get('unit', 'stuk')}"
    return f"+{eur(it['price'])}"


def wa(text):
    return f'https://wa.me/{WA}?text={quote(text)}'


NAV = [('/werk', 'Werk'), ('/diensten', 'Diensten'), ('/prijzen', 'Prijzen'), ('/over-mij', 'Over mij'), ('/contact', 'Contact')]


def promo_strip():
    return (f'<a class="promo-strip" href="/#prijzen" data-until="{PROMO_UNTIL}"><b>Actie</b><span class="l">Gratis logo en Google Bedrijfsprofiel bij elke website</span>'
            f'<span class="s">Gratis logo + profiel</span><em data-cd>t/m 30 november</em></a>'
            f'<script>if(Date.now()>=Date.parse("{PROMO_UNTIL}"))document.currentScript.previousElementSibling.remove()</script>')


def header(active='', cta=('/#prijzen', 'Bereken je prijs'), page=''):
    """active = '/werk', '/diensten', ... (sectie), page = exacte URL van deze pagina (voor aria-current)."""
    def link(href, label):
        cur = ' aria-current="page"' if href == page else ''
        cls = ' class="on"' if href == active else ''
        return f'<a href="{href}"{cls}{cur}>{e(label)}</a>'
    nav = ''.join(link(h, l) for h, l in NAV)
    extra = (f'<a href="/kennisbank">Kennisbank</a><a href="/demo">Demo beheerpaneel</a>'
             f'<a class="sm-wa" href="{wa("Hoi Rayan, ik heb een vraag over een website.")}" target="_blank" rel="noopener">WhatsApp mij</a>')
    return f'''<header class="top">
  <div class="wrap">
    <a class="brand" href="/" aria-label="StrakWerk, naar de homepage"><span class="strak">STRAK</span><span>WERK</span></a>
    <nav class="snav" aria-label="Hoofdmenu">{nav}</nav>
    <div class="top-r"><a class="btn btn--gold" href="{cta[0]}"><span class="cl">{e(cta[1])}</span><span class="cs">Je prijs</span></a><details class="smenu"><summary>Menu</summary><nav class="smenu-p" aria-label="Menu">{nav}{extra}</nav></details></div>
  </div>
</header>'''


def crumbs(items):
    """items = [(naam, url-of-None)], eerste is altijd StrakWerk. Geeft (html, json-ld-dict)."""
    parts = []
    for i, (name, url) in enumerate(items):
        if i: parts.append('<span aria-hidden="true">/</span>')
        parts.append(f'<a href="{url}">{e(name)}</a>' if url and i < len(items) - 1 else f'<span aria-current="page">{e(name)}</span>')
    h = f'<nav class="crumbs" aria-label="Kruimelpad">{"".join(parts)}</nav>'
    ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        dict({"@type": "ListItem", "position": i + 1, "name": name}, **({"item": SITE + (url if url != '/' else '/')} if url else {}))
        for i, (name, url) in enumerate(items)]}
    return h, ld


DIENSTEN = [('website-laten-maken', 'Website laten maken'), ('website-redesign', 'Website redesign'), ('webshop-laten-maken', 'Webshop laten maken'),
            ('website-garage', 'Website voor garages'), ('website-sleepdienst', 'Website voor sleepdiensten'), ('website-kapper', 'Website voor kappers & beauty'),
            ('website-horeca', 'Website voor horeca'), ('website-bouwbedrijf', 'Website voor bouw & installatie')]
STEDEN = [('website-laten-maken-den-haag', 'Den Haag'), ('website-laten-maken-rijswijk', 'Rijswijk')]


def footer():
    serv = ''.join(f'<a href="/diensten/{s}">{e(n)}</a>' for s, n in DIENSTEN)
    steden = ''.join(f'<a href="/diensten/{s}">Website laten maken in {e(c)}</a>' for s, c in STEDEN)
    return f'''<footer class="sfoot">
  <div class="wrap sf-grid">
    <div class="sf-brand">
      <a class="brand" href="/" aria-label="StrakWerk, naar de homepage"><span class="strak">STRAK</span><span>WERK</span></a>
      <p>Webdesign uit {CITY}. Websites op maat vanaf {eur(BASES['nieuw']['price'])}, voor ondernemers in heel Nederland.</p>
      <p class="sf-c"><a href="{wa("Hoi Rayan, ik heb een vraag over een website.")}" target="_blank" rel="noopener">WhatsApp</a><a href="tel:{TEL}">{TEL_TXT}</a><a href="mailto:{MAIL}?subject={quote("Vraag over een website")}">{MAIL}</a></p>
    </div>
    <nav aria-label="Diensten"><b>Diensten</b><a href="/diensten">Alle diensten</a>{serv}</nav>
    <nav aria-label="Regio en projecten"><b>Werk</b><a href="/werk">Alle projecten</a><a href="/werk/vagpro">VAGPRO</a><a href="/werk/detak">Sleepdienst De Tak</a><a href="/werk/cartronic">CarTronic</a><b class="sf-b2">Regio</b>{steden}</nav>
    <nav aria-label="StrakWerk"><b>StrakWerk</b><a href="/prijzen">Prijzen</a><a href="/#prijzen">Prijscalculator</a><a href="/over-mij">Over mij</a><a href="/contact">Contact</a><a href="/kennisbank">Kennisbank</a><a href="/demo">Demo beheerpaneel</a></nav>
  </div>
  <div class="wrap sf-bot"><span>© 2026 StrakWerk · Webdesign uit {CITY}</span><a href="/privacy">Privacy</a></div>
</footer>'''


HEAD_ICONS = '''<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">'''

ANALYTICS = '''<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script>
<script defer src="/_vercel/insights/script.js"></script>'''

SCRIPTS = '''<script src="/assets/js/gsap.min.js"></script>
<script src="/assets/js/ScrollTrigger.min.js"></script>
<script src="/assets/js/SplitText.min.js"></script>
<script src="/assets/js/lenis.min.js"></script>
<script src="/assets/case.js"></script>'''


def head(title, desc, path, og_type='website', og_image=SITE + '/assets/og.png', ld=None, extra=''):
    url = SITE + path
    lds = ''.join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>\n' for x in (ld or []))
    return f'''<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<meta name="theme-color" content="#0B0E13">
<link rel="canonical" href="{url}">
<meta property="og:type" content="{og_type}">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:image" content="{og_image}">
<meta name="twitter:card" content="summary_large_image">
{HEAD_ICONS}
<link rel="preload" href="/assets/fonts/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/fonts/fonts.css">
<link rel="stylesheet" href="/assets/case.css">
{extra}{lds}{ANALYTICS}
</head>'''


def provider():
    """Verwijzing naar de organisatie op de homepage (zelfde @id), met de geverifieerde basisgegevens."""
    return {"@type": "ProfessionalService", "@id": ORG_ID, "name": "StrakWerk", "url": SITE + '/'}


# Projecten (alleen geverifieerde gegevens: naam, branche, plaats, wat er gebouwd is, live-adres)
PROJECTS = {
    'vagpro': dict(name='VAGPRO', kind='Autospecialist', place='Den Haag', img='vagpro', live='https://vagpro.nl', preset='vagpro',
                   short='Een onafhankelijke VAG-specialist voor Volkswagen, Audi, SEAT, Škoda en Cupra. Bezoekers vullen hun kenteken in en sturen hun aanvraag via WhatsApp.',
                   tags=['Kentekencheck (RDW)', 'Aanvraag via WhatsApp', 'Pagina per dienst']),
    'detak': dict(name='Sleepdienst De Tak', kind='Sleep- en bergingsdienst', place='Den Haag', img='detak', live='https://sleepdienstdetak.nl', preset='detak',
                  short='Bij pech vraag je in een paar tikken hulp aan: kenteken typen of fotograferen, locatie delen en versturen via WhatsApp. In drie talen.',
                  tags=['Kentekenherkenning', 'Locatie delen', 'Drie talen', "Regiopagina's"]),
    'cartronic': dict(name='CarTronic', kind='Retrofit & webshop', place='Rijswijk', img='cartronic', live='https://cartronic.nl', preset='cartronic',
                      short='Een webshop voor originele fabrieksopties, met een voertuigzoeker per merk en model en een beheerpaneel waarin de eigenaar alles zelf aanpast.',
                      tags=['Webshop met iDEAL', 'Voertuigzoeker', 'Geavanceerd beheerpaneel']),
}


def project_card(slug, eager=False, heading='h3'):
    p = PROJECTS[slug]
    tags = ''.join(f'<span>{e(t)}</span>' for t in p['tags'])
    return (f'<article class="h-card"><a class="h-img" href="/werk/{slug}" tabindex="-1" aria-hidden="true"><img src="/assets/work/{p["img"]}-800.webp" '
            f'srcset="/assets/work/{p["img"]}-800.webp 800w, /assets/work/{p["img"]}.webp 1600w" sizes="(max-width: 600px) 92vw, (max-width: 900px) 46vw, 380px" '
            f'width="800" height="452" alt="" loading="{"eager" if eager else "lazy"}"></a>'
            f'<small>{e(p["kind"])} · {e(p["place"])}</small><{heading}>{e(p["name"])}</{heading}><p>{e(p["short"])}</p><div class="h-tags">{tags}</div>'
            f'<div class="h-links"><a href="/werk/{slug}">Bekijk het project →</a><a href="{p["live"]}" target="_blank" rel="noopener">Live ↗</a></div></article>')
