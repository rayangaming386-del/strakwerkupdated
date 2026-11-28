// Salesmotor in HQ: meldingen, bel- en bezoeklijst met belcoach, berichten na een gesprek,
// voorbeeldsite, rechtsvorm, offertelink en de verkoopinstellingen. Alle tekst via textContent.
import { h, fmt, toast, empty, modal, field } from "../ui.js";
import { api } from "../api.js";
import { put, envQs, copyBtn, waHref, mailHref } from "./klant-ui.js";

export const LEGAL = { bv: "Bv", nv: "Nv", stichting: "Stichting", vereniging: "Vereniging", cooperatie: "Coöperatie", eenmanszaak: "Eenmanszaak", vof: "Vof", maatschap: "Maatschap", cv: "Cv", onbekend: "Onbekend" };
const LEGAL_SRC = { naam: "bedrijfsnaam", website: "eigen website", kvk: "KvK-register", klant: "opgegeven door de klant" };
const POSITIVE = ["interesse", "afspraak", "offerte", "terugbellen"];
const POST_LABEL = { voorbeeldsite: "Voorbeeldsites", acquisitie: "Bellen, langsgaan en berichten", websitecheck: "Gratis websitecheck", sales: "Offertes en opvolging", controle: "Controle", overig: "Overig" };
const todayIso = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam" }).format(new Date());
const eurCents = (c) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(c / 100); // bedragen om te betalen: met centen

/** Knop die een actie uitvoert, fouten als melding toont en daarna ververst. */
export const actBtn = (label, fn, after, cls = "") => h("button", { class: `btn btn-sm ${cls}`, type: "button", onclick: async (e) => {
  const b = e.currentTarget; b.disabled = true;
  try { await fn(); if (after) await after(); } catch (err) { toast(err.message, "bad"); } finally { b.disabled = false; }
} }, label);

// ── Meldingen ────────────────────────────────────────────────────────────────
export async function notificationsSection(refresh) {
  let r;
  try { r = await api(`meldingen${envQs()}`); } catch (e) { return h("p", { class: "muted" }, `Meldingen niet geladen: ${e.message}`); }
  const items = r.meldingen.slice(0, 8);
  return h("section", { class: "stack", "aria-labelledby": "v-meld" },
    h("div", { class: "section-h" }, h("h2", { id: "v-meld" }, `Meldingen${r.ongelezen ? ` (${r.ongelezen} nieuw)` : ""}`),
      h("p", { class: "muted" }, r.email ? `Ook per e-mail naar ${r.email}, binnen 5 minuten (behalve in je stille uren).` : "Per e-mail: koppel e-mail en kies een adres bij Kantoor › Instellingen.")),
    r.waarschuwing ? h("div", { class: "callout" }, r.waarschuwing) : null,
    items.length ? h("div", { class: "stack" }, items.map(n => h("div", { class: `card stack note-item${n.read_at ? "" : " unread"}` },
      h("div", { class: "row", style: { justifyContent: "space-between" } }, h("strong", {}, n.title), h("span", { class: "faint", style: { fontSize: ".78rem" } }, fmt.ago(n.created_at))),
      n.body ? h("p", { class: "muted", style: { margin: 0, whiteSpace: "pre-wrap" } }, n.body) : null,
      n.url ? h("a", { href: n.url, "data-nav": "" }, "Open →") : null))) : empty("Geen meldingen", "Aanvragen, akkoorden en bekeken offertes of voorbeeldsites verschijnen hier."),
    r.ongelezen ? h("div", {}, actBtn("Alles gelezen", () => api("meldingen/gelezen", { method: "POST", body: {} }), refresh)) : null);
}

