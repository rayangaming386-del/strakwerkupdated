// Binnenkomende e-mail → juiste klantkaart. Gebruikt door de Cloudflare Email Worker
// (Email Routing, gratis) en door POST /api/public/inbound (met gedeeld geheim).
// Koppelen via In-Reply-To/References (Message-ID van ons bericht), anders via afzender.
// Een antwoord stopt geplande opvolging; afmelden of een bounce blokkeert verder contact.
import { registerReply } from "./sales.js";

const ids = (v) => String(v || "").match(/<[^<>\s]+>/g) || [];

export async function processInbound({ from, subject, text, inReplyTo, references, messageId }) {
  const refs = [...ids(inReplyTo), ...(Array.isArray(references) ? references.flatMap(ids) : ids(references))];
  try {
    const r = await registerReply({ text: String(text || "").slice(0, 8000), subject: subject ? String(subject).slice(0, 300) : null, from: from ? String(from).slice(0, 254) : null,
      in_reply_to: refs[0] || null, references: refs.slice(1), external_id: messageId ? String(messageId).slice(0, 300) : null, channel: "email" });
    return { matched: true, ...r };
  } catch (e) {
    if (e.status === 404) return { matched: false };
    throw e;
  }
}

/** Cloudflare Email Worker: bericht ontleden, verwerken en daarna doorsturen naar je eigen inbox. */
export async function handleEmailMessage(message, { forwardTo = null } = {}) {
  const { default: PostalMime } = await import("postal-mime");
  let result = { matched: false };
  try {
    const raw = await new Response(message.raw).arrayBuffer();
    const m = await PostalMime.parse(raw);
    result = await processInbound({ from: m.from?.address || message.from, subject: m.subject, text: m.text || (m.html || "").replace(/<[^>]+>/g, " "),
      inReplyTo: m.inReplyTo, references: m.references, messageId: m.messageId });
  } catch (e) {
    result = { matched: false, fout: String(e.message || e).slice(0, 200) };
    console.error(`[email] verwerken mislukt: ${result.fout}`);
  }
  // Altijd doorsturen (ook als verwerken mislukte): je mist nooit een antwoord.
  if (forwardTo) await message.forward(forwardTo).catch(e => console.error(`[email] doorsturen mislukt: ${e.message}`));
  return result;
}
