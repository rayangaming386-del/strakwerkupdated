// Loginpagina van StrakWerk HQ. Wachtwoord, MFA en herstel lopen via Supabase Auth.
// De browser bewaart geen tokens: na een geslaagde login worden ze één keer aan
// /api/auth/session gegeven, die ze controleert en als HttpOnly-cookie zet.
import { renderOffice } from "/assets/office/office-art.js";

const $ = (id) => document.getElementById(id);
const forms = ["f-login", "f-forgot", "f-newpw", "f-mfa", "f-enroll"];
const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
const next = /^\/hq(\/[a-z0-9\-\/]*)?$/i.test(params.get("next") || "") ? params.get("next") : "/hq";
let sb = null, enrollFactor = null;

// Illustratie: vaste, verzonnen-vrije toestand. Geen echte data.
renderOffice($("office").querySelector("svg"), {
  title: "Illustratie van het kantoor",
  agents: [
    { key: "scout", name: "Scout", label: "Werkplek" }, { key: "auditor", name: "Auditor", label: "Werkplek" },
    { key: "insights", name: "Insights", label: "Werkplek" }, { key: "sales", name: "Sales", label: "Werkplek" },
    { key: "care", name: "Care", label: "Werkplek" }, { key: "rank", name: "Rank", label: "Werkplek" },
    { key: "content", name: "Content", label: "Werkplek" }, { key: "builder", name: "Builder", label: "Werkplek" },
  ].map(a => ({ ...a, status: "illustratie" })),
});

function show(id, { title, sub } = {}) {
  forms.forEach(f => ($(f).hidden = f !== id));
  if (title) $("t").textContent = title;
  if (sub != null) $("sub").textContent = sub;
  const first = id && $(id).querySelector("input");
  if (first) setTimeout(() => first.focus(), 0);
}
function alertMsg(msg) { $("alert").textContent = msg || ""; $("alert").hidden = !msg; }
function info(msg) { $("info").textContent = msg || ""; $("info").hidden = !msg; }
function busy(on, label = "Bezig…") {
  $("busy").hidden = !on; $("busy-t").textContent = label;
  document.querySelectorAll("form button").forEach(b => (b.disabled = on));
}
function nl(err) {
  const m = String(err?.message || err || "");
  const s = err?.status;
  if (s === 429 || /rate limit|too many/i.test(m)) return "Te veel pogingen. Wacht even en probeer het opnieuw.";
  if (/invalid login credentials/i.test(m)) return "Onjuiste combinatie van e-mailadres en wachtwoord.";
  if (/email not confirmed/i.test(m)) return "Dit account is nog niet bevestigd. Gebruik de link uit je uitnodiging.";
  if (/invalid totp|invalid code|expired/i.test(m)) return "Code onjuist of verlopen. Probeer de nieuwste code.";
  if (/password.*(short|weak|at least)/i.test(m)) return "Dit wachtwoord is te zwak of te kort.";
  if (/same.*password/i.test(m)) return "Kies een ander wachtwoord dan je huidige.";
  if (/fetch|network/i.test(m)) return "Geen verbinding. Controleer je internet.";
  return "Er ging iets mis. Probeer het opnieuw.";
}

async function establish() {
  const { data } = await sb.auth.getSession();
  const s = data.session;
  if (!s) throw new Error("Geen sessie");
  const res = await fetch("/api/auth/session", {
    method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-hq-request": "1" },
    body: JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) { busy(true, "Doorsturen naar HQ…"); location.replace(next); return; }
  if (body.error === "mfa_vereist") return mfaFlow();
  if (body.error === "geen_toegang" || body.error === "geblokkeerd") {
    await sb.auth.signOut({ scope: "local" }).catch(() => {});
    show("f-login", { title: "Inloggen" });
    return alertMsg(body.message || "Dit account heeft geen toegang tot HQ.");
  }
  throw Object.assign(new Error(body.message || "Inloggen mislukt"), { status: res.status });
}

async function mfaFlow() {
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw error;
  const totp = (data?.totp || []).find(f => f.status === "verified");
  if (totp) { enrollFactor = totp.id; return show("f-mfa", { title: "Tweestapsverificatie", sub: "Nog één stap." }); }
  // Oude, niet-afgemaakte inschrijvingen opruimen en een nieuwe starten.
  for (const f of (data?.all || []).filter(f => f.status !== "verified")) await sb.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
  const en = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `StrakWerk HQ ${new Date().toISOString().slice(0, 10)}` });
  if (en.error) throw en.error;
  enrollFactor = en.data.id;
  $("qr").src = en.data.totp.qr_code;
  $("secret").textContent = en.data.totp.secret;
  show("f-enroll", { title: "Tweestapsverificatie instellen", sub: "Verplicht voor eigenaars." });
}

async function verifyCode(code) {
  if (!/^\d{6}$/.test(code)) return alertMsg("Vul de 6 cijfers in.");
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: enrollFactor, code });
  if (error) throw error;
  await establish();
}