// ── Bel- en bezoeklijst ──────────────────────────────────────────────────────
export function callsSection(d, refresh) {
  const all = [...(d.calls || []), ...(d.visits || [])];
  const head = h("div", { class: "section-h" }, h("h2", { id: "v-bel" }, `Bellen (${d.calls.length}) en langsgaan (${d.visits.length})`),
    h("p", { class: "muted" }, "Bellen alleen waar het mag: een bv, nv, stichting of vereniging, of met toestemming, of een klant. Een eenmanszaak of vof bel je niet ongevraagd: daar ga je langs als er echte potentie is."));
  const tools = h("div", { class: "row" },
    actBtn("Lijst aanvullen", async () => { const r = await api("bellijst/maken", { method: "POST", body: {} }); toast(r.overgeslagen ? `Geen werkdag: ${r.overgeslagen}.` : `Bellen +${r.bellen}, langsgaan +${r.bezoek}${r.terugbellen ? `, terugbellen ${r.terugbellen}` : ""}.`); }, refresh),
    !all.length ? actBtn("Toch een lijst maken", () => api("bellijst/maken", { method: "POST", body: { force: true } }), refresh) : null);
  return h("section", { class: "stack", "aria-labelledby": "v-bel" }, head, tools,
    all.length ? h("div", { class: "stack" }, all.map(c => callCard(c, d.outcomes || {}, refresh))) : empty("Nog geen lijst voor vandaag", "De lijst komt na het ochtendoverleg op je werkdagen. Bedrijven vindt Scout; bellen alleen als het mag."));
}

function briefingBox(c) {
  const b = c.briefing || {};
  const p = (label, text, cls) => text ? h("div", { class: `brief-p ${cls || ""}` }, h("small", {}, label), h("p", {}, text)) : null;
  return h("details", { class: "brief" }, h("summary", {}, `${c.kind === "bezoek" ? "Bezoekcoach" : "Belcoach"} (${c.briefing_by === "Claude" ? "met AI" : "vaste tekst"})`),
    h("div", { class: "stack" },
      p("Opening", b.opening), p("Voorstel (prijs uit je prijslijst)", b.voorstel),
      (b.vragen || []).length ? h("div", { class: "brief-p" }, h("small", {}, "Vragen"), h("ul", { class: "acts" }, b.vragen.map(v => h("li", {}, v)))) : null,
      (b.bezwaren || []).length ? h("div", { class: "brief-p" }, h("small", {}, "Bezwaren"), h("dl", { class: "brief-kv" }, b.bezwaren.flatMap(x => [h("dt", {}, x.bezwaar), h("dd", {}, x.antwoord)]))) : null,
      p("Afsluiter", b.afsluiter), p("Recht van bezwaar (altijd aanbieden)", b.verzet, "hl"),
      (b.let_op || []).length ? h("div", { class: "brief-p" }, h("small", {}, "Let op"), h("ul", { class: "acts" }, b.let_op.map(v => h("li", {}, v)))) : null));
}

function callCard(c, outcomes, refresh) {
  const done = Boolean(c.outcome);
  const consents = c.consents || [];
  const phone = c.contact_phone ? String(c.contact_phone) : null;
  const where = c.kind === "bezoek"
    ? (c.address ? h("a", { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.address}`)}`, target: "_blank", rel: "noopener" }, c.address) : h("span", { class: "muted" }, "Geen adres"))
    : (phone ? h("a", { class: "btn btn-sm btn-gold", href: `tel:${phone}` }, `Bel ${phone.replace(/^\+31/, "0")}`) : null);
  const card = h("div", { class: `card stack call-card${done ? " done" : ""}` },
    h("div", { class: "row", style: { justifyContent: "space-between" } },
      h("strong", {}, `${c.company}${c.city ? ` · ${c.city}` : ""}`),
      h("div", { class: "row" }, h("span", { class: "badge" }, c.kind === "bezoek" ? "Langsgaan" : "Bellen"), c.priority ? h("span", { class: `badge ${c.priority === "hoog" ? "b-gold" : ""}` }, c.priority) : null,
        done ? h("span", { class: "badge b-info" }, outcomes[c.outcome] || c.outcome) : null)),
    h("div", { class: "row" }, where, c.legal_form ? h("span", { class: "faint", style: { fontSize: ".78rem" } }, `${LEGAL[c.legal_form] || c.legal_form}${c.legal_form_source ? ` (${LEGAL_SRC[c.legal_form_source] || c.legal_form_source})` : ""}`) : null),
    c.priority_reason ? h("p", { class: "faint", style: { margin: 0, fontSize: ".82rem" } }, c.priority_reason) : null,
    h("div", { class: "row" },
      c.preview_slug ? h("a", { class: "btn btn-sm", href: `/voorbeeld/${c.preview_slug}`, target: "_blank", rel: "noopener" }, `Voorbeeldsite${c.preview_views ? ` (${c.preview_views}× bekeken)` : ""}`)
        : actBtn("Maak voorbeeldsite", async () => { await api(`klanten/${c.lead_id}/voorbeeld`, { method: "POST", body: {} }); toast("Voorbeeldsite wordt gemaakt; over een minuut staat de link hier."); }, refresh),
      h("a", { class: "btn btn-sm", href: `/hq/klanten?id=${c.lead_id}`, "data-nav": "" }, "Klantkaart")),
    briefingBox(c),
    done ? afterCall(c, consents, refresh) : outcomeForm(c, outcomes, refresh));
  return card;
}

