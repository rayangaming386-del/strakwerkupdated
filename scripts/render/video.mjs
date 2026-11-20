// Videomaker: maakt van een scènescript een verticale MP4 (1080×1920, H.264, 30 fps) en een
// cover (JPEG). Twee eenvoudige, lokaal te draaien hulpmiddelen:
//  1. Chromium (via playwright-core) tekent elke scène als beeld in de huisstijl;
//  2. ffmpeg monteert die beelden met een rustige zoom en zachte overgangen.
// Draait NIET op Vercel (geen ffmpeg/Chromium daar), maar in de render-worker
// (scripts/render-worker.mjs), lokaal of in GitHub Actions.
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sceneHtml, W, H } from "./scenes.mjs";
import { imageSize } from "../../api/_lib/content/imagesize.js";

export const FPS = 30;
export const FADE = 0.5; // seconden overgang tussen scènes

export class RenderError extends Error {
  constructor(message, { retryable = false, code = "render" } = {}) { super(message); this.retryable = retryable; this.code = code; }
}

function run(cmd, args, { signal, timeoutMs = 300_000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", d => { err = (err + d).slice(-4000); });
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    const onAbort = () => p.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    p.on("error", e => { clearTimeout(t); reject(new RenderError(e.code === "ENOENT" ? `${cmd} is niet geïnstalleerd op de render-machine.` : e.message, { code: "tool" })); });
    p.on("close", code => {
      clearTimeout(t); signal?.removeEventListener("abort", onAbort);
      if (code === 0) resolve(err);
      else reject(new RenderError(`${path.basename(cmd)} stopte met code ${code}: ${err.split("\n").filter(Boolean).slice(-2).join(" | ")}`, { retryable: true }));
    });
  });
}

/** Controleert het script vóór het renderen; geeft begrijpelijke fouten. */
export function validateScript(script) {
  const s = script?.scenes;
  if (!Array.isArray(s) || s.length < 3 || s.length > 9) throw new RenderError("Een video heeft 3 tot 9 scènes nodig.");
  let total = 0;
  for (const [i, sc] of s.entries()) {
    if (!["hook", "shot", "phone", "cta"].includes(sc.type)) throw new RenderError(`Scène ${i + 1}: onbekend type.`);
    if (!sc.text || String(sc.text).length > 140) throw new RenderError(`Scène ${i + 1}: tekst ontbreekt of is langer dan 140 tekens.`);
    if (["shot", "phone"].includes(sc.type) && !sc.asset) throw new RenderError(`Scène ${i + 1}: beeld ontbreekt.`);
    const sec = Number(sc.seconds);
    if (!(sec >= 1.5 && sec <= 6)) throw new RenderError(`Scène ${i + 1}: duur moet tussen 1,5 en 6 seconden liggen.`);
    total += sec;
  }
  const dur = total - FADE * (s.length - 1);
  if (dur < 14 || dur > 26) throw new RenderError(`Totale duur ${dur.toFixed(1)} s ligt buiten 15–25 s.`);
  return dur;
}

async function launchBrowser() {
  let pw;
  try { pw = await import("playwright-core"); } catch { throw new RenderError("playwright-core ontbreekt (npm install).", { code: "tool" }); }
  const executablePath = process.env.HQ_CHROMIUM_PATH || undefined;
  try {
    return await pw.chromium.launch({ executablePath, args: ["--no-sandbox", "--font-render-hinting=none"] });
  } catch (e) {
    throw new RenderError(`Chromium kon niet starten (${String(e.message).split("\n")[0]}). Installeer met: npx playwright-core install chromium`, { code: "tool" });
  }
}

/**
 * script: { scenes: [...] }
 * resolveAsset(pad) → absoluut bestandspad op deze machine (of null)
 * Geeft { video, cover, duration_s, width, height, bytes } terug.
 */
