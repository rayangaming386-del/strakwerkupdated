"""Bouwt de nieuwe homepage (index.html) uit de onderdelen in deze map.
De calculator (CONFIG + logica), de FAQ en de werkwijze-iconen komen uit de vorige homepage (old-index.html),
zodat prijzen, presets, meting en gedrag precies gelijk blijven."""
import json, os, re, html

D = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(D))
old = open(f'{D}/old-index.html', encoding='utf-8').read()
rd = lambda n: open(f'{D}/{n}', encoding='utf-8').read()
e = html.escape


def between(s, a, b, incl=False):
    i = s.index(a); j = s.index(b, i + len(a))
    return s[i:j + len(b)] if incl else s[i:j]


def balanced_div(s, start):
    """Geeft het volledige element vanaf `start` (een <div ...>) tot en met de bijbehorende </div>."""
    i = s.index(start); depth = 0
    for m in re.finditer(r'<(/?)div\b[^>]*>', s[i:]):
        depth += -1 if m.group(1) else 1
        if depth == 0: return s[i:i + m.end()]
    raise ValueError(start)


ICONS = {
    'arrow': '<svg class="arr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>',
    'wa': '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.4 14.1c-.2.6-1.3 1.2-1.8 1.3-.5 0-1 .3-3.3-.7a11.4 11.4 0 0 1-4.6-4.1c-.3-.5-1.1-1.6-1.1-3s.8-2.1 1-2.4c.3-.3.6-.4.8-.4h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.3.5-.4.5c-.2.2-.3.4-.1.7.2.4.9 1.5 2 2.4 1.4 1.2 2.5 1.6 2.9 1.7.3.2.5.1.7-.1l.9-1.1c.2-.3.5-.3.8-.2l2 1c.3.1.5.2.6.3.1.2.1.8-.2 1.4z"/></svg>',
    'phone': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/></svg>',
    'site': '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="5" width="26" height="19"/><path d="M3 10h26M11 28h10M16 24v4"/></svg>',
    'shop': '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 11h22l-2 16H7L5 11z"/><path d="M11 11V8a5 5 0 0 1 10 0v3"/></svg>',
    'redo': '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M26 16a10 10 0 1 1-3-7.1"/><path d="M26 5v6h-6"/></svg>',
    'check': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    'user': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    'chat': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z"/></svg>',
    'pin': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
}
P = json.load(open(f'{D}/projects.json', encoding='utf-8'))
BY = {p['slug']: p for p in P}


def ss(n, big=True):
    return f'srcset="assets/work/{n}-800.webp 800w, assets/work/{n}.webp 1600w"'


# Hero: drie apparaten, elk met alle projecten (alleen het eerste wordt direct geladen)
SET0 = {'main': 'glow', 'phone': 'detak', 'back': 'cartronic'}
def dev(kind):
    cls = {'main': 'dv-main', 'phone': 'dv-phone', 'back': 'dv-back'}[kind]
    first = SET0[kind]; order = [first] + [p['slug'] for p in P if p['slug'] != first]
    imgs = []
    for k, slug in enumerate(order):
        p = BY[slug]
        if kind == 'phone':
            src, srcset, sizes, wh = f'assets/work/{p["mob"]}-320.webp', f'assets/work/{p["mob"]}-320.webp 320w, assets/work/{p["mob"]}.webp 640w', '(max-width: 999px) 23vw, 12vw', f'width="640" height="{p["mh"]}"'
        elif kind == 'back':
            src, srcset, sizes, wh = f'assets/work/{slug}-800.webp', '', '', 'width="800" height="452"'
        else:
            src, srcset, sizes, wh = f'assets/work/{slug}-800.webp', f'assets/work/{slug}-800.webp 800w, assets/work/{slug}.webp 1600w', '(max-width: 999px) 90vw, 52vw', 'width="1600" height="905"'
        if k == 0:
            pri = ' fetchpriority="high"' if kind == 'main' else ' decoding="async"'
            imgs.append(f'<img class="on" data-pj="{slug}" src="{src}"' + (f' srcset="{srcset}" sizes="{sizes}"' if srcset else '') + f' {wh} alt=""{pri}>')
        else:
            imgs.append(f'<img data-pj="{slug}" data-src="{src}"' + (f' data-srcset="{srcset}" sizes="{sizes}"' if srcset else '') + f' {wh} alt="" decoding="async">')
    tag = f'<span class="dv-tag" id="tagMain">{e(BY[first]["name"])}</span>' if kind == 'main' else ''
    did = {'main': 'dvMain', 'phone': 'dvPhone', 'back': 'dvBack'}[kind]
    return f'            <a class="dv {cls}" id="{did}" href="werk/{first}" data-cursor="Bekijk project" aria-label="Project {e(BY[first]["name"])} bekijken">\n              ' + '\n              '.join(imgs) + (f'\n              {tag}' if tag else '') + '\n            </a>'