function outcomeForm(c, outcomes, refresh) {
  let chosen = null;
  const extra = h("div", { class: "stack" });
  const notes = h("textarea", { rows: 2, placeholder: "Notitie (bijv. wat ze willen, wanneer terugbellen)" });
  const date = h("input", { type: "date", min: todayIso(), value: todayIso() });
  const cb = (ch, label) => h("label", { class: "check" }, h("input", { type: "checkbox", value: ch }), " ", label);
  const consentBox = h("div", { class: "stack" },
    h("p", { class: "muted", style: { margin: 0, fontSize: ".85rem" } }, "Vroeg je \"Mag ik je een voorbeeld appen of mailen?\" en was het antwoord ja?"),
    h("div", { class: "row" }, cb("whatsapp", "Mag appen"), cb("email", "Mag mailen"), c.kind === "bezoek" ? cb("telefoon", "Mag bellen") : null));
  const email = h("input", { type: "email", placeholder: "E-mailadres dat je kreeg", value: c.contact_email || "" });
  const phone = h("input", { type: "tel", placeholder: "Telefoonnummer dat je kreeg", value: c.contact_phone || "" });
  const chips = h("div", { class: "chips", role: "group", "aria-label": "Uitkomst" }, Object.entries(outcomes).map(([k, l]) => h("button", { class: "chip", type: "button", "aria-pressed": "false", onclick: (e) => {
    chosen = k; chips.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
    put(extra, k === "terugbellen" ? field(c.kind === "bezoek" ? "Wanneer terugkomen of bellen?" : "Wanneer terugbellen?", date) : null,
      POSITIVE.includes(k) ? consentBox : null,
      POSITIVE.includes(k) && !c.contact_email ? field("E-mail (als je die kreeg)", email) : null,
      POSITIVE.includes(k) && !c.contact_phone ? field("Telefoon (als je die kreeg)", phone) : null,
      k === "niet_bellen" ? h("div", { class: "callout" }, "Dit bedrijf krijgt dan nooit meer contact van HQ (alle kanalen) en de voorbeeldsite gaat offline.") : null);
  } }, l)));
  const save = h("button", { class: "btn btn-sm btn-gold", type: "button", onclick: async (e) => {
    if (!chosen) return toast("Kies eerst de uitkomst.", "bad");
    if (chosen === "niet_bellen" && !confirm(`${c.company} nooit meer benaderen?`)) return;
    const consent = [...consentBox.querySelectorAll("input:checked")].map(i => i.value);
    const b = e.currentTarget; b.disabled = true;
    try {
      const r = await api(`bellijst/${c.id}/uitkomst`, { method: "POST", body: { outcome: chosen, notes: notes.value, callback_on: chosen === "terugbellen" ? date.value : undefined,
        consent: POSITIVE.includes(chosen) ? consent : [], email: email.value.trim() || undefined, phone: phone.value.trim() || undefined } });
      toast(`Opgeslagen${r.consents?.length ? `: toestemming voor ${r.consents.join(" en ")} vastgelegd` : ""}.`);
      await refresh();
    } catch (err) { toast(err.message, "bad"); } finally { b.disabled = false; }
  } }, "Opslaan");
  return h("div", { class: "stack outcome" }, h("small", { class: "muted" }, "Uitkomst"), chips, extra, notes, h("div", {}, save));
}

