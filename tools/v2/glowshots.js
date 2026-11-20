// Schermafbeeldingen van glowenlaserforyou.nl: desktop 1600x905 (zoals de andere projecten) en mobiel 640 breed
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const OUT = __dirname + '/glow', B = 'https://www.glowenlaserforyou.nl';
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const settle = async p => { await p.waitForTimeout(2500); await p.evaluate(() => { document.querySelectorAll('*').forEach(e => { const s = getComputedStyle(e); if (s.animationName !== 'none') e.style.animationPlayState = 'paused'; }); }); };
  const d = await b.newContext({ viewport: { width: 1600, height: 905 }, reducedMotion: 'reduce' });
  for (const [path, name, y] of [['/', 'glow', 0], ['/behandelingen', 'glow-behandelingen', 0], ['/prijzen', 'glow-prijzen', 0], ['/over-de-salon', 'glow-salon', 0], ['/contact', 'glow-contact', 0], ['/boeken', 'glow-boeken', 0]]) {
    const p = await d.newPage(); await p.goto(B + path, { waitUntil: 'networkidle', timeout: 60000 }); await settle(p);
    await p.screenshot({ path: `${OUT}/${name}.png` }); console.log('ok', name, await p.title()); await p.close();
  }
  const m = await b.newContext({ viewport: { width: 375, height: 741 }, deviceScaleFactor: 640 / 375, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const p = await m.newPage(); await p.goto(B + '/', { waitUntil: 'networkidle', timeout: 60000 }); await settle(p);
  await p.screenshot({ path: `${OUT}/glow-mobiel.png` }); console.log('ok mobiel');
  await b.close();
})();
