// Klanten: lijst met filters en per klant één kaart met de hele geschiedenis.
// Commerciële opvolging (gesprek, offerte, betaling) staat los van projectvoortgang.
import { h, fmt, errorBox, skeleton, toast, empty, modal, field } from "../ui.js";
import { api } from "../api.js";
import { put, envSwitch, getEnv, envQs, copyBtn, waHref, mailHref } from "./klant-ui.js";

const STATUS = { nieuw: "Nieuw", onderzocht: "Onderzocht", goedgekeurd: "Goedgekeurd", benaderd: "Benaderd", aanvraag: "Aanvraag", gekwalificeerd: "Gekwalificeerd", gesprek: "In gesprek", afspraak: "Afspraak", offerte: "Offerte", gewonnen: "Klant", verloren: "Verloren", afgemeld: "Afgemeld" };
const WS = { gevonden: "Website gevonden", alleen_sociaal: "Alleen sociaal profiel", onzeker: "Onzeker", geen_gevonden: "Geen eigen website gevonden na deze controles" };
const FILTERS = [["alle", "Alle"], ["wacht", "Wacht op mij"], ["aanvragen", "Aanvragen"], ["offerte", "Offertes"], ["klant", "Klanten"], ["scout", "Gevonden door Scout"]];

export async function mount(root, ctx) {
  const id = new URLSearchParams(location.search).get("id");
  return id ? card(root, ctx, id) : list(root, ctx);
}

async function list(root, ctx) {
  let filter = "alle", query = "";
  const box = h("div", { class: "stack" }, skeleton(4, "g2"));
  const search = h("input", { type: "search", placeholder: "Zoek op bedrijf of e-mail", "aria-label": "Zoeken", oninput: (e) => { query = e.target.value; clearTimeout(search.t); search.t = setTimeout(refresh, 250); } });
  const chips = h("div", { class: "chips", role: "group", "aria-label": "Filter" }, FILTERS.map(([k, l]) => h("button", { class: "chip", type: "button", "aria-pressed": String(k === filter), onclick: (e) => { filter = k; chips.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === e.currentTarget))); refresh(); } }, l)));
  root.append(h("div", { class: "row", style: { justifyContent: "space-between" } }, envSwitch(() => refresh()), ctx.can("leads.write") ? h("button", { class: "btn btn-gold btn-sm", type: "button", onclick: () => addDialog(ctx) }, "Aanvraag toevoegen") : null), search, chips, box);
  async function refresh() {
    try {
      const r = await api(`klanten?filter=${filter}${query ? `&q=${encodeURIComponent(query)}` : ""}${envQs("&")}`);
      put(box, r.klanten.length ? h("div", { class: "grid g2" }, r.klanten.map(l => h("a", { class: "card lead-card", href: `/hq/klanten?id=${l.id}`, "data-nav": "" },
        h("div", { class: "row", style: { justifyContent: "space-between" } }, h("strong", {}, l.company), h("span", { class: "badge" }, STATUS[l.status] || l.status)),
        h("p", { class: "muted", style: { margin: "6px 0 0" } }, l.need_summary || l.priority_reason || WS[l.website_status] || ""),
        h("div", { class: "row", style: { marginTop: "8px" } }, l.awaiting_reply_since ? h("span", { class: "badge b-warn" }, "wacht op jou") : null, l.priority ? h("span", { class: `badge ${l.priority === "hoog" ? "b-gold" : ""}` }, `prioriteit ${l.priority}`) : null, l.is_test ? h("span", { class: "badge b-info" }, "TEST") : null)))) : empty("Geen klanten in deze selectie"));
      ctx.setFresh(`${getEnv() === "test" ? "TESTOMGEVING · " : ""}${r.klanten.length} klant(en)`);
    } catch (e) { put(box, errorBox(e, refresh)); }
  }
  await refresh();
  return { refresh };
}

