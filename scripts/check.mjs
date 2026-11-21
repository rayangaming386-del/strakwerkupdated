#!/usr/bin/env node
// Statische controle (het project heeft geen TypeScript of bundler):
// 1. syntaxcontrole van alle eigen JavaScript-bestanden;
// 2. alle serverfuncties en HQ-modules laden zonder ontbrekende imports;
// 3. elke lokale script/stylesheet-verwijzing in de HTML bestaat;
// 4. vercel.json is geldig en de functies bestaan;
// 5. geen geheimen of serverconfiguratie in browsercode.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skip = new Set(["node_modules", ".git", "test-results"]);
const all = [];
(function walk(d) { for (const f of readdirSync(d)) { if (skip.has(f)) continue; const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : all.push(p); } })(root);
const rel = (p) => path.relative(root, p);
let errors = 0;
const fail = (m) => { errors++; console.error(`✗ ${m}`); };

const own = all.filter(f => /\.(m?js)$/.test(f) && !/assets[\\/]js[\\/]|hq-login[\\/]supabase\.js$/.test(f));
for (const f of own) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); } catch (e) { fail(`syntax ${rel(f)}: ${String(e.stderr).split("\n")[4] || e.message}`); }
}
console.log(`✓ syntax: ${own.length} bestanden`);

for (const f of ["middleware.js", ...readdirSync(path.join(root, "api")).filter(f => f.endsWith(".js")).map(f => `api/${f}`)]) {
  try {
    const m = await import(pathToFileURL(path.join(root, f)).href);
    if (f.startsWith("api/") && !["GET", "POST"].some(k => typeof m[k] === "function")) fail(`${f} exporteert geen GET/POST`);
  } catch (e) { fail(`import ${f}: ${e.message}`); }
}
console.log("✓ serverfuncties laden");

// Browser-ES-modules: controleer relatieve en absolute imports op bestaan.
for (const f of all.filter(f => /[\\/](hq|assets[\\/](office|hq-login))[\\/].*\.js$/.test(f) && !f.endsWith("supabase.js"))) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/(?:import\s*(?:[^"'()]*?from\s*)?|import\()\s*["']([^"']+)["']/g)) {
    const spec = m[1];
    const target = spec.startsWith("/") ? path.join(root, spec) : path.resolve(path.dirname(f), spec);
    if (!existsSync(target)) fail(`${rel(f)} importeert ontbrekend ${spec}`);
  }
}
console.log("✓ browser-imports bestaan");

for (const f of all.filter(f => f.endsWith(".html"))) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="(\/(?:assets|hq)\/[^"?#]+)"/g)) {
    if (!existsSync(path.join(root, m[1]))) fail(`${rel(f)} verwijst naar ontbrekend ${m[1]}`);
  }
}
console.log("✓ HTML-verwijzingen bestaan");

try {
  const v = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
  for (const c of v.crons || []) if (!existsSync(path.join(root, `${c.path.replace(/^\//, "")}.js`))) fail(`cron ${c.path} heeft geen functie`);
  console.log("✓ vercel.json geldig");
} catch (e) { fail(`vercel.json: ${e.message}`); }

for (const f of all.filter(f => /[\\/](hq|assets)[\\/].*\.(js|html|css)$/.test(f) || f.endsWith("login.html"))) {
  if (/assets[\\/]js[\\/]|supabase\.js$/.test(f)) continue;
  const src = readFileSync(f, "utf8");
  if (/process\.env|SERVICE_ROLE|SUPABASE_SECRET|ANTHROPIC_API_KEY|CRON_SECRET|VERCEL_ANALYTICS_TOKEN/.test(src)) fail(`${rel(f)} noemt serverconfiguratie`);
}
console.log("✓ geen serverconfiguratie in browsercode");

// site-data.json (prijzen, actie en projecten voor HQ) moet gelijk zijn aan de bronnen van de site.
try {
  const { build, serialize, OUT } = await import("./sync-site-data.mjs");
  if (readFileSync(OUT, "utf8") !== serialize(build())) fail("api/_lib/content/site-data.json is verouderd: draai npm run sync-site-data");
  else console.log("✓ site-data.json gelijk aan index.html en projects.json");
} catch (e) { fail(`site-data: ${e.message}`); }

if (errors) { console.error(`\n${errors} probleem/problemen gevonden.`); process.exit(1); }
console.log("\nAlles in orde.");
process.exit(0);
