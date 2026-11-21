// Publieke ingangen van HQ (zonder inlog), onder /api/public/*:
//   POST aanvraag        formulier op de site → klantkaart + Sales-taak (honeypot, herkomstcontrole, limiet)
//   GET/POST afmelden    afmelden met één klik (ondertekende link uit elke mail)
//   POST inbound         binnenkomende mail (bijv. Cloudflare Email Worker) met gedeeld geheim
//   GET/POST intake      persoonlijke intake-link van één project (token, geen account)
import { createHash, timingSafeEqual } from "node:crypto";
import { q, one, tx } from "./_lib/db.js";
import { env } from "./_lib/env.js";
import { json, errorResponse, readJson, clientIp, HttpError, str } from "./_lib/http.js";
import { intakeRequest, registerReply } from "./_lib/klant/sales.js";
import { suppress } from "./_lib/klant/contact.js";
import { checkUnsubscribeToken } from "./_lib/klant/mail.js";
import { intakeView, saveIntake } from "./_lib/klant/project.js";

const html = (body, status = 200) => new Response(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>StrakWerk</title>
<style>body{margin:0;background:#070708;color:#eee;font:16px/1.55 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px}main{max-width:460px;border:1px solid #2a2a2e;padding:28px;border-radius:2px}h1{font-size:22px;margin:0 0 10px;color:#E2CA97}button{background:#B9975B;color:#070708;border:0;padding:12px 18px;font-weight:600;border-radius:2px;cursor:pointer}a{color:#E2CA97}</style></head><body><main>${body}</main></body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" } });

// Eenvoudige limiet per IP-hash per uur (tabel-loos: via audit_log zou te zwaar zijn; interactions telt per bron).
async function rateLimited(ip, kind, max) {
  const key = createHash("sha256").update(`${ip}|${kind}|${new Date().toISOString().slice(0, 13)}`).digest("hex").slice(0, 32);
  const r = await one(`insert into hq.settings (key, value, updated_at) values ($1, '{"n":1}'::jsonb, now())
    on conflict (key) do update set value=jsonb_build_object('n', (hq.settings.value->>'n')::int + 1), updated_at=now() returning (value->>'n')::int as n`, [`rl:${key}`]);
  return r.n > max;
}

function sameSite(request) {
  const allowed = new Set([new URL(env.siteUrl).host, "strakwerkk.nl", "www.strakwerkk.nl"]);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (host) allowed.add(host);
  const o = request.headers.get("origin") || request.headers.get("referer");
  if (!o) return false;
  try { return allowed.has(new URL(o).host); } catch { return false; }
}

function secretOk(given) {
  const want = (process.env.HQ_INBOUND_SECRET || "").trim();
  if (!want || !given) return false;
  const a = Buffer.from(createHash("sha256").update(want).digest("hex")), b = Buffer.from(createHash("sha256").update(String(given)).digest("hex"));
  return timingSafeEqual(a, b);
}

async function handle(request) {
  try {
    const url = new URL(request.url);
    const path = (url.searchParams.get("p") || url.pathname.replace(/^\/api\/public\/?/, "")).replace(/^\/+|\/+$/g, "");
    const m = request.method;

    if (path === "aanvraag" && m === "POST") {
      if (!sameSite(request)) throw new HttpError(403, "herkomst", "Verzoek geweigerd.");
      const body = await readJson(request, 16 * 1024);
      if (body.website_url || body.hp) return json({ ok: true }); // honeypot: stil negeren
      if (await rateLimited(clientIp(request), "aanvraag", 8)) throw new HttpError(429, "limiet", "Te veel aanvragen; probeer het later of stuur een WhatsApp.");
      const r = await intakeRequest({
        name: body.name, company: body.company, email: body.email, phone: body.phone, message: body.message, type: body.type, website: body.site,
        channel: "formulier", page: body.page, ref: body.ref, utm: body.utm, external_id: typeof body.form_id === "string" && /^[a-z0-9-]{8,64}$/i.test(body.form_id) ? `form:${body.form_id}` : null,
        is_test: url.searchParams.get("sw_test") === "1" || body.sw_test === true,
      });
      return json({ ok: true, duplicate: r.duplicate });
    }

    if (path === "afmelden") {
      const leadId = checkUnsubscribeToken(url.searchParams.get("t"));
      if (!leadId) return html("<h1>Link ongeldig</h1><p>Deze afmeldlink klopt niet. Stuur een mail met 'afmelden' en ik haal je direct van de lijst.</p>", 400);
      const lead = await one("select * from hq.leads where id=$1", [leadId]);
      if (m === "GET" && !lead) return html("<h1>Afgemeld</h1><p>Je ontvangt geen berichten meer van StrakWerk.</p>");
      if (m === "GET") return html(`<h1>Afmelden</h1><p>Wil je geen berichten meer van StrakWerk ontvangen?</p><form method="post"><button>Ja, afmelden</button></form>`);
      if (lead) await tx(async (db) => {
        await suppress({ lead, reason: "afmelding", note: "Via afmeldlink" }, db);
        await db.query("update hq.leads set status='afgemeld', awaiting_reply_since=null, updated_at=now() where id=$1", [lead.id]);
        await db.query("insert into hq.interactions (lead_id, direction, channel, kind, body, is_test, created_label) values ($1,'in','email','afmelding','Afgemeld via de link in de mail',$2,'afmeldlink')", [lead.id, lead.is_test]);
      });
      // One-click (RFC 8058) verwacht alleen een 2xx.
      return html("<h1>Afgemeld</h1><p>Je ontvangt geen berichten meer van StrakWerk. Sorry voor het storen.</p>");
    }

    if (path === "inbound" && m === "POST") {
      if (!secretOk(request.headers.get("x-hq-inbound-secret"))) throw new HttpError(401, "geheim", "Niet toegestaan.");
      const b = await readJson(request, 256 * 1024);
      const r = await registerReply({ text: str(b.text, 8000) || "", subject: str(b.subject, 300), from: str(b.from, 254), in_reply_to: str(b.in_reply_to, 300), external_id: str(b.message_id, 300), channel: "email" })
        .catch(e => (e.status === 404 ? { unmatched: true } : Promise.reject(e)));
      return json({ ok: true, ...r });
    }

    if (path === "intake") {
      const t = url.searchParams.get("t");
      if (m === "GET") return json(await intakeView(t));
      if (m === "POST") {
        if (!sameSite(request)) throw new HttpError(403, "herkomst", "Verzoek geweigerd.");
        if (await rateLimited(clientIp(request), "intake", 60)) throw new HttpError(429, "limiet", "Even wachten en opnieuw proberen.");
        return json(await saveIntake(t, await readJson(request, 4_400_000)));
      }
    }
    return json({ error: "niet_gevonden" }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}

export const GET = handle, POST = handle;
