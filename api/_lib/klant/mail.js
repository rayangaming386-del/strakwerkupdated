// E-mail versturen vanaf het StrakWerk-adres via SMTP (gratis bij je bestaande mailbox,
// bijv. Gmail met een app-wachtwoord). Zonder SMTP-instellingen of met "live" uit wordt
// niets verstuurd: het bericht wordt als TEST vastgelegd (zichtbaar in HQ).
// Elk bericht krijgt een vaste Message-ID (op basis van het bericht-ID in HQ), zodat een
// antwoord (In-Reply-To) aan het juiste gesprek wordt gekoppeld.
import { createHmac } from "node:crypto";
import { env } from "../env.js";

const E = (k) => (process.env[k] ?? "").trim();
export const mailConfigured = () => Boolean(E("SMTP_HOST") && E("SMTP_USER") && E("SMTP_PASS"));
export const fromAddress = () => E("MAIL_FROM") || E("SMTP_USER") || "strakwerkk@gmail.com";
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

let transport = null;
async function getTransport() {
  if (transport) return transport;
  const nodemailer = (await import("nodemailer")).default;
  transport = nodemailer.createTransport({ host: E("SMTP_HOST"), port: Number(E("SMTP_PORT")) || 465, secure: (Number(E("SMTP_PORT")) || 465) === 465,
    auth: { user: E("SMTP_USER"), pass: E("SMTP_PASS") }, connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: Number(E("SMTP_TIMEOUT_MS")) || 20_000 });
  return transport;
}

/** Echt versturen. Een time-out na het aanbieden is "onduidelijk": niet automatisch opnieuw. */
export async function sendMail({ outreachId, leadId, to, subject, text }) {
  if (!mailConfigured()) throw new MailError("E-mail is niet gekoppeld (SMTP_HOST, SMTP_USER, SMTP_PASS).");
  const t = await getTransport();
  try {
    const info = await t.sendMail({ from: `Rayan van StrakWerk <${fromAddress()}>`, to, subject, text: text + footer(leadId), messageId: messageIdFor(outreachId),
      headers: { "List-Unsubscribe": `<${unsubscribeUrl(leadId)}>, <mailto:${fromAddress()}?subject=afmelden>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
    if (info.rejected?.length) throw new MailError(`Geweigerd door de mailserver: ${info.rejected.join(", ")}`);
    return { messageId: messageIdFor(outreachId), response: String(info.response || "").slice(0, 200) };
  } catch (e) {
    if (e instanceof MailError) throw e;
    const timeout = /timeout|ETIMEDOUT|ECONNRESET|socket/i.test(String(e.code || e.message));
    throw new MailError(`Versturen mislukt: ${String(e.message).slice(0, 160)}`, { retryable: !timeout && /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(String(e.code)), ambiguous: timeout });
  }
}
