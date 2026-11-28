// E-mail versturen vanaf het StrakWerk-adres. Twee gratis routes:
// 1. Gmail API (productie, Cloudflare): HTTPS met een OAuth-vernieuwingstoken van het eigen
//    Gmail-account (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN). Alleen het
//    recht "gmail.send" is nodig. Gratis, binnen de normale verzendlimieten van Gmail.
// 2. SMTP (alleen lokaal/Node, bijv. Gmail met een app-wachtwoord). Werkt niet in Workers.
// Zonder route of met "live" uit wordt niets verstuurd: het bericht wordt als TEST vastgelegd.
// Antwoorden gaan naar MAIL_REPLY_TO (Cloudflare Email Routing → de Worker), zodat ze
// automatisch op de juiste klantkaart komen; anders naar het afzenderadres zelf.
import { createHmac, randomUUID } from "node:crypto";
import { env } from "../env.js";

const E = (k) => (process.env[k] ?? "").trim();
const IS_WORKERS = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
export const gmailConfigured = () => Boolean(E("GMAIL_CLIENT_ID") && E("GMAIL_CLIENT_SECRET") && E("GMAIL_REFRESH_TOKEN"));
export const smtpConfigured = () => !IS_WORKERS && Boolean(E("SMTP_HOST") && E("SMTP_USER") && E("SMTP_PASS"));
export const mailRoute = () => (gmailConfigured() ? "gmail_api" : smtpConfigured() ? "smtp" : null);
export const mailConfigured = () => Boolean(mailRoute());
export const missingMail = () => (mailConfigured() ? [] : ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"]);
export const fromAddress = () => E("MAIL_FROM") || E("SMTP_USER") || "strakwerkk@gmail.com";
export const replyTo = () => E("MAIL_REPLY_TO") || null;
export const messageIdFor = (outreachId) => `<${outreachId}@hq.strakwerkk.nl>`;

const unsubSecret = () => `${E("HQ_ENCRYPTION_KEY")}|${E("CRON_SECRET")}|afmelden`;
export function unsubscribeToken(leadId) {
  return `${leadId}.${createHmac("sha256", unsubSecret()).update(leadId).digest("base64url").slice(0, 22)}`;
}
export function checkUnsubscribeToken(t) {
  const [id, sig] = String(t || "").split(".");
  if (!id || !sig) return null;
  return unsubscribeToken(id) === t ? id : null;
}
export const unsubscribeUrl = (leadId) => `${env.siteUrl}/api/public/afmelden?t=${encodeURIComponent(unsubscribeToken(leadId))}`;

/** Voettekst: afzender duidelijk en afmelden met één klik. */
export function footer(leadId) {
  return `\n\n--\nRayan · StrakWerk, webdesign uit Zoetermeer\n${env.siteUrl.replace(/^https?:\/\//, "")} · ${fromAddress()}\nGeen berichten meer van mij? Afmelden: ${unsubscribeUrl(leadId)}`;
}

export class MailError extends Error {
  constructor(message, { retryable = false, ambiguous = false } = {}) { super(message); this.retryable = retryable; this.ambiguous = ambiguous; }
}

// ── MIME (platte tekst, UTF-8) ────────────────────────────────────────────────
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const clean = (s) => String(s || "").replace(/[\r\n]+/g, " ").trim();
export function buildMime({ outreachId, leadId, to, subject, text, inReplyTo = null }) {
  const headers = [
    `From: ${encWord("Rayan van StrakWerk")} <${fromAddress()}>`,
    `To: ${clean(to)}`,
    replyTo() ? `Reply-To: ${replyTo()}` : null,
    `Subject: ${encWord(clean(subject))}`,
    `Message-ID: ${messageIdFor(outreachId)}`,
    inReplyTo ? `In-Reply-To: ${clean(inReplyTo)}` : null,
    inReplyTo ? `References: ${clean(inReplyTo)}` : null,
    `Date: ${new Date().toUTCString()}`,
    `List-Unsubscribe: <${unsubscribeUrl(leadId)}>, <mailto:${fromAddress()}?subject=afmelden>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const body = b64(text + footer(leadId)).replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}\r\n`;
}

// ── Gmail API ────────────────────────────────────────────────────────────────
const GOOGLE_TOKEN = () => E("GMAIL_TOKEN_URL") || "https://oauth2.googleapis.com/token";
const GMAIL = () => (E("GMAIL_API_BASE") || "https://gmail.googleapis.com").replace(/\/+$/, "");
async function gmailToken() {
  let res;
  try {
    res = await fetch(GOOGLE_TOKEN(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ client_id: E("GMAIL_CLIENT_ID"), client_secret: E("GMAIL_CLIENT_SECRET"), refresh_token: E("GMAIL_REFRESH_TOKEN"), grant_type: "refresh_token" }) });
  } catch { throw new MailError("Google niet bereikbaar (token).", { retryable: true }); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new MailError(`Gmail-koppeling geweigerd (${j.error || res.status}). Vernieuw GMAIL_REFRESH_TOKEN.`);
  return j.access_token;
}
async function sendGmail(mime) {
  const token = await gmailToken();
  let res;
  try {
    res = await fetch(`${GMAIL()}/gmail/v1/users/me/messages/send`, { method: "POST", signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ raw: Buffer.from(mime, "utf8").toString("base64url") }) });
  } catch (e) {
    // Verzonden of niet? Onbekend: niet automatisch opnieuw (risico op dubbele mail).
    throw new MailError(`Geen antwoord van Gmail (${e?.name || "fout"}).`, { ambiguous: true });
  }
  const j = await res.json().catch(() => ({}));
  if (res.status >= 500) throw new MailError(`Gmail gaf ${res.status}.`, { ambiguous: true });
  if (res.status === 429) throw new MailError("Gmail-limiet bereikt; later opnieuw.", { retryable: true });
  if (!res.ok) throw new MailError(`Gmail weigerde het bericht (${j.error?.message || res.status}).`);
  // Gmail kan de Message-ID vervangen: probeer de echte terug te lezen (lukt alleen met leesrecht).
  // Zonder dat recht koppelt HQ een antwoord via het afzenderadres van de klant.
  let messageId = null;
  try {
    const m = await fetch(`${GMAIL()}/gmail/v1/users/me/messages/${encodeURIComponent(j.id)}?format=metadata&metadataHeaders=Message-ID`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    const mj = await m.json();
    messageId = (mj.payload?.headers || []).find(h => /^message-id$/i.test(h.name))?.value || null;
  } catch {}
  return { gmailId: j.id, threadId: j.threadId, messageId };
}

