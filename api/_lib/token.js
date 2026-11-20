// JWT-controle van Supabase-accesstokens. Werkt in Node én in de Edge-runtime (middleware).
// Nieuwe Supabase-projecten tekenen met asymmetrische sleutels (JWKS); oudere met een
// HS256-secret (SUPABASE_JWT_SECRET). Beide worden ondersteund.
import { jwtVerify, createRemoteJWKSet } from "jose";

let jwks = null, jwksUrl = null;

export async function verifyAccessToken(token, { supabaseUrl, jwtSecret }) {
  if (!token || !supabaseUrl) return null;
  const opts = { issuer: `${supabaseUrl}/auth/v1`, audience: "authenticated", clockTolerance: 5 };
  try {
    let res;
    if (jwtSecret) {
      res = await jwtVerify(token, new TextEncoder().encode(jwtSecret), { ...opts, algorithms: ["HS256"] });
    } else {
      const url = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
      if (!jwks || jwksUrl !== url) { jwks = createRemoteJWKSet(new URL(url)); jwksUrl = url; }
      res = await jwtVerify(token, jwks, { ...opts, algorithms: ["ES256", "RS256", "EdDSA"] });
    }
    const p = res.payload;
    if (!p.sub || p.role !== "authenticated") return null;
    return { sub: p.sub, email: p.email || null, aal: p.aal || "aal1", exp: p.exp, sessionId: p.session_id || null };
  } catch {
    return null;
  }
}

export const COOKIE_AT = "__Host-sw_hq_at";
export const COOKIE_RT = "__Host-sw_hq_rt";