function afterCall(c, consents, refresh) {
  if (!POSITIVE.includes(c.outcome)) return c.notes ? h("p", { class: "muted", style: { margin: 0 } }, c.notes) : null;
  const compose = (channel) => actBtn(channel === "whatsapp" ? "Bericht via WhatsApp" : "Bericht via e-mail", async () => {
    const r = await api(`klanten/${c.lead_id}/bericht-na-gesprek`, { method: "POST", body: { channel, notes: c.notes || undefined } });
    messageDialog(r.outreach, r.wa_link, refresh);
  }, null, "btn-gold");
  return h("div", { class: "stack" },
    c.notes ? h("p", { class: "muted", style: { margin: 0 } }, c.notes) : null,
    consents.length ? h("div", { class: "row" }, consents.includes("whatsapp") ? compose("whatsapp") : null, consents.includes("email") ? compose("email") : null)
      : h("p", { class: "faint", style: { margin: 0, fontSize: ".82rem" } }, "Nog geen toestemming voor appen of mailen vastgelegd. Dat kan op de klantkaart (Contactgrond vastleggen)."));
}

/** Persoonlijk bericht tonen met de juiste verstuurknoppen (WhatsApp of e-mail). */
export function messageDialog(o, wa, refresh) {
  const wrap = h("div", { class: "stack" }, h("pre", { class: "pre" }, o.body),
    o.channel === "email" ? h("p", { class: "faint", style: { margin: 0, fontSize: ".8rem" } }, `Aan ${o.to_address}. Een afmeldlink komt er automatisch onder.`) : null);
  const { close } = modal(o.channel === "whatsapp" ? "Bericht via WhatsApp" : "Bericht via e-mail", wrap, [
    ...(o.channel === "whatsapp" ? [{ label: "Open WhatsApp", onClick: async () => { window.open(wa || waHref(o.to_address, o.body), "_blank", "noopener"); } }]
      : [{ label: "Verstuur vanuit HQ", cls: "btn-gold", onClick: async (cl) => { try { await api(`outreach/${o.id}/versturen`, { method: "POST", body: {} }); toast("Verstuurd. De opvolging over 7 dagen staat voor je klaar."); cl(); refresh && refresh(); } catch (e) { toast(e.message, "bad"); } } }]),
    { label: o.channel === "whatsapp" ? "Ik heb het verstuurd" : "Zelf verstuurd", cls: o.channel === "whatsapp" ? "btn-gold" : "", onClick: async (cl) => { await api(`outreach/${o.id}/verstuurd`, { method: "POST", body: {} }); toast("Gemarkeerd als verstuurd."); cl(); refresh && refresh(); } },
  ]);
  return close;
}

/** Knoppen voor een klaargezet bericht (lijst op Vandaag en op de klantkaart). */
export function outreachButtons(o, refresh) {
  return h("div", { class: "row" }, copyBtn(o.body),
    o.channel === "whatsapp" ? h("a", { class: "btn btn-sm", href: waHref(o.to_address, o.body), target: "_blank", rel: "noopener" }, "Open WhatsApp")
      : h("a", { class: "btn btn-sm", href: mailHref(o.to_address, o.subject, o.body) }, "Open mail"),
    o.channel === "email" && o.status === "concept" ? actBtn("Verstuur vanuit HQ", () => api(`outreach/${o.id}/versturen`, { method: "POST", body: {} }), refresh, "btn-gold") : null,
    actBtn("Ik heb het verstuurd", () => api(`outreach/${o.id}/verstuurd`, { method: "POST", body: {} }), refresh, o.channel === "email" && o.status === "concept" ? "" : "btn-gold"));
}

