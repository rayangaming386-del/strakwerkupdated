// Centrale configuratie. Alle geheimen komen uit omgevingsvariabelen op de server
// (Vercel > Settings > Environment Variables). Niets hiervan gaat naar de browser,
// behalve wat publicConfig() expliciet teruggeeft (de publieke Supabase-sleutel).

const e = (k) => (process.env[k] ?? "").trim();

export const env = {
  get databaseUrl() { return e("DATABASE_URL"); },
  get databaseCa() { return e("DATABASE_CA_CERT"); },
  get supabaseUrl() { return e("SUPABASE_URL").replace(/\/+$/, ""); },
  // Nieuwe Supabase-projecten: "publishable key" (sb_publishable_...). Oudere: "anon key". Beide zijn publiek.
  get supabasePublicKey() { return e("SUPABASE_PUBLISHABLE_KEY") || e("SUPABASE_ANON_KEY"); },
  // Server-only: service role / secret key. Alleen nodig voor uitnodigen en accountbeheer.
  get supabaseSecretKey() { return e("SUPABASE_SECRET_KEY") || e("SUPABASE_SERVICE_ROLE_KEY"); },
  // Alleen voor oudere projecten met HS256-JWT-secret; anders wordt de JWKS van Supabase gebruikt.
  get supabaseJwtSecret() { return e("SUPABASE_JWT_SECRET"); },
  get mfaRoles() { return (e("HQ_MFA_ROLES") || "eigenaar").split(",").map(s => s.trim()).filter(Boolean); },
  get siteUrl() { return (e("HQ_SITE_URL") || "https://www.strakwerkk.nl").replace(/\/+$/, ""); },
  get cronSecret() { return e("CRON_SECRET"); },
  get anthropicKey() { return e("ANTHROPIC_API_KEY"); },
  get anthropicModel() { return e("HQ_LLM_MODEL") || "claude-sonnet-5-5"; },
  get pagespeedKey() { return e("PAGESPEED_API_KEY"); },
  get vercelToken() { return e("VERCEL_ANALYTICS_TOKEN"); },
  get vercelProjectId() { return e("VERCEL_PROJECT_ID"); },
  get vercelTeamId() { return e("VERCEL_TEAM_ID"); },
  get productionHosts() { return (e("HQ_PRODUCTION_HOSTS") || "www.strakwerkk.nl,strakwerkk.nl").split(",").map(s => s.trim().toLowerCase()).filter(Boolean); },
  get vercelEnv() { return e("VERCEL_ENV") || "development"; },
  get isDev() { return !process.env.VERCEL || e("VERCEL_ENV") === "development"; },
};

export function publicConfig() {
  return {
    supabaseUrl: env.supabaseUrl || null,
    supabaseKey: env.supabasePublicKey || null,
    mfaRoles: env.mfaRoles,
    configured: Boolean(env.supabaseUrl && env.supabasePublicKey),
  };
}

// Wat ontbreekt voor HQ als geheel. Wordt in Instellingen en bij fouten getoond (namen, nooit waarden).
export function missingCore() {
  const m = [];
  if (!env.databaseUrl) m.push("DATABASE_URL");
  if (!env.supabaseUrl) m.push("SUPABASE_URL");
  if (!env.supabasePublicKey) m.push("SUPABASE_PUBLISHABLE_KEY");
  return m;
}
