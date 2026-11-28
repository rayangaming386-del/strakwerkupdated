// Afscherming van /hq (HTML, JS en CSS): zonder geldige Supabase-sessie geen enkel bestand.
// Gebruikt door de Cloudflare Worker (worker/index.js) en door middleware.js (lokaal/Vercel).
// Gegevens zitten nooit in deze bestanden; die komen uit /api/hq, dat zelf ook sessie, rol
// en MFA controleert.
import { verifyAccessToken, COOKIE_AT } from "./token.js";

function readCookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** null = toegang; anders het antwoord (doorsturen naar verversen/inloggen). */
export async function hqGuard(request) {
  const url = new URL(request.url);
  const supabaseUrl = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const claims = await verifyAccessToken(readCookie(request, COOKIE_AT), {
    supabaseUrl, jwtSecret: (process.env.SUPABASE_JWT_SECRET || "").trim(),
  });
  if (claims) return null;
  // Geen of verlopen accesstoken: stil verversen met de refresh-cookie, anders naar /login.
  const target = url.pathname.startsWith("/hq/assets/") ? "/hq" : url.pathname;
  return new Response(null, {
    status: 307,
    headers: { location: `/api/auth/refresh?next=${encodeURIComponent(target)}`, "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
  });
}
