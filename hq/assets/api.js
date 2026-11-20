// API-client voor HQ. Sessie zit in HttpOnly-cookies; deze code ziet nooit een token.
let refreshing = null;

async function refresh() {
  refreshing ||= fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin", headers: { "x-hq-request": "1" } })
    .then(r => r.ok).catch(() => false).finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export class ApiError extends Error {
  constructor(status, body) { super(body?.message || `Fout ${status}`); this.status = status; this.code = body?.error; this.missing = body?.missing; this.details = body?.details; }
}

export async function api(path, { method = "GET", body, idempotencyKey, retried = false } = {}) {
  const headers = { "x-hq-request": "1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
  let res;
  try {
    res = await fetch(`/api/hq/${path}`, { method, credentials: "same-origin", headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, { message: "Geen verbinding met de server." });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !retried) {
    if (await refresh()) return api(path, { method, body, idempotencyKey, retried: true });
    location.replace(`/login?verlopen=1&next=${encodeURIComponent(location.pathname)}`);
    throw new ApiError(401, data);
  }
  if (res.status === 403 && data.error === "mfa_vereist") { location.replace(`/login?next=${encodeURIComponent(location.pathname)}`); throw new ApiError(403, data); }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export async function me() {
  let r = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (r.status === 401 && await refresh()) r = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!r.ok) return null;
  return r.json();
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { "x-hq-request": "1" } }).catch(() => {});
  location.replace("/login?uitgelogd=1");
}