function addDialog(ctx) {
  const f = { company: h("input"), name: h("input"), email: h("input", { type: "email" }), phone: h("input", { type: "tel" }), message: h("textarea", { rows: 6, placeholder: "Plak hier het gesprek of de aanvraag" }), channel: h("select", {}, ["gesprek", "whatsapp", "email", "telefoon"].map(c => h("option", { value: c }, c))) };
  modal("Aanvraag toevoegen", h("div", { class: "fgrid" }, field("Bedrijf", f.company), field("Naam", f.name), field("E-mail", f.email), field("Telefoon", f.phone), field("Via", f.channel), field("Gesprek of bericht", f.message, { full: true, help: "HQ herkent wat de klant wil, wat nog ontbreekt en zet een antwoordconcept klaar." })), [
    { label: "Toevoegen", cls: "btn-gold", onClick: async (close) => {
      try {
        const r = await api("klanten", { method: "POST", body: { company: f.company.value, name: f.name.value, email: f.email.value, phone: f.phone.value, message: f.message.value, channel: f.channel.value, is_test: getEnv() === "test" } });
        close(); toast(r.duplicate ? "Deze aanvraag stond er al in." : "Klantkaart aangemaakt."); ctx.navigate(`/hq/klanten?id=${r.lead_id}`);
      } catch (e) { toast(e.message, "bad"); }
    } }]);
}

