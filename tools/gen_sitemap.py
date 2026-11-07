"""sitemap.xml: alleen canonieke, indexeerbare pagina's (200), met lastmod = laatste wijziging van het bestand.
Gewijzigde, nog niet gecommitte bestanden krijgen de datum van vandaag. Geen changefreq/priority (Google negeert die)."""
import subprocess, glob, os, re, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
today = datetime.date.today().isoformat()
dirty = set(l[3:].strip() for l in subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True).stdout.splitlines())
def lastmod(f):
    if f in dirty or any(f.startswith(d.rstrip('/') + '/') for d in dirty if d.endswith('/')): return today
    d = subprocess.run(['git', 'log', '-1', '--format=%cs', '--', f], capture_output=True, text=True).stdout.strip()
    return d or today
order = ['index.html', 'diensten.html', 'werk.html', 'prijzen.html', 'over-mij.html', 'contact.html']
files = order + sorted(glob.glob('diensten/*.html')) + sorted(glob.glob('werk/*.html')) + ['kennisbank.html'] + sorted(glob.glob('kennisbank/*.html')) + ['demo.html', 'privacy.html']
out = []
for f in files:
    s = open(f, encoding='utf-8').read()
    if re.search(r'<meta name="robots" content="[^"]*noindex', s): continue
    canon = re.search(r'<link rel="canonical" href="([^"]+)"', s).group(1)
    url = 'https://www.strakwerkk.nl/' + ('' if f == 'index.html' else f[:-5])
    assert canon == url, (f, canon, url)
    out.append(f'  <url><loc>{url}</loc><lastmod>{lastmod(f)}</lastmod></url>')
open('sitemap.xml', 'w').write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + '\n'.join(out) + '\n</urlset>\n')
print('ok', len(out))
