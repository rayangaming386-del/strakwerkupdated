#!/usr/bin/env node
// Lokale ontwikkelserver die het Vercel-gedrag van dit project nabootst:
// statische bestanden met cleanUrls, de rewrites/redirects/headers uit vercel.json,
// de middleware voor /hq en de functies in /api (Web Request/Response-signatuur).
// Gebruik: npm run dev  (leest .env.local als die bestaat; poort via PORT, standaard 3000)
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const vercel = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8", ".mp4": "video/mp4", ".webmanifest": "application/manifest+json" };

// path-to-regexp-achtige vertaling, voldoende voor de patronen in vercel.json.
function toRegex(source) {
  let re = "", keys = [], i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === ":") {
      const m = source.slice(i).match(/^:([a-zA-Z_]+)(\((.*?)\)\)?)?(\*)?/);
      let name = m[1], custom = null, star = false, len = m[0].length;
      const rest = source.slice(i + 1 + name.length);
      if (rest.startsWith("(")) { // eigen regex met haakjes in balans
        let depth = 0, j = 0;
        for (; j < rest.length; j++) { if (rest[j] === "(") depth++; else if (rest[j] === ")") { depth--; if (depth === 0) break; } }
        custom = rest.slice(1, j); len = 1 + name.length + j + 1;
      } else if (rest.startsWith("*")) { star = true; len = 1 + name.length + 1; }
      keys.push(name);
      re += custom ? `(${custom})` : star ? "(.*)" : "([^/]+)";
      i += len;
    } else if (c === "(") {
      let depth = 0, j = i;
      for (; j < source.length; j++) { if (source[j] === "(") depth++; else if (source[j] === ")") { depth--; if (depth === 0) break; } }
      re += source.slice(i, j + 1); keys.push(String(keys.length)); i = j + 1;
    } else { re += c.replace(/[.+?^${}|[\]\\]/g, "\\$&"); i++; }
  }
  return { re: new RegExp(`^${re}$`), keys };
}
function match(source, pathname) {
  const { re, keys } = toRegex(source);
  const m = pathname.match(re);
  if (!m) return null;
  const params = {}; keys.forEach((k, i) => (params[k] = m[i + 1] ?? ""));
  return params;
}
const fill = (dest, params) => dest.replace(/:([a-zA-Z_]+)\*?/g, (_, k) => params[k] ?? "");

async function fileFor(pathname) {
  const clean = decodeURIComponent(pathname).replace(/\.\.+/g, "");
  const cands = clean.endsWith("/") ? [path.join(clean, "index.html")] : [clean, `${clean}.html`, path.join(clean, "index.html")];
  for (const c of cands) {
    const f = path.join(root, c);
    if (!f.startsWith(root)) continue;
    if (/[\\/](node_modules|\.git|db|scripts|tests|tools|docs|brand)[\\/]|[\\/]\.env|[\\/]api[\\/]/.test(f.slice(root.length))) continue;
    try { if ((await stat(f)).isFile()) return f; } catch {}
  }
  return null;
}

function toRequest(req, url) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  if (!headers.has("x-forwarded-for")) headers.set("x-forwarded-for", req.socket.remoteAddress || "127.0.0.1");
  const init = { method: req.method, headers };
  if (!["GET", "HEAD"].includes(req.method)) { init.body = req; init.duplex = "half"; }
  return new Request(url, init);
}

async function send(res, response, extraHeaders = []) {
  const h = {};
  response.headers.forEach((v, k) => { if (k !== "set-cookie") h[k] = v; });
  for (const [k, v] of extraHeaders) h[k.toLowerCase()] = v;
  const cookies = response.headers.getSetCookie?.() || [];
  if (cookies.length) h["set-cookie"] = cookies;
  res.writeHead(response.status, h);
  res.end(Buffer.from(await response.arrayBuffer()));
}

const modCache = new Map();
async function load(file) {
  if (!modCache.has(file) || process.env.HQ_DEV_RELOAD) modCache.set(file, await import(pathToFileURL(file).href + (process.env.HQ_DEV_RELOAD ? `?t=${Date.now()}` : "")));
  return modCache.get(file);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || "localhost";
      let url = new URL(req.url, `http://${host}`);
      for (const r of vercel.redirects || []) {
        if (r.has) continue;
        const p = match(r.source, url.pathname);
        if (p) { res.writeHead(r.permanent ? 308 : 307, { location: fill(r.destination, p) }); return res.end(); }
      }
      const headerRules = (vercel.headers || []).filter(h => match(h.source, url.pathname)).flatMap(h => h.headers.map(x => [x.key, x.value]));
      // Middleware
      const mw = await load(path.join(root, "middleware.js"));
      const matchers = mw.config?.matcher || [];
      if (matchers.some(m => match(m, url.pathname))) {
        const r = await mw.default(toRequest(req, url.toString()));
        if (r && !r.headers.get("x-middleware-next")) return send(res, r);
      }
      // Rewrites
      let target = url.pathname, query = new URLSearchParams(url.search);
      for (const r of vercel.rewrites || []) {
        const p = match(r.source, url.pathname);
        if (p) {
          const d = new URL(fill(r.destination, p), "http://x");
          target = d.pathname; d.searchParams.forEach((v, k) => query.set(k, v));
          break;
        }
      }
      if (target.startsWith("/api/")) {
        const name = target.slice(5).split("/")[0].replace(/[^a-z0-9_-]/gi, "");
        const file = path.join(root, "api", `${name}.js`);
        if (!name || name.startsWith("_") || !existsSync(file)) { res.writeHead(404); return res.end(); }
        const mod = await load(file);
        const fn = mod[req.method] || mod.default?.fetch;
        if (!fn) { res.writeHead(405); return res.end(); }
        const fwd = new URL(url.toString()); fwd.search = query.toString();
        const response = await fn(toRequest(req, fwd.toString()));
        return send(res, response, headerRules);
      }
      const file = await fileFor(target);
      if (!file) {
        const nf = path.join(root, "404.html");
        res.writeHead(404, { "content-type": TYPES[".html"] });
        return res.end(existsSync(nf) ? await readFile(nf) : "Niet gevonden");
      }
      const h = { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" };
      for (const [k, v] of headerRules) h[k.toLowerCase()] = v;
      res.writeHead(200, h);
      res.end(req.method === "HEAD" ? undefined : await readFile(file));
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500);
      res.end("Serverfout (dev)");
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnvFile(path.join(root, ".env.local"));
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => console.log(`StrakWerk dev-server op http://localhost:${port}  (HQ: /login, /hq)`));
}