STAGE = dev('back') + '\n' + dev('main') + '\n            <span class="stage-marks" aria-hidden="true"></span>\n' + dev('phone')
SETS_LABEL = ['Glow', 'CarTronic', 'VAGPRO', 'De Tak']
STAGETABS = ''.join(f'<button type="button" aria-pressed="{"true" if i == 0 else "false"}" data-set="{i}">{l}</button>' for i, l in enumerate(SETS_LABEL))

# Portfolio
cases = []
for i, p in enumerate(P):
    shots = p['shots']
    imgs = []
    for k, (n, lab, alt) in enumerate(shots):
        if k == 0: imgs.append(f'<img class="on" src="assets/work/{n}-800.webp" {ss(n)} sizes="(max-width: 900px) 80vw, 56vw" width="1600" height="905" alt="{e(alt)}" loading="lazy" decoding="async">')
        else: imgs.append(f'<img data-src="assets/work/{n}-800.webp" data-srcset="assets/work/{n}-800.webp 800w, assets/work/{n}.webp 1600w" sizes="(max-width: 900px) 80vw, 56vw" width="1600" height="905" alt="{e(alt)}" decoding="async">')
    tabs = ''.join(f'<button type="button" aria-pressed="{"true" if k == 0 else "false"}">{e(lab)}</button>' for k, (n, lab, alt) in enumerate(shots))
    made = ''.join(f'<li>{e(m)}</li>' for m in p['made'])
    kind = ''.join(f'<span>{e(k)}</span>' for k in p['kind'])
    live_attr = ' data-cartronic-link' if p['slug'] == 'cartronic' else ''
    cases.append(f'''        <article class="pj{' cur' if i == 0 else ''}" id="case-{p['slug']}" data-pj="{p['slug']}">
          <div class="pj-media">
            <a class="pj-screen" href="werk/{p['slug']}" data-cursor="Bekijk project" aria-label="Bekijk het project {e(p['name'])}">
              {chr(10).join('              ' + x for x in imgs).strip()}
            </a>
            <div class="pj-phone"><img src="assets/work/{p['mob']}-320.webp" srcset="assets/work/{p['mob']}-320.webp 320w, assets/work/{p['mob']}.webp 640w" sizes="(max-width: 900px) 18vw, 11vw" width="640" height="{p['mh']}" alt="Mobiele homepage van {e(p['name'])}" loading="lazy" decoding="async"></div>
            <div class="pj-tabs" role="group" aria-label="Pagina's van {e(p['name'])}">{tabs}</div>
          </div>
          <div class="pj-info">
            <div class="pj-kind">{kind}</div>
            <h3>{e(p['name'])}</h3>
            <p>{e(p['text'])}</p>
            <ul class="pj-made" aria-label="Wat er gemaakt is">{made}</ul>
            <div class="pj-acts"><a class="btn btn--gold" href="werk/{p['slug']}">Bekijk het project {ICONS['arrow']}</a><a class="link-soft"{live_attr} href="{p['live']}" target="_blank" rel="noopener">{e(p['livetxt'])} ↗</a><button class="link-soft" type="button" data-preset="{p['preset']}">Wat kost zo'n site?</button></div>
          </div>
        </article>''')