// ── Klantkaart ───────────────────────────────────────────────────────────────
export function salesCardSections(d, id, ctx, refresh) {
  const l = d.lead;
  const sec = (title, ...c) => h("section", { class: "card stack" }, h("h2", { style: { fontSize: "1.02rem", margin: 0 } }, title), ...c);
  const out = [];
  // Bellen en rechtsvorm.
  const bel = d.contact?.bellen;
  out.push(sec("Bellen en rechtsvorm",
    h("p", { style: { margin: 0 } }, bel?.allowed ? `Bellen mag: ${bel.label}.` : `Bellen niet: ${bel?.reason || "onbekend"}.`),
    h("p", { class: "muted", style: { margin: 0 } }, `Rechtsvorm: ${LEGAL[l.legal_form || "onbekend"]}${l.legal_form_source ? ` (${LEGAL_SRC[l.legal_form_source] || l.legal_form_source}${l.legal_form_evidence ? `: ${l.legal_form_evidence}` : ""})` : ""}`),
    ctx.can("leads.write") ? h("div", { class: "row" }, actBtn("Rechtsvorm vastleggen", () => legalDialog(id, l), refresh),
      h("a", { class: "btn btn-sm", href: `https://www.kvk.nl/zoeken/?source=all&q=${encodeURIComponent(l.company)}`, target: "_blank", rel: "noopener" }, "Zoek in het KvK-register")) : null));
  // Voorbeeldsite.
  const pv = d.preview, task = d.preview_task;
  const style = h("select", { "aria-label": "Stijl" }, [["", "Stijl: automatisch"], ["strak", "Strak (donker)"], ["licht", "Licht"], ["warm", "Warm"], ["fris", "Fris"]].map(([v, t]) => h("option", { value: v }, t)));
  out.push(sec("Voorbeeldsite",
    pv ? h("div", { class: "stack" },
      h("div", { class: "row" }, h("a", { class: "btn btn-sm btn-gold", href: pv.url, target: "_blank", rel: "noopener" }, "Open voorbeeldsite"), copyBtn(`${location.origin}${pv.url}`, "Kopieer link")),
      h("p", { class: "muted", style: { margin: 0 } }, `${pv.views ? `${pv.views}× bekeken door de klant (eerst ${fmt.dt(pv.first_viewed_at)}, laatst ${fmt.ago(pv.last_viewed_at)})` : "Nog niet bekeken"} · ${pv.status} · verloopt ${fmt.day(pv.expires_at)} · teksten: ${pv.content_by}`))
      : h("p", { class: "muted", style: { margin: 0 } }, task?.status === "in_wachtrij" || task?.status === "bezig" ? "Wordt gemaakt…" : task?.status === "mislukt" ? `Maken mislukt: ${task.error || "onbekende fout"}` : "Nog geen voorbeeldsite. Een eigen voorbeeld overtuigt sneller dan elk verhaal."),
    ctx.can("leads.write") && !d.suppressed ? h("div", { class: "row" }, style, actBtn(pv ? "Opnieuw maken" : "Maak voorbeeldsite", async () => { await api(`klanten/${id}/voorbeeld`, { method: "POST", body: { style: style.value || undefined } }); toast("Voorbeeldsite wordt gemaakt."); }, refresh, "btn-gold")) : null));
  // Gesprekken en bezoeken.
  if ((d.calls || []).length) out.push(sec("Gesprekken en bezoeken", h("ul", { class: "acts" }, d.calls.map(c => h("li", {}, `${fmt.day(c.day)} · ${c.kind === "bezoek" ? "bezoek" : "bellen"} · ${c.outcome ? c.outcome.replace(/_/g, " ") : "nog open"}${c.callback_on ? ` · terug op ${fmt.day(c.callback_on)}` : ""}${c.notes ? ` · ${c.notes}` : ""}`)))));
  // Verwijslink voor klanten.
  if (l.status === "gewonnen") out.push(sec("Verwijzen", h("p", { class: "muted", style: { margin: 0 } }, "Een eigen link voor deze klant: aanvragen via deze link worden aan deze klant gekoppeld."),
    h("div", {}, actBtn("Toon verwijslink", async () => { const r = await api(`klanten/${id}/verwijslink`); modal("Verwijslink", h("div", { class: "stack" }, h("pre", { class: "pre" }, r.url), copyBtn(r.url, "Kopieer link"))); }))));
  return out;
}

