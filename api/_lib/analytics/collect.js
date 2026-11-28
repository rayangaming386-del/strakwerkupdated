import { createHash, randomBytes } from "node:crypto";
import { q, one } from "../db.js";
import { env } from "../env.js";
import { EVENT_NAMES, cleanProps, cleanPath, cleanHost, cleanUtm, isBot, deviceOf } from "./sanitize.js";
import { UUID_RE } from "../http.js";

// Bepaalt de omgeving op basis van de site waarvan het event komt. Onbekende sites worden genegeerd.
export function envFor(originHost, testFlag) {
  const h = (originHost || "").toLowerCase();
  let e = null;
  if (env.productionHosts.includes(h)) e = "production";
  else if (/\.vercel\.app$/.test(h)) e = "preview";
  else if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h)) e = "development";
  if (!e) return null;
  return testFlag ? "test" : e;
}

const saltCache = new Map();
async function saltFor(day) {
  if (saltCache.has(day)) return saltCache.get(day);
  await q("insert into hq.analytics_salts (day, salt) values ($1, $2) on conflict (day) do nothing", [day, randomBytes(32)]);
  const r = await one("select salt from hq.analytics_salts where day = $1", [day]);
  saltCache.clear(); saltCache.set(day, r.salt);
  return r.salt;
}

// Beperking per instantie tegen overspoeling (best effort; Vercel Firewall kan dit aanvullen).
const buckets = new Map();
function limited(key) {
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, t: now };
  if (now - b.t > 60_000) { b.n = 0; b.t = now; }
  b.n++; buckets.set(key, b);
  if (buckets.size > 5000) buckets.clear();
  return b.n > 60;
}

/** Verwerkt één event. Geeft de reden terug als het is genegeerd (voor tests), anders "ok"/"dubbel". */
export async function collect({ body, originHost, ua, ip, gpc }) {
  if (gpc) return "gpc";
  if (isBot(ua)) return "bot";
  if (!body || typeof body !== "object") return "ongeldig";
  const name = String(body.n || "");
  if (!EVENT_NAMES.includes(name)) return "onbekend_event";
  if (!UUID_RE.test(String(body.id || ""))) return "ongeldig_id";
  const e = envFor(originHost, Number(body.t) === 1);
  if (!e) return "onbekende_site";

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  // Pseudonieme dag-hash: zonder het dagzout (na 2 dagen gewist) niet te herleiden of te koppelen.
  // Het IP-adres zelf wordt nergens opgeslagen.
  const salt = await saltFor(day);
  const ipKey = createHash("sha256").update(salt).update("|").update(ip || "").digest("hex").slice(0, 16);
  if (limited(ipKey)) return "limiet";
  const visitor = createHash("sha256").update(salt).update("|").update(ip || "").update("|").update(ua || "").digest("hex").slice(0, 32);

  const u = body.u && typeof body.u === "object" ? body.u : {};
  const ref = cleanHost(body.r);
  const own = env.productionHosts.map(h => h.replace(/^www\./, ""));
  const res = await q(
    `insert into hq.analytics_events (event_id, at, env, name, path, referrer_host, utm_source, utm_medium, utm_campaign, device, visitor_hash, props)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (event_id) do nothing`,
    [body.id, now, e, name, cleanPath(body.p), ref && !own.includes(ref) ? ref : null,
     cleanUtm(u.source), cleanUtm(u.medium), cleanUtm(u.campaign),
     deviceOf(ua, Number(body.w) || 0), visitor, cleanProps(name, body.d)]
  );
  return res.rowCount ? "ok" : "dubbel";
}
