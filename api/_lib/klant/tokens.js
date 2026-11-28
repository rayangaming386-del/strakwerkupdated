// Ondertekende links zonder account (offertepagina, intake). Een link bestaat uit het id en
// een HMAC-handtekening met een servergeheim: niet te raden, altijd opnieuw te maken, en
// ongeldig zodra het geheim wijzigt. Gebruikt HQ_ENCRYPTION_KEY (en CRON_SECRET).
import { createHmac, timingSafeEqual } from "node:crypto";
import { isServerless } from "../runtime.js";

const E = (k) => (process.env[k] ?? "").trim();
function secret(purpose) {
  const k = E("HQ_ENCRYPTION_KEY"), c = E("CRON_SECRET");
  // In productie nooit tekenen zonder geheim (anders zouden links te raden zijn).
  if (isServerless() && (k + c).length < 16) throw Object.assign(new Error("Servergeheim ontbreekt (HQ_ENCRYPTION_KEY)."), { status: 503, code: "niet_gekoppeld", missing: ["HQ_ENCRYPTION_KEY"] });
  return `${k}|${c}|${purpose}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Handtekening (base64url) voor een doel en id. */
export function sign(purpose, id, len = 26) {
  return createHmac("sha256", secret(purpose)).update(String(id)).digest("base64url").slice(0, len);
}

/** Link-token "id.handtekening". */
export const linkToken = (purpose, id) => `${id}.${sign(purpose, id)}`;

/** Controleert een link-token; geeft het id terug of null. */
export function checkLinkToken(purpose, token) {
  const t = String(token || "");
  const i = t.indexOf(".");
  if (i < 0) return null;
  const id = t.slice(0, i), sig = t.slice(i + 1);
  if (!UUID.test(id) || !/^[A-Za-z0-9_-]{20,40}$/.test(sig)) return null;
  const want = Buffer.from(sign(purpose, id)), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

/** Intake-token (48 hex, zelfde vorm als voorheen) afgeleid van het project-id. */
export const intakeToken = (projectId) => createHmac("sha256", secret("intake")).update(String(projectId)).digest("hex").slice(0, 48);