export async function renderVideo({ script, root, resolveAsset, outDir, signal, onStep = async () => {}, ffmpeg = process.env.HQ_FFMPEG || "ffmpeg" }) {
  const duration = validateScript(script);
  await mkdir(outDir, { recursive: true });

  // Beelden opzoeken en hun echte verhouding uitlezen.
  const assets = {};
  for (const sc of script.scenes) for (const p of [sc.asset, sc.asset2].filter(Boolean)) {
    if (assets[p]) continue;
    const file = await resolveAsset(p);
    if (!file) throw new RenderError(`Beeld niet gevonden: ${p}`);
    const dim = imageSize(await readFile(file));
    if (!dim) throw new RenderError(`Beeldformaat niet herkend: ${p}`);
    assets[p] = { src: pathToFileURL(file).href, width: dim.width, height: dim.height };
  }

  await onStep("Scènes tekenen");
  const browser = await launchBrowser();
  const frames = [];
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    const base = pathToFileURL(root + path.sep).href;
    const draw = async (scene, file, opts) => {
      const html = sceneHtml(scene, assets, opts).replace("<head>", `<head><base href="${base}">`);
      const tmp = path.join(outDir, `${path.basename(file)}.html`);
      await writeFile(tmp, html);
      await page.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const broken = await page.evaluate(() => [...document.images].filter(i => !i.complete || !i.naturalWidth).length);
      if (broken) throw new RenderError("Een beeld kon niet worden geladen tijdens het tekenen.");
      await page.screenshot({ path: file, type: file.endsWith(".jpg") ? "jpeg" : "png", quality: file.endsWith(".jpg") ? 88 : undefined });
    };
    for (const [i, sc] of script.scenes.entries()) {
      if (signal?.aborted) throw new RenderError("Afgebroken.", { retryable: true });
      const f = path.join(outDir, `scene-${i}.png`);
      await draw(sc, f);
      frames.push(f);
    }
    // Cover: de openingsscène, met de projectnaam als ondertitel als die er is.
    const coverScene = { ...script.scenes[0], footer: script.cover_footer || script.scenes[0].footer };
    await page.setViewportSize({ width: W, height: H });
    await draw(coverScene, path.join(outDir, "cover.jpg"), { cover: true });
  } finally {
    await browser.close().catch(() => {});
  }

  await onStep("Video monteren (ffmpeg)");
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  const lens = script.scenes.map(s => Number(s.seconds));
  frames.forEach(f => args.push("-i", f));
  args.push("-f", "lavfi", "-t", String(duration), "-i", "anullsrc=r=48000:cl=stereo");
  const parts = [];
  lens.forEach((len, i) => {
    const n = Math.round(len * FPS);
    // Beelden zijn op 2× getekend (2160×3840): zoompan op hoge resolutie geeft een rustige, schokvrije zoom.
    parts.push(`[${i}:v]zoompan=z='1+0.035*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p[v${i}]`);
  });
  let acc = "v0", accLen = lens[0];
  for (let i = 1; i < lens.length; i++) {
    const out = i === lens.length - 1 ? "vout" : `x${i}`;
    parts.push(`[${acc}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${(accLen - FADE).toFixed(3)}[${out}]`);
    acc = out; accLen += lens[i] - FADE;
  }
  const video = path.join(outDir, "video.mp4");
  args.push("-filter_complex", parts.join(";"), "-map", "[vout]", "-map", `${frames.length}:a`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", video);
  await run(ffmpeg, args, { signal, timeoutMs: 600_000 });

  await onStep("Video controleren");
  const info = await probeInfo(video, ffmpeg);
  if (info.width !== W || info.height !== H) throw new RenderError(`Resultaat heeft het verkeerde formaat (${info.width}×${info.height}).`);
  if (info.duration < 14 || info.duration > 26) throw new RenderError(`Resultaat duurt ${info.duration.toFixed(1)} s.`);
  return { video, cover: path.join(outDir, "cover.jpg"), duration_s: Math.round(info.duration * 100) / 100, width: info.width, height: info.height, bytes: (await stat(video)).size, frames };
}

export async function probeInfo(file, ffmpeg = process.env.HQ_FFMPEG || "ffmpeg") {
  const ffprobe = ffmpeg.endsWith("ffmpeg") ? ffmpeg.slice(0, -6) + "ffprobe" : "ffprobe";
  return new Promise((resolve, reject) => {
    const p = spawn(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file]);
    let out = "";
    p.stdout.on("data", d => (out += d));
    p.on("error", () => reject(new RenderError("ffprobe is niet geïnstalleerd.", { code: "tool" })));
    p.on("close", () => {
      try { const j = JSON.parse(out); resolve({ width: j.streams[0].width, height: j.streams[0].height, duration: Number(j.format.duration) }); }
      catch { reject(new RenderError("Video kon niet worden gecontroleerd.")); }
    });
  });
}
