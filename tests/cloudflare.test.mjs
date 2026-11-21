// Cloudflare-ombouw: wat publiek wordt, welke cron-onderdelen wanneer draaien, en de headers.
// De integratie (workerd + Postgres) staat in scripts/cf-smoke.mjs en docs/hq/cloudflare.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const { build, isPublic } = await import("../scripts/build-cf.mjs");

test("build: alleen publieke bestanden in dist/, HQ alleen in de Worker", async () => {
  const r = build({ log: () => {} });
  assert.ok(r.files > 50 && r.hq >= 10);
  for (const f of ["api/hq.js", "api/_lib/db.js", "hq/index.html", "hq/assets/app.js", "db/migrations/001_hq.sql", "docs/hq/installatie.md", "CLAUDE.md", "package.json", "vercel.json", "wrangler.toml", "middleware.js", "scripts/migrate.mjs", "tools/site_common.py", ".env.local", "worker/index.js", "assets/work/LEESMIJ.txt"])
    assert.equal(isPublic(f), false, `${f} mag niet publiek zijn`);
  for (const f of ["index.html", "login.html", "intake.html", "assets/sw-aanvraag.js", "werk/vagpro.html", "404.html"]) assert.equal(isPublic(f), true, f);
  assert.equal(existsSync("dist/hq"), false, "geen hq-map in dist/");
  assert.equal(existsSync("dist/api"), false);
  assert.match(readFileSync("dist/_redirects", "utf8"), /^\/service-pro \/prijzen 308$/m);
  assert.match(readFileSync("dist/_headers", "utf8"), /^\/login\n {2}X-Robots-Tag: noindex/m);
});

test("cron: taken elke minuut, klant elke 5, content elke 10, bewaren elk uur", async () => {
  const { partsFor, headersFor } = await import("../worker/index.js");
  const at = (m) => partsFor(new Date(Date.UTC(2026, 10, 21, 8, m)));
  assert.deepEqual(at(1), ["taken", "taken"]);
  assert.deepEqual(at(0), ["taken", "taken", "klant"]);
  assert.deepEqual(at(13), ["taken", "taken", "content"]);
  assert.deepEqual(at(17), ["taken", "taken", "bewaren"]);
  const counts = { klant: 0, content: 0, bewaren: 0 };
  for (let m = 0; m < 60; m++) for (const p of at(m)) if (p in counts) counts[p]++;
  assert.deepEqual(counts, { klant: 12, content: 6, bewaren: 1 });
  // Headers uit vercel.json gelden ook op Cloudflare.
  assert.match(headersFor("/hq/vandaag")["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(headersFor("/intake")["referrer-policy"], "no-referrer");
  assert.match(headersFor("/api/hq/vandaag")["x-robots-tag"], /noindex/);
});
