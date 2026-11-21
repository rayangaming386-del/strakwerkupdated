#!/usr/bin/env node
// Bouwt de Cloudflare-versie:
// - dist/                      publieke bestanden (alleen wat in Git staat en publiek hoort)
// - dist/_headers              beveiligingsheaders voor statische pagina's (uit vercel.json)
// - dist/_redirects            permanente doorverwijzingen (uit vercel.json)
// - worker/generated/hq-files.js  de HQ-app; zit in de Worker, nooit in dist/
// Gebruik: npm run build:cf   (wrangler doet dit ook zelf vóór dev/deploy, zie wrangler.toml)
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, copyFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

// Nooit publiceren: servercode, hulpmiddelen, bronnen, documentatie en HQ (zit in de Worker).
const PRIVATE_DIRS = ["api/", "worker/", "scripts/", "tests/", "db/", "docs/", "tools/", "brand/", "hq/", ".github/", "node_modules/", "dist/", ".data/"];
const PRIVATE_FILES = new Set(["middleware.js", "package.json", "package-lock.json", "vercel.json", "wrangler.toml", ".vercelignore", ".gitignore", ".assetsignore", "CLAUDE.md"]);

export function isPublic(file) {
  if (PRIVATE_DIRS.some(d => file.startsWith(d))) return false;
  if (PRIVATE_FILES.has(file)) return false;
  if (/(^|\/)\.env/.test(file) || /(^|\/)\./.test(file)) return false; // verborgen bestanden
  if (/\.(md|py|cjs|mjs|sql|log)$/i.test(file) || /LEESMIJ\.txt$/.test(file)) return false;
  for (const line of readFileSync(path.join(root, ".vercelignore"), "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
    const l = line.replace(/^\//, "");
    if (l.endsWith("*") ? file.startsWith(l.slice(0, -1)) : file === l || file.startsWith(`${l}/`)) return false;
  }
  return true;
}

const TYPES = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };

export function build({ log = console.log } = {}) {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root }).toString().split("\0").filter(Boolean);
  rmSync(dist, { recursive: true, force: true });
  let n = 0;
  for (const f of files.filter(isPublic)) {
    if (!existsSync(path.join(root, f))) continue;
    mkdirSync(path.dirname(path.join(dist, f)), { recursive: true });
    copyFileSync(path.join(root, f), path.join(dist, f));
    n++;
  }
  const vercel = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
  // _headers: alleen voor statische paden (de Worker zet ze zelf voor /hq, /api en /intake).
  const toPat = (s) => s.replace(/\(\.\*\)/g, "*").replace(/:path\*/g, "*");
  const hdr = (vercel.headers || []).filter(h => !/^\/(hq|api|intake)/.test(h.source))
    .map(h => `${toPat(h.source)}\n${h.headers.map(x => `  ${x.key}: ${x.value}`).join("\n")}`).join("\n\n");
  writeFileSync(path.join(dist, "_headers"), `${hdr}\n`);
  // _redirects: eenvoudige paden; de kale domeinnaam → www regelt een Redirect Rule (zie overdracht).
  const red = (vercel.redirects || []).filter(r => !r.has && !/[()\\]/.test(r.source)).map(r => `${toPat(r.source)} ${r.destination} ${r.permanent ? 308 : 307}`);
  writeFileSync(path.join(dist, "_redirects"), `${red.join("\n")}\n`);
  // HQ-app in de Worker.
  const hq = files.filter(f => f.startsWith("hq/") && TYPES[path.extname(f)]);
  const map = Object.fromEntries(hq.map(f => [f, { type: TYPES[path.extname(f)], body: readFileSync(path.join(root, f), "utf8") }]));
  mkdirSync(path.join(root, "worker", "generated"), { recursive: true });
  writeFileSync(path.join(root, "worker", "generated", "hq-files.js"), `// Gegenereerd door scripts/build-cf.mjs. Niet met de hand aanpassen.\nexport default ${JSON.stringify(map)};\n`);
  log(`dist/: ${n} publieke bestanden · _headers · _redirects (${red.length}) · HQ in de Worker: ${hq.length} bestanden`);
  return { files: n, hq: hq.length, redirects: red.length };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) build();
