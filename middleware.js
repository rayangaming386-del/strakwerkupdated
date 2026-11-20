// Vercel Routing Middleware (werkt ook zonder framework). Schermt alle bestanden onder
// /hq af aan de serverkant: zonder geldige sessie geen HTML, JS of CSS van HQ.
// Gegevens zitten nooit in deze bestanden; die komen uit /api/hq, dat zelf ook
// sessie, rol en MFA controleert.
import { next } from "@vercel/functions";
import { verifyAccessToken, COOKIE_AT } from "./api/_lib/token.js";

export const config = { matcher: ["/hq", "/hq/:path*"] };

function readCookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const supabaseUrl = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const claims = await verifyAccessToken(readCookie(request, COOKIE_AT), {
    supabaseUrl, jwtSecret: (process.env.SUPABASE_JWT_SECRET || "").trim(),
  });
  if (claims) {
    return next({ headers: { "x-robots-tag": "noindex, nofollow", "cache-control": "private, no-store" } });
  }
  // Geen of verlopen accesstoken: probeer stil te verversen met de refresh-cookie,
  // anders stuurt /api/auth/refresh door naar /login.
  const target = url.pathname.startsWith("/hq/assets/") ? "/hq" : url.pathname;
  return new Response(null, {
    status: 307,
    headers: {
      location: `/api/auth/refresh?next=${encodeURIComponent(target)}`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