SHOWNAV = ''.join(f'<button type="button" data-go="{i}" aria-current="{"true" if i == 0 else "false"}">{e(p["name"])}</button>' for i, p in enumerate(P))
DOTS = ''.join(f'<button type="button" aria-label="{e(p["name"])}" aria-current="{"true" if i == 0 else "false"}"></button>' for i, p in enumerate(P))
GHOST = ' · '.join(e(p['name']) for p in P)

# Uit de vorige homepage
FAQ = between(old, '<div class="faq-list">', '</div>\n    </div>\n  </section>').replace('<div class="faq-list">', '').strip('\n')
CALC = '      ' + balanced_div(old, '<div class="cfg">')
ww = re.findall(r'<div class="big" aria-hidden="true">(<svg[\s\S]*?</svg>)</div>', between(old, 'id="werkwijze"', '</section>'))
assert len(ww) == 4, len(ww)

body = rd('body_a.html') + rd('body_b.html')
for k, v in {'STAGE': STAGE, 'STAGETABS': STAGETABS, 'CASES': '\n\n'.join(cases), 'SHOWNAV': SHOWNAV, 'DOTS': DOTS, 'GHOST': GHOST, 'FAQ': FAQ, 'CALC': CALC,
             **{f'WW{i}': s for i, s in enumerate(ww)}}.items():
    assert '{{' + k + '}}' in body, k; body = body.replace('{{' + k + '}}', v)
body = re.sub(r'\{\{I:(\w+)\}\}', lambda m: ICONS[m.group(1)], body)
assert '{{' not in body, re.findall(r'\{\{[^}]+\}\}', body)[:5]

# Head: alles tot en met het blok met lettertypes, daarna de nieuwe opmaak
head = old[:old.index('</style>') + len('</style>')]
css = rd('style_a.css') + rd('style_b.css') + rd('style_c.css')

# Script: CONFIG en calculator uit de vorige homepage, daarna de nieuwe onderdelen
i0 = old.index('/* ============================================================\n   INSTELLINGEN')
i1 = old.index('/* Menu-items met een eigen pagina')
calc = old[i0:i1]
a = 'const LIVE_NAMES = { vagpro:"VAGPRO", detak:"De Tak", cartronic:"CarTronic" };'
assert calc.count(a) == 1
calc = calc.replace(a, 'const LIVE_NAMES = { vagpro:"VAGPRO", detak:"De Tak", cartronic:"CarTronic", glow:"Glow & Laser" };' + rd('js1.js'))
a = "  clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(STORE, encodeCfg()); } catch (e) {} }, 250);\n}"
assert calc.count(a) == 1
calc = calc.replace(a, a[:-1] + "  afterHooks.forEach(f => f());\n}")
a = '${promo}\\n\\nMijn keuze online: ${cfgLink()}'
assert calc.count(a) == 1, 'quoteText'
calc = calc.replace(a, '${promo}${stijl ? `\\nStijlvoorkeur: ${STYLES[stijl]}` : ""}\\n\\nMijn keuze online: ${cfgLink()}')
OLD = '\n'.join(between(old, f'/* {t}', '\n\n/* ') for t in ['Kenteken-demo', 'Kopiëren', 'Uitlegvideo', 'Gratis snelheidscheck', 'Lokale tijd'])
js3 = rd('js3.js').replace('{{OLD}}', OLD)
script = ('<script defer src="assets/js/gsap.min.js"></script>\n<script defer src="assets/js/ScrollTrigger.min.js"></script>\n<script defer src="assets/js/SplitText.min.js"></script>\n<script defer src="assets/js/DrawSVGPlugin.min.js"></script>\n'
          '<script>\n/* Start na het inlezen van de pagina, zodat de bibliotheken (defer) eerst laden en de pagina niet wacht op scripts */\ndocument.addEventListener("DOMContentLoaded", () => {\n'
          + calc + rd('js2.js') + js3 + rd('js4.js') + '\n});\n</script>\n')
doc = head + '\n<style>\n' + css + '</style>\n</head>\n<body>\n<a class="skip" href="#inhoud">Naar de inhoud</a>\n' + body + '\n' + script + '</body>\n</html>\n'
open(f'{ROOT}/index.html', 'w', encoding='utf-8').write(doc)
print('ok', len(doc))
