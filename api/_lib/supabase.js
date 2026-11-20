// Aanroepen van Supabase Auth (GoTrue) via de officiële REST-endpoints.
// Wachtwoorden, wachtwoordherstel, MFA en inlogbeperkingen regelt Supabase; HQ bouwt
// daar zelf niets voor na.
import { env } from "./env.js";
import { HttpError } from "./http.js";

function need(...keys) {
  const missing = [];
  if (!env.supabaseUrl) missing.push("SUPABASE_URL");
  if (keys.includes("public") && !env.supabasePublicKey) missing.push("SUPABASE_PUBLISHABLE_KEY");
  if (keys.includes("secret") && !env.supabaseSecretKey) missing.push("SUPABASE_SECRET_KEY");
  if (missing.length) throw new HttpError(503, "niet_gekoppeld", `Supabase Auth niet gekoppeld: ${missing.join(", ")} ontbreekt.`, { missing });
}

async function call(path, { method = "GET", token, body, secret = false } = {}) {
  const key = secret ? env.supabaseSecretKey : env.supabasePublicKey;
  const res = await fetch(`${env.supabaseUrl}/auth/v1${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${token || key}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = data?.msg || data?.message || data?.error_description || `Supabase antwoordde ${res.status}`;
    throw new HttpError(res.status === 429 ? 429 : res.status >= 500 ? 502 : 401, res.status === 429 ? "te_veel_pogingen" : "auth_fout", msg);
  }
  return data;
}

export async function getUser(accessToken) {
  need("public");
  return call("/user", { token: accessToken });
}

export async function refreshSession(refreshToken) {
  need("public");
  return call("/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: refreshToken } });
}

export async function logout(accessToken) {
  need("public");
  // scope=local: alleen deze sessie beëindigen (refresh token ingetrokken).
  try { await call("/logout?scope=local", { method: "POST", token: accessToken }); } catch {}
}

export async function inviteUser(email, redirectTo) {
  need("secret");
  return call(`/invite?redirect_to=${encodeURIComponent(redirectTo)}`, { method: "POST", secret: true, body: { email } });
}

export async function findUserByEmail(email) {
  need("secret");
  // De admin-API filtert niet op e-mail; voor een klein team is één pagina genoeg.
  const data = await call("/admin/users?page=1&per_page=200", { secret: true });
  const users = data?.users || [];
  return users.find(u => (u.email || "").toLowerCase() === email.toLowerCase()) || null;
}

export async function banUser(userId, banned) {
  need("secret");
  return call(`/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT", secret: true, body: { ban_duration: banned ? "876000h" : "none" },
  });
}
