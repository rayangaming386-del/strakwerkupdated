import { env } from "./env.js";
import { one } from "./db.js";
import { HttpError, parseCookies, cookie } from "./http.js";
import { verifyAccessToken, COOKIE_AT, COOKIE_RT } from "./token.js";

export const ROLES = ["eigenaar", "medewerker", "alleen_lezen"];
export const ROLE_LABEL = { eigenaar: "Eigenaar", medewerker: "Medewerker", alleen_lezen: "Alleen-lezen" };

// Wat elke rol mag. Alles wordt aan de serverkant afgedwongen; de interface verbergt
// knoppen alleen voor het gemak.
const PERMS = {
  "view":               ["eigenaar", "medewerker", "alleen_lezen"],
  "leads.write":        ["eigenaar", "medewerker"],
  "tasks.start":        ["eigenaar", "medewerker"],
  "tasks.control":      ["eigenaar", "medewerker"],
  "approvals.decide":   ["eigenaar", "medewerker"],   // onderzoek en berichtconcepten
  "approvals.money":    ["eigenaar"],                 // offertes (geld)
  "quotes.write":       ["eigenaar", "medewerker"],
  "payments.write":     ["eigenaar"],
  "packages.write":     ["eigenaar"],
  "settings.write":     ["eigenaar"],
  "members.manage":     ["eigenaar"],
  "data.delete":        ["eigenaar"],
  "content.write":      ["eigenaar", "medewerker"],   // opdrachten, scènes, captions, renders
  "content.approve":    ["eigenaar"],                 // video goedkeuren en inplannen (gaat naar jouw accounts)
  "content.settings":   ["eigenaar"],                 // automatisering, kostenplafond, koppelingen
  "assets.release":     ["eigenaar"],                 // beelden vrijgeven voor social media
};

export function can(role, perm) {
  return (PERMS[perm] || []).includes(role);
}

export function permissionsFor(role) {
  return Object.keys(PERMS).filter(p => can(role, p));
}

export function tokenFrom(request) {
  const c = parseCookies(request);
  return c[COOKIE_AT] || null;
}

// Controleert sessie, lidmaatschap, status en MFA. Gooit 401/403 bij twijfel.
export async function getAuth(request) {
  const token = tokenFrom(request);
  if (!token) throw new HttpError(401, "niet_ingelogd", "Niet ingelogd.");
  const claims = await verifyAccessToken(token, { supabaseUrl: env.supabaseUrl, jwtSecret: env.supabaseJwtSecret });
  if (!claims) throw new HttpError(401, "sessie_verlopen", "Sessie verlopen of ongeldig.");
  const member = await one("select user_id, email, role, status from hq.members where user_id = $1", [claims.sub]);
  if (!member) throw new HttpError(403, "geen_toegang", "Dit account heeft geen toegang tot HQ.");
  if (member.status !== "actief") throw new HttpError(403, "geblokkeerd", "Dit account is niet actief.");
  if (env.mfaRoles.includes(member.role) && claims.aal !== "aal2") {
    throw new HttpError(403, "mfa_vereist", "Voor deze rol is tweestapsverificatie verplicht.");
  }
  return { userId: member.user_id, email: member.email, role: member.role, claims };
}

export async function requirePerm(request, perm) {
  const auth = await getAuth(request);
  if (!can(auth.role, perm)) throw new HttpError(403, "onvoldoende_rechten", "Je rol heeft geen rechten voor deze actie.");
  return auth;
}

export function assertPerm(auth, perm) {
  if (!can(auth.role, perm)) throw new HttpError(403, "onvoldoende_rechten", "Je rol heeft geen rechten voor deze actie.");
}

export function sessionCookies({ access_token, refresh_token, expires_in }) {
  return [
    cookie(COOKIE_AT, access_token, { maxAge: Math.min(Number(expires_in) || 3600, 3600) }),
    // Refresh token: maximaal 7 dagen; Supabase trekt hem in bij uitloggen.
    cookie(COOKIE_RT, refresh_token, { maxAge: 7 * 24 * 3600, sameSite: "Strict" }),
  ];
}

export function clearCookies() {
  return [cookie(COOKIE_AT, "", { maxAge: 0 }), cookie(COOKIE_RT, "", { maxAge: 0, sameSite: "Strict" })];
}