/** Offertelink, bekeken, geldigheid, aanbetaling en verlengen (onder de offerte op de klantkaart). */
export function quoteExtras(d, quote, ctx, refresh) {
  if (!quote) return null;
  const url = d.quote_urls?.[quote.id];
  const paid = (d.payments || []).filter(p => p.quote_id === quote.id || !p.quote_id).some(p => ["aanbetaling", "volledig"].includes(p.kind));
  const expired = quote.valid_until && new Date(quote.valid_until) < new Date();
  return h("div", { class: "stack" },
    url ? h("div", { class: "row" }, copyBtn(`${location.origin}${url}`, "Kopieer offertelink"), h("a", { class: "btn btn-sm", href: url, target: "_blank", rel: "noopener" }, "Open offertepagina")) : null,
    quote.status === "verstuurd" || quote.status === "geaccepteerd" ? h("p", { class: "muted", style: { margin: 0 } },
      `${quote.view_count ? `${quote.view_count}× bekeken (eerst ${fmt.dt(quote.viewed_at)})` : "Nog niet bekeken"}${quote.valid_until ? ` · geldig tot ${fmt.day(quote.valid_until)}${expired ? " (verlopen)" : ""}` : ""}${quote.deposit_cents ? ` · aanbetaling ${eurCents(quote.deposit_cents)} ${paid ? "ontvangen" : "nog niet ontvangen"}` : ""}`) : null,
    quote.status === "verstuurd" && ctx.can("quotes.write") && (expired || (quote.valid_until && new Date(quote.valid_until) < new Date(Date.now() + 3 * 864e5)))
      ? h("div", {}, actBtn("Verlengen", () => api(`offertes/${quote.id}/verlengen`, { method: "POST", body: {} }), refresh)) : null);
}

async function legalDialog(id, l) {
  const form = h("select", {}, Object.entries(LEGAL).map(([v, t]) => h("option", { value: v, selected: v === (l.legal_form || "onbekend") }, t)));
  const src = h("select", {}, [["kvk", "KvK-register (zelf gecontroleerd)"], ["klant", "Opgegeven door de klant"]].map(([v, t]) => h("option", { value: v }, t)));
  const ev = h("input", { placeholder: "Bijv. KvK-nummer of wat je zag" });
  return new Promise((ok) => modal("Rechtsvorm vastleggen", h("div", { class: "fgrid" }, field("Rechtsvorm", form), field("Bron", src), field("Toelichting", ev, { full: true, help: "Bellen voor verkoop mag alleen bij een bv, nv, stichting, vereniging of coöperatie (of met toestemming, of bij een klant)." })), [
    { label: "Vastleggen", cls: "btn-gold", onClick: async (close) => { try { const r = await api(`klanten/${id}/rechtsvorm`, { method: "POST", body: { legal_form: form.value, source: src.value, evidence: ev.value || undefined } }); toast(r.bellen?.allowed ? "Vastgelegd: bellen mag." : `Vastgelegd. Bellen niet: ${r.bellen?.reason}.`); close(); ok(); } catch (e) { toast(e.message, "bad"); } } }]));
}