// ── SMTP (alleen Node) ───────────────────────────────────────────────────────
let transport = null;
async function smtpTransport() {
  // Niet-letterlijke import: zo komt nodemailer niet in de Cloudflare-bundel.
  const modName = "nodemailer";
  if (!transport) {
    const nodemailer = (await import(modName)).default;
    transport = nodemailer.createTransport({ host: E("SMTP_HOST"), port: Number(E("SMTP_PORT")) || 465, secure: (Number(E("SMTP_PORT")) || 465) === 465,
      auth: { user: E("SMTP_USER"), pass: E("SMTP_PASS") }, connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: Number(E("SMTP_TIMEOUT_MS")) || 20_000 });
  }
  return transport;
}
async function sendSmtp({ to, subject, text, outreachId, leadId }) {
  await smtpTransport();
  try {
    const info = await transport.sendMail({ from: `Rayan van StrakWerk <${fromAddress()}>`, to, replyTo: replyTo() || undefined, subject, text: text + footer(leadId), messageId: messageIdFor(outreachId),
      headers: { "List-Unsubscribe": `<${unsubscribeUrl(leadId)}>, <mailto:${fromAddress()}?subject=afmelden>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
    if (info.rejected?.length) throw new MailError(`Geweigerd door de mailserver: ${info.rejected.join(", ")}`);
    return { messageId: messageIdFor(outreachId) };
  } catch (e) {
    if (e instanceof MailError) throw e;
    const timeout = /timeout|ETIMEDOUT|ECONNRESET|socket/i.test(String(e.code || e.message));
    throw new MailError(`Versturen mislukt: ${String(e.message).slice(0, 160)}`, { retryable: !timeout && /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(String(e.code)), ambiguous: timeout });
  }
}

/** Echt versturen. Een time-out na het aanbieden is "onduidelijk": niet automatisch opnieuw. */
export async function sendMail({ outreachId, leadId, to, subject, text, inReplyTo = null }) {
  const route = mailRoute();
  if (!route) throw new MailError(`E-mail is niet gekoppeld (${missingMail().join(", ")}).`);
  if (route === "gmail_api") {
    const r = await sendGmail(buildMime({ outreachId, leadId, to, subject, text, inReplyTo }));
    return { messageId: r.messageId || messageIdFor(outreachId), gmailId: r.gmailId, route };
  }
  return { ...(await sendSmtp({ outreachId, leadId, to, subject, text })), route };
}

/**
 * Korte melding aan de eigenaar zelf (geen marketing, dus geen afmeldregel). Tip: laat meldingen
 * naar een ánder adres gaan dan het afzenderadres; mail aan jezelf geeft in Gmail vaak geen pushmelding.
 */
export async function sendSimpleMail({ to, subject, text }) {
  const route = mailRoute();
  if (!route) throw new MailError(`E-mail is niet gekoppeld (${missingMail().join(", ")}).`);
  if (route === "gmail_api") {
    const mime = [
      `From: ${encWord("StrakWerk HQ")} <${fromAddress()}>`, `To: ${clean(to)}`, `Subject: ${encWord(clean(subject))}`,
      `Message-ID: <${randomUUID()}@hq.strakwerkk.nl>`, `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64",
    ].join("\r\n") + `\r\n\r\n${b64(text).replace(/(.{76})/g, "$1\r\n")}\r\n`;
    await sendGmail(mime);
    return { route };
  }
  await (await smtpTransport()).sendMail({ from: `StrakWerk HQ <${fromAddress()}>`, to, subject, text });
  return { route };
}
