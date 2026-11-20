// /api/auth/* — sessiebeheer rond Supabase Auth.
// Het inloggen zelf (wachtwoord, MFA-code, herstel) gebeurt in de browser rechtstreeks
// bij Supabase. Daarna geeft de loginpagina de tokens één keer aan deze functie, die ze
// controleert en als HttpOnly-cookies zet. De browser bewaart zelf geen tokens.
import { env, publicConfig } from "./_lib/env.js";
import { one, audit } from "./_lib/db.js";
import { json, errorResponse, readJson, assertSameOrigin, parseCookies, HttpError } from "./_lib/http.js";
import { verifyAccessToken, COOKIE_AT, COOKIE_RT } from "./_lib/token.js";
import { sessionCookies, clearCookies, getAuth, permissionsFor, ROLE_LABEL } from "./_lib/auth.js";
import * as sb from "./_lib/supabase.js";

const subpath = (request) => {
  const u = new URL(request.url);
  return (u.searchParams.get("p") ?? u.pathname.replace(/^\/api\/auth\/?/, "")).replace(/^\/+|\/+$/g, "");
};

function safeNext(n) {
  return typeof n === "string" && /^\/hq(\/[a-z0-9\-\/]*)?$/i.test(n) ? n : "/hq";
}

async function memberFor(claims) {
  const m = await one("select user_id, email, role, status from hq.members where user_id = $1", [claims.sub]);
  if (!m) throw new HttpError(403, "geen_toegang", "Dit account heeft geen toegang tot HQ. Toegang gaat alleen via een uitnodiging.");
  if (m.status === "geblokkeerd") throw new HttpError(403, "geblokkeerd", "Dit account is geblokkeerd.");
  return m;
}

async function establish(request) {
  assertSameOrigin(request);
  const body = await readJson(request);
  const at = String(body.access_token || ""), rt = String(body.refresh_token || "");
  if (!at || !rt) throw new HttpError(400, "ontbreekt", "Tokens ontbreken.");
  const claims = await verifyAccessToken(at, { supabaseUrl: env.supabaseUrl, jwtSecret: env.supabaseJwtSecret });
  if (!claims) throw new HttpError(401, "sessie_ongeldig", "Ongeldige sessie.");
  // Gezaghebbende controle bij Supabase: bestaat de gebruiker nog en is hij niet geblokkeerd?
  const user = await sb.getUser(at);
  if (!user || user.id !== claims.sub) throw new HttpError(401, "sessie_ongeldig", "Ongeldige sessie.");
  const m = await memberFor(claims);
  if (env.mfaRoles.includes(m.role) && claims.aal !== "aal2") {
    throw new HttpError(403, "mfa_vereist", "Voor deze rol is tweestapsverificatie verplicht.");
  }
  await one("update hq.members set status = case when status = 'uitgenodigd' then 'actief' else status end, last_login_at = now(), updated_at = now() where user_id = $1 returning 1", [m.user_id]);
  await audit(null, { actor: m.user_id, label: m.email, action: "inloggen", entity: "member", entityId: m.user_id, details: { aal: claims.aal } });
  const expiresIn = Number(body.expires_in) || (claims.exp - Math.floor(Date.now() / 1000));
  return json({ ok: true, role: m.role }, 200, { "set-cookie": sessionCookies({ access_token: at, refresh_token: rt, expires_in: expiresIn }) });
}

async function refresh(request) {
  const wantsJson = request.method === "POST";
  if (wantsJson) assertSameOrigin(request);
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  const rt = parseCookies(request)[COOKIE_RT];
  const fail = () => {
    if (wantsJson) return json({ error: "niet_ingelogd", message: "Opnieuw inloggen nodig." }, 401, { "set-cookie": clearCookies() });
    const h = new Headers({ location: `/login?next=${encodeURIComponent(next)}`, "cache-control": "no-store" });
    clearCookies().forEach(c => h.append("set-cookie", c));
    return new Response(null, { status: 303, headers: h });
  };
  if (!rt) return fail();
  let data;
  try { data = await sb.refreshSession(rt); } catch { return fail(); }
  const claims = await verifyAccessToken(data?.access_token, { supabaseUrl: env.supabaseUrl, jwtSecret: env.supabaseJwtSecret });
  if (!claims) return fail();
  try {
    const m = await memberFor(claims);
    if (m.status !== "actief") return fail();
    if (env.mfaRoles.includes(m.role) && claims.aal !== "aal2") return fail();
  } catch { return fail(); }
  const cookies = sessionCookies(data);
  if (wantsJson) return json({ ok: true }, 200, { "set-cookie": cookies });
  const h = new Headers({ location: next, "cache-control": "no-store" });
  cookies.forEach(c => h.append("set-cookie", c));
  return new Response(null, { status: 303, headers: h });
}

async function logout(request) {
  assertSameOrigin(request);
  const at = parseCookies(request)[COOKIE_AT];
  if (at) {
    const claims = await verifyAccessToken(at, { supabaseUrl: env.supabaseUrl, jwtSecret: env.supabaseJwtSecret });
    await sb.logout(at);
    if (claims) { try { await audit(null, { actor: claims.sub, label: claims.email, action: "uitloggen", entity: "member", entityId: claims.sub }); } catch {} }
  }
  return json({ ok: true }, 200, { "set-cookie": clearCookies() });
}

async function me(request) {
  const a = await getAuth(request);
  return json({ userId: a.userId, email: a.email, role: a.role, roleLabel: ROLE_LABEL[a.role], aal: a.claims.aal, permissions: permissionsFor(a.role), sessionExpiresAt: a.claims.exp });
}

export async function handle(request) {
  try {
    const p = subpath(request);
    const m = request.method;
    if (p === "config" && m === "GET") return json(publicConfig());
    if (p === "session" && m === "POST") return await establish(request);
    if (p === "refresh" && (m === "GET" || m === "POST")) return await refresh(request);
    if (p === "logout" && m === "POST") return await logout(request);
    if (p === "me" && m === "GET") return await me(request);
    return json({ error: "niet_gevonden" }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}

export const GET = handle, POST = handle;