async function card(root, ctx, id) {
  const box = h("div", { class: "stack", style: { gap: "18px" } }, skeleton(3, "g2"));
  root.append(h("a", { href: "/hq/klanten", "data-nav": "" }, "← Alle klanten"), box);
  const act = (label, fn, cls = "") => h("button", { class: `btn btn-sm ${cls}`, type: "button", onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); await refresh(); } catch (err) { toast(err.message, "bad"); } finally { b.disabled = false; } } }, label);
  async function refresh() {
    try {
      const d = await api(`klanten/${id}`);
      const l = d.lead;
      ctx.setFresh(l.is_test ? "TESTGEGEVENS" : "");
      const sec = (title, ...c) => h("section", { class: "card stack" }, h("h2", { style: { fontSize: "1.02rem", margin: 0 } }, title), ...c);
      const reply = d.outreach.find(o => o.kind === "antwoord" && o.status === "concept");
      const quote = d.quotes[0];
      const manual = d.outreach.filter(o => o.status === "klaar_handmatig");
      put(box, 
        h("div", { class: "stack" }, h("div", { class: "row", style: { justifyContent: "space-between" } }, h("h2", { style: { margin: 0 } }, l.company), h("span", { class: "badge b-gold" }, STATUS[l.status] || l.status)),
          h("p", { class: "muted", style: { margin: 0 } }, [l.contact_name, l.contact_email, l.contact_phone, l.city].filter(Boolean).join(" · ")),
          l.is_test ? h("span", { class: "badge b-info" }, "TESTGEGEVENS: tellen niet mee in echte resultaten") : null),
        l.awaiting_reply_since ? h("div", { class: "callout" }, `Klant wacht sinds ${fmt.dt(l.awaiting_reply_since)} op je antwoord.`) : null,
        sec("Behoefte", h("p", { style: { margin: 0 } }, l.need_summary || "Nog niet bekend."),
          (l.missing_info || []).length ? h("p", { class: "muted", style: { margin: 0 } }, `Nog nodig: ${l.missing_info.join(", ")}`) : null,
          l.priority_reason ? h("p", { class: "faint", style: { margin: 0, fontSize: ".82rem" } }, l.priority_reason) : null),
        reply ? sec("Antwoordconcept", h("pre", { class: "pre" }, reply.body),
          h("div", { class: "row" }, copyBtn(reply.body), l.contact_phone ? h("a", { class: "btn btn-sm", href: waHref(l.contact_phone, reply.body), target: "_blank", rel: "noopener" }, "WhatsApp") : null,
            l.contact_email ? h("a", { class: "btn btn-sm", href: mailHref(l.contact_email, reply.subject, reply.body) }, "Mail") : null,
            act("Ik heb geantwoord", () => api(`klanten/${id}/beantwoord`, { method: "POST", body: { outreach_id: reply.id } }), "btn-gold"))) : null,
        manual.length ? sec("Klaar om zelf te versturen", ...manual.map(o => h("div", { class: "stack" }, h("pre", { class: "pre" }, o.body), h("div", { class: "row" }, copyBtn(o.body), act("Verstuurd", () => api(`outreach/${o.id}/verstuurd`, { method: "POST", body: {} }), "btn-gold"), act("Annuleren", () => api(`outreach/${o.id}/annuleren`, { method: "POST", body: {} })))))) : null,
        sec("Offerte", quote ? h("div", { class: "stack" },
          h("div", { class: "row", style: { justifyContent: "space-between" } }, h("strong", {}, fmt.eur(quote.price_cents)), h("span", { class: "badge" }, quote.status)),
          h("p", { style: { margin: 0 } }, quote.description),
          h("ul", { class: "acts" }, (quote.items || []).map(i => h("li", {}, `${i.name}: €${i.price_eur}${i.per ? ` per ${i.per}` : ""}`)), (quote.extras || []).map(e => h("li", {}, h("strong", {}, "Extra (beoordelen): "), `${e.omschrijving}: €${e.prijs_eur}`))),
          h("p", { class: "muted", style: { margin: 0 } }, `Info nodig: ${(quote.info_needed || []).join(", ")}`), h("p", { class: "muted", style: { margin: 0 } }, `Volgende stap: ${quote.next_step}`),
          h("div", { class: "row" },
            quote.status === "concept" && ctx.can("approvals.money") ? act("Versturen (met belangstelling)", () => api(`offertes/${quote.id}/versturen`, { method: "POST", body: { interest: true, extras_approved: true, terms_ok: true } }), "btn-gold") : null,
            quote.status === "verstuurd" && !quote.interest ? act("Belangstelling getoond", () => api(`offertes/${quote.id}/belangstelling`, { method: "POST", body: {} })) : null,
            quote.status === "verstuurd" && ctx.can("approvals.money") ? act("Akkoord ontvangen", async () => { const r = await api(`offertes/${quote.id}/akkoord`, { method: "POST", body: {} }); if (r.intake_url) modal("Intake-link", h("div", { class: "stack" }, h("p", {}, "Stuur deze persoonlijke link naar de klant. Hij is alleen nu zichtbaar."), h("pre", { class: "pre" }, location.origin + r.intake_url), copyBtn(location.origin + r.intake_url))); }, "btn-gold") : null))
          : h("p", { class: "muted", style: { margin: 0 } }, "Nog geen offerte."),
          ctx.can("quotes.write") && (!quote || ["afgewezen", "vervallen"].includes(quote.status)) ? act("Offerteconcept maken (prijzen uit de prijslijst)", () => api(`klanten/${id}/offerte`, { method: "POST", body: {} }), "btn-gold") : null),
        d.project ? sec("Project", h("dl", { class: "kv" }, h("dt", {}, "Status"), h("dd", {}, d.project.status.replace(/_/g, " ")), h("dt", {}, "Prijs"), h("dd", {}, fmt.eur(d.project.price_cents)), h("dt", {}, "Intake"), h("dd", {}, d.project.intake_complete_at ? `compleet ${fmt.dt(d.project.intake_complete_at)}` : "nog niet compleet"), h("dt", {}, "Briefing"), h("dd", {}, d.project.briefing_at ? "klaar" : "—")),
          h("div", { class: "row" }, act("Nieuwe intake-link", async () => { const r = await api(`projecten/${d.project.id}/intake-link`, { method: "POST", body: {} }); modal("Nieuwe intake-link", h("div", { class: "stack" }, h("pre", { class: "pre" }, location.origin + r.intake_url), copyBtn(location.origin + r.intake_url))); }),
            d.project.briefing_at ? act("Briefing bekijken", async () => { const r = await api(`projecten/${d.project.id}/briefing`); modal("Bouwbriefing", h("div", { class: "stack" }, h("pre", { class: "pre" }, r.briefing.text), copyBtn(r.briefing.text, "Kopieer voor Claude"))); }) : null)) : null,
        sec("Contact en afspraken",
          h("p", { style: { margin: 0 } }, d.contact.email.allowed ? (l.last_inbound_at ? "E-mail: antwoorden toegestaan." : "E-mail: benaderen toegestaan.") : `E-mail niet toegestaan: ${d.contact.email.reasons.join("; ")}`),
          d.suppressed ? h("div", { class: "callout" }, `Afgemeld/geblokkeerd: ${d.suppressed.reason}. Alle afdelingen stoppen met contact.`) : null,
          d.consents.length ? h("ul", { class: "acts" }, d.consents.map(c => h("li", {}, `${c.channel}: ${c.basis.replace(/_/g, " ")} · ${c.source} · ${fmt.day(c.recorded_at)} · ${c.scope}${c.revoked_at ? " (ingetrokken)" : ""}`))) : null,
          d.appointments.length ? h("ul", { class: "acts" }, d.appointments.map(a => h("li", {}, `${a.kind} · ${fmt.dt(a.starts_at)} · ${a.status}`))) : null,
          h("div", { class: "row" },
            act("Reactie plakken", () => replyDialog(id)),
            act("Afspraak", () => bookDialog(id)),
            act("Contactgrond vastleggen", () => consentDialog(id)),
            act("Benaderen", async () => { const r = await api(`klanten/${id}/benaderen`, { method: "POST", body: {} }); toast(r.decision.replace(/_/g, " ") + (r.why?.length ? `: ${r.why.join("; ")}` : ""), r.decision.startsWith("niet") || r.decision === "geen_contactgrond" ? "bad" : ""); }),
            ctx.can("payments.write") ? act("Betaling", () => payDialog(id, l, quote)) : null,
            !d.suppressed ? act("Afmelden", async () => { if (confirm("Klant afmelden? Alle afdelingen stoppen met contact.")) await api(`klanten/${id}/afmelden`, { method: "POST", body: {} }); }, "btn-bad") : null)),
        d.opportunities.length ? sec("Observaties (Auditor)", ...d.opportunities.map(o => h("div", { class: "stack", style: { borderTop: "1px solid var(--line)", paddingTop: "8px" } },
          h("div", { class: "row" }, h("span", { class: `badge ${o.strength === "concreet" ? "b-gold" : ""}` }, o.strength), h("span", { class: "badge" }, o.verified === "automatisch" ? "nog niet gecontroleerd" : o.verified.replace("_", " "))),
          h("p", { style: { margin: 0 } }, o.observation), h("p", { class: "faint", style: { margin: 0, fontSize: ".8rem", overflowWrap: "anywhere" } }, `${o.page_url} · ${o.service_text}`),
          o.verified === "automatisch" ? h("div", { class: "row" }, act("Klopt", () => api(`observaties/${o.id}`, { method: "POST", body: { verified: "klopt" } })), act("Klopt niet", () => api(`observaties/${o.id}`, { method: "POST", body: { verified: "klopt_niet" } }))) : null))) : null,
        (l.website_checks || []).length ? sec("Websitestatus (Scout)", h("p", { style: { margin: 0 } }, WS[l.website_status] || "—"), h("ul", { class: "acts" }, l.website_checks.map(c => h("li", {}, `${c.controle}: ${c.uitkomst}`))), l.source_detail?.bron ? h("p", { class: "faint", style: { margin: 0, fontSize: ".8rem" } }, `Bron: ${l.source_detail.bron} · ${fmt.dt(l.source_detail.onderzocht_op)}`) : null) : null,
        sec("Geschiedenis", d.timeline.length ? h("div", { class: "stack" }, d.timeline.map(t => h("div", { style: { borderTop: "1px solid var(--line)", paddingTop: "6px" } },
          h("div", { class: "faint", style: { fontSize: ".78rem" } }, `${fmt.dt(t.at)} · ${t.direction === "in" ? "binnen" : t.direction === "uit" ? "verstuurd" : "intern"} · ${t.channel} · ${t.kind}${t.classification ? ` (${t.classification})` : ""}${t.is_test ? " · TEST" : ""}`),
          h("div", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, t.subject ? `${t.subject}\n` : "", t.body.slice(0, 600))))) : empty("Nog geen gesprekken")),
      );
    } catch (e) { put(box, errorBox(e, refresh)); }
  }

  function replyDialog(leadId) {
    const t = h("textarea", { rows: 6 }), ch = h("select", {}, ["whatsapp", "email", "telefoon"].map(c => h("option", { value: c }, c)));
    return new Promise((ok) => modal("Reactie van de klant", h("div", { class: "fgrid" }, field("Kanaal", ch), field("Tekst", t, { full: true, help: "HQ herkent interesse, vraag, later, afwijzing of afmelden en stopt geplande opvolging." })), [
      { label: "Vastleggen", cls: "btn-gold", onClick: async (close) => { const r = await api(`klanten/${leadId}/reactie`, { method: "POST", body: { text: t.value, channel: ch.value } }); toast(`Herkend als: ${r.classification}${r.cancelled_followups ? ` · ${r.cancelled_followups} opvolging(en) gestopt` : ""}`); close(); ok(); } }]));
  }
  async function bookDialog(leadId) {
    const r = await api("agenda/vrij?dagen=10");
    const sel = h("select", {}, r.slots.map(s => h("option", { value: s.starts_at }, fmt.dt(s.starts_at))));
    const kind = h("select", {}, ["kennismaking", "intake", "oplevering", "nazorg"].map(k => h("option", { value: k }, k)));
    return new Promise((ok) => modal("Afspraak plannen", r.slots.length ? h("div", { class: "fgrid" }, field("Moment (uit je beschikbaarheid)", sel), field("Soort", kind)) : empty("Geen vrije momenten", "Pas je beschikbaarheid aan in Kantoor › Instellingen."), r.slots.length ? [
      { label: "Vastleggen", cls: "btn-gold", onClick: async (close) => { await api(`klanten/${leadId}/afspraak`, { method: "POST", body: { starts_at: sel.value, kind: kind.value } }); toast("Afspraak vastgelegd (opnieuw gecontroleerd op beschikbaarheid)."); close(); ok(); } }] : []));
  }
  function consentDialog(leadId) {
    const ch = h("select", {}, ["email", "whatsapp", "telefoon"].map(c => h("option", { value: c }, c)));
    const basis = h("select", {}, [["toestemming", "Toestemming gegeven"], ["zelf_contact_gezocht", "Klant zocht zelf contact"], ["bestaande_klant", "Bestaande klant"], ["gerechtvaardigd_belang_zakelijk", "Gerechtvaardigd belang (zakelijk, onderbouwd)"]].map(([v, l]) => h("option", { value: v }, l)));
    const src = h("input", { placeholder: "Waar komt dit vandaan? (link, gesprek, formulier)" }), scope = h("input", { placeholder: "Waarvoor precies? (bijv. één bericht over …)" }), ev = h("textarea", { rows: 3, placeholder: "Onderbouwing. Een openbaar e-mailadres alleen is onvoldoende." });
    return new Promise((ok) => modal("Contactgrond vastleggen", h("div", { class: "fgrid" }, field("Kanaal", ch), field("Grond", basis), field("Bron", src, { full: true }), field("Reikwijdte", scope, { full: true }), field("Onderbouwing", ev, { full: true, help: "Datum en wie het vastlegt worden automatisch bewaard. Handmatig versturen verandert de contactregels niet." })), [
      { label: "Vastleggen", cls: "btn-gold", onClick: async (close) => { await api(`klanten/${leadId}/toestemming`, { method: "POST", body: { channel: ch.value, basis: basis.value, source: src.value, scope: scope.value, evidence: ev.value } }); toast("Contactgrond vastgelegd."); close(); ok(); } }]));
  }
  function payDialog(leadId, lead, quote) {
    const amt = h("input", { type: "number", min: 1, value: quote ? quote.price_cents / 100 : "" });
    const method = h("select", {}, [["bank", "Bankoverschrijving (echt)"], ["contant", "Contant (echt)"], ...(lead.is_test ? [["simulatie", "Simulatie (alleen test)"]] : [])].map(([v, l]) => h("option", { value: v }, l)));
    return new Promise((ok) => modal("Betaling vastleggen", h("div", { class: "fgrid" }, field("Bedrag (€)", amt), field("Soort", method)), [
      { label: "Vastleggen", cls: "btn-gold", onClick: async (close) => { await api(`klanten/${leadId}/betaling`, { method: "POST", body: { amount_eur: amt.value, method: method.value, quote_id: quote?.id } }); toast("Betaling vastgelegd."); close(); ok(); } }]));
  }
  await refresh();
  return { refresh };
}