// ── Kantoor: verkoopinstellingen, budget per post en bestaande klanten ─────────
export function salesSettings(d, ctx, refresh) {
  const pay = d.settings.payment || {}, links = d.settings.links || {}, sa = d.settings.sales_ai || {};
  const inp = (attrs) => h("input", attrs);
  const f = {
    method: h("select", {}, [["contant", "Contant (voorkeur)"], ["beide", "Contant, of overmaken als het moet"], ["bank", "Alleen overmaken"]].map(([v, t]) => h("option", { value: v, selected: v === (pay.method || "contant") }, t))),
    iban: inp({ value: pay.iban || "", placeholder: "Alleen nodig als overmaken mag", autocomplete: "off" }), account_name: inp({ value: pay.account_name || "", placeholder: "Tenaamstelling" }),
    deposit_pct: inp({ type: "number", min: 0, max: 100, value: pay.deposit_pct ?? 50 }), quote_valid_days: inp({ type: "number", min: 1, max: 90, value: pay.quote_valid_days ?? 14 }),
    notify_email: inp({ type: "email", value: sa.notify_email || "", placeholder: "Adres voor meldingen (niet het afzendadres)" }),
    google_review_url: inp({ value: links.google_review_url || "", placeholder: "https://g.page/r/…/review" }), referral_reward: inp({ value: links.referral_reward || "", placeholder: "Bijv. een maand gratis onderhoud (leeg = geen beloning)" }),
    calls_per_day: inp({ type: "number", min: 0, max: 30, value: sa.calls_per_day ?? 5 }), visits_per_day: inp({ type: "number", min: 0, max: 20, value: sa.visits_per_day ?? 5 }), checks_per_day: inp({ type: "number", min: 0, max: 200, value: sa.checks_per_day ?? 40 }),
  };
  const save = async (e) => { e.preventDefault(); try {
    await api("kantoor/instellingen/payment", { method: "PUT", body: { method: f.method.value, iban: f.iban.value.trim() || null, account_name: f.account_name.value, deposit_pct: Number(f.deposit_pct.value), quote_valid_days: Number(f.quote_valid_days.value) } });
    await api("kantoor/instellingen/links", { method: "PUT", body: { google_review_url: f.google_review_url.value.trim() || null, referral_reward: f.referral_reward.value.trim() || null } });
    await api("kantoor/instellingen/sales_ai", { method: "PUT", body: { notify_email: f.notify_email.value.trim() || null, calls_per_day: Number(f.calls_per_day.value), visits_per_day: Number(f.visits_per_day.value), checks_per_day: Number(f.checks_per_day.value) } });
    toast("Opgeslagen."); refresh(); } catch (err) { toast(err.message, "bad"); } };
  const card = (title, ...c) => h("section", { class: "card stack" }, h("h2", { style: { fontSize: "1.02rem", margin: 0 } }, title), ...c);
  const posts = d.ai?.posts;
  return [
    card("Verkoop", d.websitecheck ? h("p", { class: "muted", style: { margin: 0 } }, `Gratis websitecheck: ${d.websitecheck.dag} vandaag, ${d.websitecheck.week} deze week, waarvan ${d.websitecheck.aanvragen_week} met gegevens (aanvraag).`) : null,
      h("form", { class: "fgrid", onsubmit: save },
      field("Betaalwijze aanbetaling", f.method, { help: "Contant: de klant betaalt bij de start en krijgt een betaalbewijs. Leg de betaling daarna vast op de klantkaart (Betaling › Contant)." }),
      field("IBAN (alleen bij overmaken)", f.iban), field("Tenaamstelling", f.account_name), field("Aanbetaling (%)", f.deposit_pct), field("Offerte geldig (dagen)", f.quote_valid_days),
      field("Meldingen naar", f.notify_email, { full: true, help: "Kies een ander adres dan het afzendadres: mail aan jezelf geeft vaak geen pushmelding." }),
      field("Google-reviewlink", f.google_review_url, { full: true, help: "Uit je Google Bedrijfsprofiel (Vraag om reviews). Nooit een beloning voor een review." }),
      field("Beloning voor een verwijzing", f.referral_reward, { full: true }),
      field("Belafspraken per dag", f.calls_per_day), field("Bezoeken per dag", f.visits_per_day), field("Gratis websitechecks per dag", f.checks_per_day),
      ctx.can("settings.write") ? h("div", { class: "full" }, h("button", { class: "btn btn-gold btn-sm", type: "submit" }, "Opslaan")) : null)),
    posts ? card("AI-budget per post", h("p", { class: "muted", style: { margin: 0 } }, posts.note || ""),
      h("div", { class: "tbl-wrap", "aria-label": "Budget per post" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Post"), h("th", {}, "Aandeel"), h("th", {}, "Plafond"), h("th", {}, "Gebruikt"))),
        h("tbody", {}, (posts.items || []).map(p => h("tr", {}, h("td", {}, POST_LABEL[p.post] || p.label || p.post), h("td", { class: "num" }, `${Math.round(p.share_pct)}%`), h("td", { class: "num" }, fmt.usd(p.cap_usd)), h("td", { class: "num" }, fmt.usd(p.used_usd)))))))) : null,
    clientsCard(ctx, refresh),
  ];
}

