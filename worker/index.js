// Cloudflare Worker voor www.strakwerkk.nl (gratis Workers-plan).
// - Statische site: Workers Static Assets (map dist/, gemaakt door scripts/build-cf.mjs).
//   Die bestanden komen niet langs deze code, behalve de paden in run_worker_first.
// - HQ (/hq): de bestanden zitten NIET in de publieke map maar in de Worker zelf
//   (worker/generated/hq-files.js). Ze worden alleen uitgeleverd na een geldige sessie.
// - API (/api/*): dezelfde handlers als lokaal (api/*.js), elk verzoek met een eigen
//   databaseverbinding (api/_lib/runtime.js).
// - Cron (elke minuut): roept /api/worker per onderdeel aan via de eigen service-binding,
//   zodat elk onderdeel zijn eigen rekentijd en looptijd krijgt.
// - E-mail (Cloudflare Email Routing): antwoorden van klanten → juiste klantkaart.
import * as hqApi from "../api/hq.js";
import * as authApi from "../api/auth.js";
import * as publicApi from "../api/public.js";
import * as collectApi from "../api/collect.js";
import * as workerApi from "../api/worker.js";
import { runRequest } from "../api/_lib/runtime.js";
import { hqGuard } from "../api/_lib/guard.js";
import { handleEmailMessage } from "../api/_lib/klant/inbound.js";
import HQ_FILES from "./generated/hq-files.js";
import vercel from "../vercel.json" with { type: "json" };

const API = { hq: hqApi, auth: authApi, public: publicApi, collect: collectApi, worker: workerApi };
const WITH_P = new Set(["hq", "auth", "public"]); // /api/hq/a/b → /api/hq?p=a/b (zoals de rewrites)

// Beveiligingsheaders uit vercel.json (één bron), voor de paden die via de Worker lopen.
const toRe = (src) => new RegExp(`^${src.replace(/\(\.\*\)/g, "§").replace(/:path\*/g, "§").replace(/[.+?^${}|[\]\\]/g, "\\$&").replace(/§/g, ".*")}$`);
const HEADER_RULES = (vercel.headers || []).map(h => ({ re: toRe(h.source), headers: h.headers }));
export function headersFor(pathname) {
  const out = {};
  for (const r of HEADER_RULES) if (r.re.test(pathname)) for (const { key, value } of r.headers) out[key.toLowerCase()] = value;
  return out;
}
function withHeaders(res, extra) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) if (!r.headers.has(k) || k === "cache-control" || k === "content-security-policy") r.headers.set(k, v);
  return r;
}
const notFound = () => new Response("Niet gevonden", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });

async function route(request, env) {
  const url = new URL(request.url);
  // Vangnet: kale domeinnaam naar www (voor paden die langs de Worker komen; zie overdracht voor de rest).
  if (url.hostname === "strakwerkk.nl") return Response.redirect(`https://www.strakwerkk.nl${url.pathname}${url.search}`, 308);

  const api = url.pathname.match(/^\/api\/([a-z]+)(?:\/(.*))?$/);
  if (api) {
    const mod = API[api[1]];
    if (!mod) return withHeaders(Response.json({ error: "niet_gevonden" }, { status: 404 }), headersFor(url.pathname));
    const fn = mod[request.method];
    if (!fn) return new Response(null, { status: 405, headers: { allow: Object.keys(mod).filter(k => /^[A-Z]+$/.test(k)).join(", ") } });
    let req = request;
    if (WITH_P.has(api[1])) {
      const u = new URL(url); if (api[2] !== undefined) u.searchParams.set("p", api[2]); else u.searchParams.delete("p");
      req = new Request(u, request);
    } else if (api[2]) return notFound();
    return withHeaders(await fn(req), headersFor(url.pathname));
  }

  if (url.pathname === "/hq" || url.pathname.startsWith("/hq/")) {
    const denied = await hqGuard(request);
    if (denied) return withHeaders(denied, headersFor(url.pathname));
    // /hq/assets/... → het bestand; elke andere /hq-route → de app (index.html).
    const key = url.pathname.startsWith("/hq/assets/") ? url.pathname.slice(1) : "hq/index.html";
    const f = Object.hasOwn(HQ_FILES, key) ? HQ_FILES[key] : null;
    if (!f) return withHeaders(notFound(), headersFor(url.pathname));
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
    return new Response(request.method === "HEAD" ? null : f.body, { headers: { "content-type": f.type, ...headersFor(url.pathname), "cache-control": "private, no-store" } });
  }

  if (url.pathname === "/intake") {
    const res = await env.ASSETS.fetch(new Request(new URL("/intake", url), request));
    return withHeaders(res, headersFor("/intake"));
  }
  return env.ASSETS.fetch(request);
}

// Welke onderdelen deze minuut draaien. Taken: elke minuut (2× parallel; de wachtrij voorkomt
// dubbel werk). Klanten winnen: elke 5 min. Content: elke 10 min. Bewaartermijnen: elk uur.
export function partsFor(date) {
  const m = date.getUTCMinutes();
  const parts = ["taken", "taken"];
  if (m % 5 === 0) parts.push("klant");
  if (m % 10 === 3) parts.push("content");
  if (m === 17) parts.push("bewaren");
  return parts;
}

async function callPart(env, ctx, part) {
  const secret = (env.CRON_SECRET || process.env.CRON_SECRET || "").trim();
  if (env.SELF) {
    const r = await env.SELF.fetch(new Request(`https://hq.intern/api/worker?part=${part}`, { method: "POST", headers: { authorization: `Bearer ${secret}` } }));
    if (!r.ok) console.error(`[cron] ${part}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.status;
  }
  // Geen service-binding: in dezelfde aanroep (deelt dan rekentijd en looptijd).
  return runRequest({ env, ctx }, () => workerApi.runPart(part)).then(() => 200, (e) => { console.error(`[cron] ${part}: ${e.message}`); return 500; });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await runRequest({ env, ctx }, () => route(request, env));
    } catch (e) {
      console.error(`[worker] ${e?.code || e?.name}: ${String(e?.message).slice(0, 200)}`);
      return Response.json({ error: "serverfout", message: "Er ging iets mis op de server." }, { status: 500 });
    }
  },
  async scheduled(controller, env, ctx) {
    const parts = partsFor(new Date(controller.scheduledTime));
    ctx.waitUntil(Promise.allSettled(parts.map(p => callPart(env, ctx, p))));
  },
  async email(message, env, ctx) {
    await runRequest({ env, ctx }, () => handleEmailMessage(message, { forwardTo: (env.MAIL_FORWARD_TO || "").trim() || null }));
  },
};
