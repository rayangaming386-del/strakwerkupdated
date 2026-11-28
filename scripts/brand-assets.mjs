#!/usr/bin/env node
// Eigen beeldmateriaal van StrakWerk voor de contentstudio: een schermopname van de echte
// configurator op een telefoon en twee schermafbeeldingen (pakketten, offerte). Opgenomen
// van de actuele index.html via de lokale dev-server, met een datum ná de actie zodat er
// geen verlopen actie in beeld komt. Resultaat in brand/ (niet gepubliceerd op de site).
//
//   npm run brand-assets
import { mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = path.join(root, "brand");

export async function recordBrandAssets({ log = console.log, afterDate = "2026-12-02T10:00:00+01:00" } = {}) {
  const { chromium } = await import("playwright-core");
  const { createServer } = await import("./dev-server.mjs");
  const server = createServer();
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tmp = path.join(OUT, ".rec");
  await rm(tmp, { recursive: true, force: true }); await mkdir(tmp, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.HQ_CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "no-preference" });
    // Datum na de actie: de configurator toont dan de gewone prijzen zonder actiebalk.
    await ctx.addInitScript((iso) => {
      const off = Date.parse(iso) - Date.now(); const D = Date;
      class FD extends D { constructor(...a) { if (a.length) super(...a); else super(D.now() + off); } static now() { return D.now() + off; } }
      globalThis.Date = FD;
      try { localStorage.clear(); localStorage.setItem("sw-meten", "uit"); } catch {}
    }, afterDate);
    const page = await ctx.newPage();
    // Schermopname via de screencast van Chromium: volle resolutie (780×1688) met echte tijden per beeld.
    const cdp = await ctx.newCDPSession(page);
    const shots = []; let recording = false;
    cdp.on("Page.screencastFrame", async (f) => {
      if (recording) shots.push({ t: f.metadata.timestamp, data: f.data });
      await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    const t0 = Date.now();
    await page.goto(`${base}/?sw_test=1#prijzen`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const scrollTo = async (sel, offset = 80, ms = 900) => {
      const y = await page.evaluate(([s, o]) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect().top + scrollY - o : scrollY; }, [sel, offset]);
      const from = await page.evaluate(() => scrollY), steps = Math.max(1, Math.round(ms / 30));
      for (let i = 1; i <= steps; i++) { const k = i / steps, e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; await page.evaluate(v => window.scrollTo(0, v), from + (y - from) * e); await page.waitForTimeout(30); }
    };
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400);
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
    await page.waitForTimeout(300); recording = true;
    const startMs = Date.now() - t0;
    const marks = {}; const mark = (k) => { marks[k] = Math.round((Date.now() - t0 - startMs) / 100) / 10; };
    await scrollTo(".base-switch.pk", 110, 1200); mark("pakketten"); await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, "pakketten.png") });
    await page.tap('.base-switch.pk [data-base="premium"]'); mark("premium"); await page.waitForTimeout(1300);
    await scrollTo(".cfg .base", 90, 1000); await page.waitForTimeout(1100);
    const opt = page.locator('[data-opt="kenteken"], [data-id="kenteken"]').first();
    if (await opt.count()) { await opt.scrollIntoViewIfNeeded(); mark("opties"); await page.waitForTimeout(500); await opt.tap().catch(() => {}); await page.waitForTimeout(1100); }
    await scrollTo(".quote, #quote, .offerte, [id*=offerte]", 90, 1200); mark("offerte"); await page.waitForTimeout(1600);
    await page.screenshot({ path: path.join(OUT, "offerte.png") });
    await page.waitForTimeout(600);
    const prices = await page.$$eval(".base-switch.pk .pk-price", els => els.map(e => e.textContent.trim()));
    recording = false;
    await cdp.send("Page.stopScreencast").catch(() => {});
    await ctx.close();
    // Beelden met hun echte duur aan elkaar (concat), daarna naar 30 fps.
    const { writeFileSync } = await import("node:fs");
    const lines = [];
    shots.forEach((f, i) => {
      const file = path.join(tmp, `f${String(i).padStart(5, "0")}.jpg`);
      writeFileSync(file, Buffer.from(f.data, "base64"));
      const next = shots[i + 1]?.t ?? (f.t + 0.5);
      lines.push(`file '${file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(3)}`);
    });
    lines.push(`file '${path.join(tmp, `f${String(shots.length - 1).padStart(5, "0")}.jpg`)}'`);
    writeFileSync(path.join(tmp, "list.txt"), lines.join("\n"));
    const mp4 = path.join(OUT, "configurator-mobiel.mp4");
    const r = spawnSync(process.env.HQ_FFMPEG || "ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", path.join(tmp, "list.txt"),
      "-vf", "fps=30,scale=780:1688:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-an", "-movflags", "+faststart", mp4]);
    if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
    const pr = spawnSync(process.env.HQ_FFMPEG ? process.env.HQ_FFMPEG.replace(/ffmpeg$/, "ffprobe") : "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", mp4]);
    const info = JSON.parse(pr.stdout.toString());
    // Manifest voor HQ (scripts/sync-site-data.mjs leest dit; geen ffprobe nodig bij npm run check).
    const manifest = {
      opgenomen: new Date().toISOString().slice(0, 10), datum_in_beeld: afterDate, prijzen_in_beeld: prices,
      assets: [
        { path: "/brand/configurator-mobiel.mp4", kind: "video", label: "Configurator (schermopname)", alt: "Schermopname van de configurator op strakwerkk.nl: pakket kiezen, optie aanzetten, offerte", width: info.streams[0].width, height: info.streams[0].height, duration_s: Math.round(Number(info.format.duration) * 10) / 10,
          moments: marks },
        { path: "/brand/pakketten.png", kind: "mobiel", label: "Pakketten", alt: "De vier pakketten met prijzen op strakwerkk.nl", width: 780, height: 1688 },
        { path: "/brand/offerte.png", kind: "mobiel", label: "Offerte", alt: "Offerte met totaalprijs in de configurator", width: 780, height: 1688 },
      ],
    };
    (await import("node:fs")).writeFileSync(path.join(OUT, "brand.json"), JSON.stringify(manifest, null, 2) + "\n");
    log(`✓ brand/configurator-mobiel.mp4, pakketten.png, offerte.png (prijzen op de pagina: ${prices.join(" · ")})`);
    return { mp4, prices };
  } finally {
    await browser.close(); server.close();
    await rm(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await mkdir(OUT, { recursive: true });
  recordBrandAssets().catch(e => { console.error(e); process.exit(1); });
}
