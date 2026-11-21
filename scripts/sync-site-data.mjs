#!/usr/bin/env node
// Maakt api/_lib/content/site-data.json uit de bestaande bronnen van de site:
// CONFIG in index.html (pakketprijzen, actie met einddatum, WhatsApp-nummer),
// tools/v2/projects.json (echte projectinformatie) en de screenshots in assets/work
// (met hun echte afmetingen). HQ leest prijzen en acties dus uit dezelfde bron als de
// website. `npm run check` faalt als dit bestand verouderd is.
// Gebruik: npm run sync-site-data
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { imageSize } from "../api/_lib/content/imagesize.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = path.join(root, "api", "_lib", "content", "site-data.json");

export function readConfig(html) {
  const start = html.indexOf("const CONFIG = {");
  if (start < 0) throw new Error("CONFIG niet gevonden in index.html");
  let i = html.indexOf("{", start), depth = 0, j = i, inStr = null;
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (c === "\\") { j++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) break; }
  }
  return vm.runInNewContext(`(${html.slice(i, j + 1)})`, Object.create(null), { timeout: 1000 });
}

const dims = (p) => { const d = imageSize(readFileSync(path.join(root, p))); return d ? { width: d.width, height: d.height } : {}; };
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function build() {
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  const cfg = readConfig(html);
  const wa = (html.match(/wa\.me\/(\d{8,15})/) || [])[1] || null;
  const email = (html.match(/mailto:([^"?\s]+@[^"?\s]+)/) || [])[1] || null;
  const phone = (html.match(/tel:(\+\d{8,15})/) || [])[1] || null;
  let brandAssets = [];
  try { brandAssets = JSON.parse(readFileSync(path.join(root, "brand", "brand.json"), "utf8")).assets; } catch { brandAssets = []; }
  const projects = JSON.parse(readFileSync(path.join(root, "tools", "v2", "projects.json"), "utf8"));
  const work = readdirSync(path.join(root, "assets", "work")).filter(f => /\.webp$/.test(f) && !/-(800|320|150|360)\.webp$/.test(f));
  return {
    _bron: "Gemaakt door scripts/sync-site-data.mjs uit index.html (CONFIG), tools/v2/projects.json en assets/work. Niet met de hand aanpassen.",
    site: "strakwerkk.nl",
    whatsapp: wa,
    // Afzender van alle campagnes: StrakWerk zelf.
    brand: { name: "StrakWerk", site: "strakwerkk.nl", url: "https://www.strakwerkk.nl", email, phone, whatsapp: wa, place: "Zoetermeer" },
    // Eigen beeldmateriaal (scripts/brand-assets.mjs): schermopname en schermafbeeldingen van de echte site.
    brand_assets: brandAssets,
    bases: Object.fromEntries(Object.entries(cfg.bases).map(([k, b]) => [k, { name: b.name, price_eur: b.price, pitch: b.pitch || "", incl: b.incl || {} }])),
    // Opties uit de configurator (prijs eenmalig tenzij "per" is ingevuld), voor offertes in HQ.
    options: (cfg.groups || []).flatMap(g => g.items.map(i => ({ id: i.id, group: g.title, name: i.name, price_eur: i.price, qty: Boolean(i.qty), per: i.monthly ? "maand" : null, unit: i.unit || null, desc: i.desc || "" }))),
    promo: cfg.promo ? { until: cfg.promo.until, label: cfg.promo.label || "", free: Object.keys(cfg.promo.free || {}) } : null,
    projects: projects.map(p => {
      const shots = (p.shots || []).map(([file, label, alt]) => ({ path: `/assets/work/${file}.webp`, label, alt, kind: "desktop" }));
      if (p.mob) shots.push({ path: `/assets/work/${p.mob}.webp`, label: "Mobiel", alt: `${p.name} op een telefoon`, kind: "mobiel" });
      // Overige screenshots van dit project in assets/work (bijv. een pagina die niet in de presentatie staat).
      for (const f of work.filter(f => f === `${p.slug}.webp` || f.startsWith(`${p.slug}-`))) {
        const pth = `/assets/work/${f}`;
        if (!shots.some(s => s.path === pth)) shots.push({ path: pth, label: titleCase(f.replace(`${p.slug}-`, "").replace(".webp", "").replace(/-/g, " ")), alt: `${p.name}: ${f.replace(".webp", "")}`, kind: /mobiel/.test(f) ? "mobiel" : "desktop" });
      }
      return {
        slug: p.slug, name: p.name, sector: p.kind?.[0] || "", city: p.kind?.[1] || "", live: p.live || null,
        text: p.text || "", made: p.made || [],
        shots: shots.map(s => ({ ...s, ...dims(s.path.slice(1)) })),
      };
    }),
  };
}

export const serialize = (d) => JSON.stringify(d, null, 2) + "\n";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(OUT, serialize(build()));
  console.log(`✓ ${path.relative(root, OUT)} bijgewerkt`);
}