function clientsCard(ctx, refresh) {
  const ta = h("textarea", { rows: 5, placeholder: "Eén klant per regel: Bedrijf; Naam; Telefoon; E-mail; Website\nBijv.: Garage Smit B.V.; Jan Smit; 06 12345678; jan@garagesmit.nl; garagesmit.nl" });
  const sure = h("input", { type: "checkbox" });
  const opt = h("select", {}, [["", "Kregen ze de kans om berichten te weigeren?"], ["ja", "Ja, toen ze hun gegevens gaven"], ["nee", "Nee of weet ik niet (dan eerst bellen)"]].map(([v, t]) => h("option", { value: v }, t)));
  const run = (kind, label) => actBtn(label, async () => {
    const r = await api(`klanten/campagne${envQs()}`, { method: "POST", body: { kind } });
    toast(`${r.klaar} bericht(en) klaargezet onder Vandaag${r.al_klaar ? `, ${r.al_klaar} stond(en) er al` : ""}${r.overgeslagen.length ? `; ${r.overgeslagen.length} overgeslagen (${r.overgeslagen.slice(0, 2).map(x => `${x.bedrijf}: ${x.reden}`).join("; ")})` : ""}.`);
  }, refresh);
  return h("section", { class: "card stack" }, h("h2", { style: { fontSize: "1.02rem", margin: 0 } }, "Bestaande klanten"),
    h("p", { class: "muted", style: { margin: 0 } }, "De warmste route: een eerlijke review, een eigen verwijslink en onderhoud. Berichten staan daarna klaar onder Vandaag; jij verstuurt."),
    h("div", { class: "row" }, run("review", "Review vragen"), run("verwijzing", "Verwijslink sturen"), run("onderhoud", "Onderhoud aanbieden")),
    ctx.can("settings.write") ? h("details", {}, h("summary", {}, "Klanten van vóór HQ invoeren"),
      h("div", { class: "stack", style: { marginTop: "10px" } }, ta,
        h("label", { class: "check" }, sure, " Ik kreeg deze gegevens bij de verkoop van een website aan deze klanten."), opt,
        actBtn("Invoeren", async () => {
          if (!sure.checked || !opt.value) throw new Error("Bevestig de herkomst en kies of ze de kans kregen om berichten te weigeren.");
          const rows = ta.value.split(/\r?\n/).map(x => x.split(";").map(y => y.trim())).filter(x => x[0]).map(([company, contact_name, phone, email, website]) => ({ company, contact_name, phone, email, website }));
          const r = await api(`klanten/bestaand${envQs()}`, { method: "POST", body: { rows, confirmed: true, optout_offered: opt.value === "ja" } });
          toast(`${r.nieuw} nieuw, ${r.bijgewerkt} bijgewerkt${r.overgeslagen.length ? `, ${r.overgeslagen.length} overgeslagen` : ""}.`); ta.value = "";
        }, refresh, "btn-gold"))) : null);
}