async function boot() {
  let cfg;
  try { cfg = await (await fetch("/api/auth/config", { credentials: "same-origin" })).json(); } catch { cfg = null; }
  if (!cfg?.configured || !window.supabase) {
    show(null, { title: "HQ is nog niet gekoppeld", sub: "" });
    return alertMsg("De inlogdienst is niet ingesteld (SUPABASE_URL en SUPABASE_PUBLISHABLE_KEY ontbreken op de server). Zie docs/hq/installatie.md.");
  }
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" },
  });

  // Uitnodigings- of herstellink: tokens in het fragment (#access_token=…&type=invite|recovery)
  // of een token_hash in de query. Daarna direct het fragment uit de adresbalk halen.
  const type = hash.get("type") || params.get("type");
  if (hash.get("error_description")) {
    history.replaceState(null, "", location.pathname);
    show("f-login", { title: "Inloggen" });
    return alertMsg(/expired|invalid/i.test(hash.get("error_description")) ? "Deze link is verlopen of al gebruikt. Vraag een nieuwe uitnodiging of herstellink aan." : "De link is ongeldig.");
  }
  try {
    if (hash.get("access_token") && hash.get("refresh_token")) {
      busy(true, "Link controleren…");
      const { error } = await sb.auth.setSession({ access_token: hash.get("access_token"), refresh_token: hash.get("refresh_token") });
      history.replaceState(null, "", location.pathname + (type ? `?type=${encodeURIComponent(type)}` : ""));
      if (error) throw error;
      busy(false);
      return show("f-newpw", { title: type === "invite" ? "Welkom bij HQ" : "Nieuw wachtwoord", sub: type === "invite" ? "Stel je wachtwoord in om je account te activeren." : "" });
    }
    if (params.get("token_hash") && ["invite", "recovery"].includes(type)) {
      busy(true, "Link controleren…");
      const { error } = await sb.auth.verifyOtp({ token_hash: params.get("token_hash"), type });
      history.replaceState(null, "", location.pathname);
      if (error) throw error;
      busy(false);
      return show("f-newpw", { title: type === "invite" ? "Welkom bij HQ" : "Nieuw wachtwoord", sub: "" });
    }
  } catch (e) {
    busy(false);
    show("f-login", { title: "Inloggen" });
    return alertMsg("Deze link is verlopen of al gebruikt. Vraag een nieuwe aan.");
  }
  if (params.get("uitgelogd") === "1") info("Je bent uitgelogd.");
  if (params.get("verlopen") === "1") info("Je sessie is verlopen. Log opnieuw in.");
  show("f-login");
}

$("f-login").addEventListener("submit", async (e) => {
  e.preventDefault(); alertMsg(""); info("");
  const email = $("email").value.trim(), password = $("password").value;
  if (!email || !password) return alertMsg("Vul je e-mailadres en wachtwoord in.");
  busy(true, "Inloggen…");
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    $("password").value = "";
    await establish();
  } catch (err) { alertMsg(nl(err)); }
  finally { busy(false); }
});

$("to-forgot").addEventListener("click", () => { alertMsg(""); info(""); $("email2").value = $("email").value; show("f-forgot", { title: "Wachtwoord herstellen", sub: "" }); });
document.querySelectorAll("[data-back]").forEach(b => b.addEventListener("click", () => { alertMsg(""); show("f-login", { title: "Inloggen", sub: "Alleen voor uitgenodigde accounts." }); }));

$("f-forgot").addEventListener("submit", async (e) => {
  e.preventDefault(); alertMsg("");
  const email = $("email2").value.trim();
  if (!email) return alertMsg("Vul je e-mailadres in.");
  busy(true, "Versturen…");
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/login?type=recovery` });
    if (error && (error.status === 429)) throw error;
    // Altijd dezelfde melding: verraadt niet of een adres bestaat.
    info("Als dit adres bij HQ bekend is, ontvang je binnen enkele minuten een e-mail met een herstellink.");
  } catch (err) { alertMsg(nl(err)); }
  finally { busy(false); }
});

$("f-newpw").addEventListener("submit", async (e) => {
  e.preventDefault(); alertMsg("");
  const a = $("pw1").value, b = $("pw2").value;
  if (a.length < 12) return alertMsg("Kies minimaal 12 tekens.");
  if (a !== b) return alertMsg("De wachtwoorden zijn niet gelijk.");
  busy(true, "Opslaan…");
  try {
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) throw error;
    $("pw1").value = $("pw2").value = "";
    await establish();
  } catch (err) { alertMsg(nl(err)); }
  finally { busy(false); }
});

$("f-mfa").addEventListener("submit", async (e) => {
  e.preventDefault(); alertMsg(""); busy(true, "Controleren…");
  try { await verifyCode($("code").value.trim()); } catch (err) { alertMsg(nl(err)); } finally { busy(false); }
});
$("f-enroll").addEventListener("submit", async (e) => {
  e.preventDefault(); alertMsg(""); busy(true, "Activeren…");
  try { await verifyCode($("code2").value.trim()); } catch (err) { alertMsg(nl(err)); } finally { busy(false); }
});

boot();
