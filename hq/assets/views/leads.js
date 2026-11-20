import { h, fmt, skeleton, errorBox, empty, toast, modal, field, badge, TASK } from "../ui.js";
import { api } from "../api.js";
import { startChainDialog } from "./world.js";
import { openTask } from "./tasks.js";

let META = { statuses: {}, sources: {} };

function leadForm(lead = {}) {
  const i = (name, attrs = {}) => { const el = h("input", { name, ...attrs }); el.value = lead[name] ?? ""; return el; };
  const src = h("select", { name: "source" }, Object.entries(META.sources).map(([k, v]) => h("option", { value: k, selected: (lead.source || "handmatig") === k }, v)));
  const notes = h("textarea", { name: "notes", rows: "4" }); notes.value = lead.notes || "";
  const els = { company: i("company", { required: true, maxlength: "160" }), website: i("website", { placeholder: "voorbeeld.nl", inputmode: "url" }), source: src,
    source_url: i("source_url", { placeholder: "Waar gevonden (link)" }), city: i("city"), contact_name: i("contact_name"), contact_email: i("contact_email", { type: "email" }),
    contact_phone: i("contact_phone", { inputmode: "tel" }), next_action_at: i("next_action_at", { type: "date" }), notes };
  const form = h("div", { class: "fgrid" },
    field("Bedrijf *", els.company), field("Website", els.website), field("Bron", els.source, { help: "Kies “Aanvraag via …” alleen als de klant zelf contact zocht: alleen dat telt als bevestigde aanvraag." }), field("Bron-link", els.source_url),
    field("Plaats", els.city), field("Contactpersoon", els.contact_name), field("E-mail (zakelijk)", els.contact_email), field("Telefoon", els.contact_phone),
    field("Vervolgdatum", els.next_action_at), field("Notities", els.notes, { full: true }));
  const values = () => Object.fromEntries(Object.entries(els).map(([k, el]) => [k, el.value.trim()]));
  return { form, values };
}

function newLead(refresh) {
  const { form, values } = leadForm();
  modal("Lead toevoegen", h("div", { class: "stack" }, form, h("p", { class: "faint", style: { fontSize: ".8rem" } }, "Sla alleen zakelijke gegevens op die nodig zijn. Dubbele bedrijven of domeinen worden geweigerd.")), [
    { label: "Annuleren", onClick: c => c() },
    { label: "Opslaan", cls: "btn-gold", onClick: async (close) => {
      try { await api("leads", { method: "POST", body: values() }); toast("Lead toegevoegd.", "ok"); close(); refresh(); }
      catch (e) { toast(e.message, "bad"); }
    } }]);
}

export function openLead(id, ctx, refresh) {
  const body = h("div", {}, h("span", { class: "spinner" }), " Laden…");
  const m = modal("Lead", body, []);
  m.dlg.style.width = "min(860px, calc(100vw - 24px))";
  const load = async () => {
    try {
      const d = await api(`leads/${id}`);
      const l = d.lead;
      const can = ctx.can("leads.write");
      const status = h("select", { disabled: !can, "aria-label": "Status" }, Object.entries(META.statuses).map(([k, v]) => h("option", { value: k, selected: l.status === k }, v)));
      status.addEventListener("change", async () => {
        try { await api(`leads/${id}`, { method: "PATCH", body: { status: status.value } }); toast("Status bijgewerkt.", "ok"); load(); refresh(); } catch (e) { toast(e.message, "bad"); }
      });
      let pkgs = [];
      if (ctx.can("quotes.write")) { try { pkgs = (await api("settings")).packages.filter(p => p.active); } catch {} }
      const pkgSel = h("select", { "aria-label": "Pakket" }, pkgs.map(p => h("option", { value: p.key }, `${p.name} — ${fmt.eur(p.price_cents)}${p.terms ? "" : " (geen voorwaarden)"}`)));
      const amount = h("input", { type: "number", min: "1", step: "1", placeholder: "Bedrag in €" });
      const recv = h("input", { type: "date" });
      body.replaceChildren(h("div", { class: "stack" },
        h("div", { class: "row" }, h("h2", {}, l.company), l.website ? h("a", { href: /^https?:/.test(l.website) ? l.website : `https://${l.website}`, target: "_blank", rel: "noopener noreferrer" }, l.website) : null, h("span", { class: "spacer" }), status),
        h("dl", { class: "kv" },
          h("dt", {}, "Bron"), h("dd", {}, META.sources[l.source] || l.source, l.source_url ? [" · ", h("a", { href: l.source_url, target: "_blank", rel: "noopener noreferrer" }, "link")] : null),
          h("dt", {}, "Contact"), h("dd", {}, [l.contact_name, l.contact_email, l.contact_phone].filter(Boolean).join(" · ") || "—"),
          h("dt", {}, "Verantwoordelijke"), h("dd", {}, l.owner_email || "—"),
          h("dt", {}, "Vervolgdatum"), h("dd", {}, l.next_action_at ? fmt.day(l.next_action_at) : "—"),
          h("dt", {}, "Notities"), h("dd", {}, l.notes || "—")),
        h("div", { class: "row" },
          can ? h("button", { class: "btn btn-sm", type: "button", onclick: () => editLead(l) }, "Bewerken") : null,
          ctx.can("tasks.start") ? h("button", { class: "btn btn-sm btn-gold", type: "button", disabled: !l.website, onclick: () => startChainDialog(ctx, l.id, () => { load(); refresh(); }) }, "Onderzoek starten (Scout → Auditor → Sales)") : null,
          ctx.can("data.delete") ? h("button", { class: "btn btn-sm btn-bad", type: "button", onclick: () => del(l) }, "Verwijderen") : null),
        h("section", { class: "stack" }, h("h3", {}, "Agenttaken en resultaten"),
          d.tasks.length ? h("div", { class: "tbl-wrap" }, h("table", {}, h("tbody", {}, d.tasks.map(t => h("tr", { class: "click", tabindex: "0", onclick: () => openTask(t.id, ctx, load) },
            h("td", {}, t.title), h("td", {}, badge(TASK, t.status)), h("td", { class: "num faint" }, fmt.dt(t.created_at))))))) : h("p", { class: "faint" }, "Nog geen taken.")),
        h("section", { class: "stack" }, h("h3", {}, "Offertes"),
          h("p", { class: "faint", style: { fontSize: ".8rem" } }, "Prijs en voorwaarden komen uit de vastgelegde pakketten. Versturen vraagt goedkeuring van een eigenaar."),
          d.quotes.length ? h("div", { class: "tbl-wrap" }, h("table", {}, h("tbody", {}, d.quotes.map(q => h("tr", {},
            h("td", {}, q.package_name), h("td", { class: "num" }, fmt.eur(q.price_cents)), h("td", {}, q.status), h("td", { class: "num faint" }, fmt.dt(q.created_at)),
            h("td", {}, q.status === "concept" && ctx.can("quotes.write") ? h("button", { class: "btn btn-sm", type: "button", onclick: async () => { try { await api(`quotes/${q.id}/approval`, { method: "POST", body: {} }); toast("Ter goedkeuring voorgelegd.", "ok"); window.dispatchEvent(new Event("hq:approvals")); load(); } catch (e) { toast(e.message, "bad"); } } }, "Ter goedkeuring")
              : q.status === "verstuurd" && ctx.can("quotes.write") ? h("div", { class: "row" },
                h("button", { class: "btn btn-sm", type: "button", onclick: () => qs(q.id, "geaccepteerd") }, "Geaccepteerd"),
                h("button", { class: "btn btn-sm", type: "button", onclick: () => qs(q.id, "afgewezen") }, "Afgewezen")) : null)))))) : h("p", { class: "faint" }, "Geen offertes."),
          ctx.can("quotes.write") && pkgs.length ? h("div", { class: "row" }, pkgSel, h("button", { class: "btn btn-sm", type: "button", onclick: async () => {
            try { await api(`leads/${id}/quotes`, { method: "POST", body: { package_key: pkgSel.value } }); toast("Offerteconcept gemaakt.", "ok"); load(); } catch (e) { toast(e.message, "bad"); }
          } }, "Offerteconcept maken")) : null),
        h("section", { class: "stack" }, h("h3", {}, "Ontvangen betalingen"),
          d.payments.length ? h("ul", { style: { paddingLeft: "18px", margin: 0 } }, d.payments.map(p => h("li", {}, `${fmt.eur(p.amount_cents)} op ${fmt.day(p.received_on)}${p.note ? ` — ${p.note}` : ""}`))) : h("p", { class: "faint" }, "Nog niets ontvangen."),
          ctx.can("payments.write") ? h("div", { class: "row" }, amount, recv, h("button", { class: "btn btn-sm", type: "button", onclick: async () => {
            try { await api(`leads/${id}/payments`, { method: "POST", body: { amount_eur: amount.value, received_on: recv.value } }); toast("Betaling geregistreerd.", "ok"); load(); refresh(); } catch (e) { toast(e.message, "bad"); }
          } }, "Betaling registreren")) : null),
        h("section", { class: "stack" }, h("h3", {}, "Geschiedenis"), h("ul", { style: { paddingLeft: "18px", margin: 0, fontSize: ".84rem" } }, d.history.map(x => h("li", {}, h("span", { class: "faint" }, fmt.dt(x.at), " "), `${x.from_status ? `${META.statuses[x.from_status]} → ` : ""}${META.statuses[x.to_status] || ""}`, x.note ? ` · ${x.note}` : "", h("span", { class: "faint" }, ` · ${x.actor_label || ""}`)))))));
    } catch (e) { body.replaceChildren(errorBox(e, load)); }
  };
  const qs = async (qid, st) => { try { await api(`quotes/${qid}/status`, { method: "POST", body: { status: st } }); toast("Offerte bijgewerkt.", "ok"); load(); refresh(); } catch (e) { toast(e.message, "bad"); } };
  const editLead = (l) => {
    const { form, values } = leadForm(l);
    modal("Lead bewerken", form, [{ label: "Annuleren", onClick: c => c() }, { label: "Opslaan", cls: "btn-gold", onClick: async (close) => {
      try { await api(`leads/${l.id}`, { method: "PATCH", body: values() }); toast("Opgeslagen.", "ok"); close(); load(); refresh(); } catch (e) { toast(e.message, "bad"); }
    } }]);
  };
  const del = (l) => {
    const conf = h("input", { type: "text", placeholder: "VERWIJDEREN", "aria-label": "Typ VERWIJDEREN" });
    modal("Lead verwijderen", h("div", { class: "stack" }, h("p", {}, `Dit verwijdert ${l.company} met alle taken, goedkeuringen, offertes en betalingen. Dit kan niet ongedaan worden gemaakt.`), field("Typ VERWIJDEREN om te bevestigen", conf)),
      [{ label: "Annuleren", onClick: c => c() }, { label: "Definitief verwijderen", cls: "btn-bad", onClick: async (close) => {
        try { await api(`leads/${l.id}?confirm=${encodeURIComponent(conf.value)}`, { method: "DELETE" }); toast("Lead verwijderd.", "ok"); close(); m.close(); refresh(); } catch (e) { toast(e.message, "bad"); }
      } }]);
  };
  load();
}

export async function mount(root, ctx) {
  let view = "bord", search = "";
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Weergave" });
  const q = h("input", { type: "search", placeholder: "Zoek bedrijf of domein", "aria-label": "Zoeken", style: { maxWidth: "260px" } });
  let tmr; q.addEventListener("input", () => { clearTimeout(tmr); tmr = setTimeout(() => { search = q.value.trim(); refresh(); }, 250); });
  const renderSeg = () => seg.replaceChildren(...[["bord", "Bord"], ["lijst", "Lijst"]].map(([k, v]) => h("button", { type: "button", "aria-pressed": String(view === k), onclick: () => { view = k; renderSeg(); draw(); } }, v)));
  renderSeg();
  const body = h("div", {}, skeleton(4, "g4"));
  let leads = [];
  root.append(h("div", { class: "section-h" }, h("div", { class: "row" }, seg, q), ctx.can("leads.write") ? h("button", { class: "btn btn-gold", type: "button", onclick: () => newLead(refresh) }, "Lead toevoegen") : null), body);

  function draw() {
    if (!leads.length) { body.replaceChildren(empty(search ? "Niets gevonden" : "Nog geen leads", search ? "" : "Voeg een lead toe of registreer een binnengekomen aanvraag.")); return; }
    if (view === "bord") {
      body.replaceChildren(h("div", { class: "kanban" }, Object.entries(META.statuses).map(([k, label]) => {
        const items = leads.filter(l => l.status === k);
        return h("section", { class: "col", "aria-label": label }, h("div", { class: "col-h" }, h("span", {}, label), h("span", { class: "num" }, items.length)),
          items.map(l => h("button", { class: "lead-card", type: "button", onclick: () => openLead(l.id, ctx, refresh) }, h("b", {}, l.company), h("span", {}, l.domain || "geen website"),
            h("span", {}, [META.sources[l.source], l.next_action_at ? `vervolg ${fmt.day(l.next_action_at)}` : null, l.won_cents ? fmt.eur(l.won_cents) : null].filter(Boolean).join(" · ")))));
      })));
    } else {
      body.replaceChildren(h("div", { class: "tbl-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Bedrijf", "Status", "Bron", "Verantwoordelijke", "Vervolg", "Taken", "Bijgewerkt"].map(t => h("th", { scope: "col" }, t)))),
        h("tbody", {}, leads.map(l => h("tr", { class: "click", tabindex: "0", onclick: () => openLead(l.id, ctx, refresh), onkeydown: (e) => { if (e.key === "Enter") openLead(l.id, ctx, refresh); } },
          h("td", {}, h("strong", {}, l.company), h("div", { class: "faint", style: { fontSize: ".78rem" } }, l.domain || "")), h("td", {}, META.statuses[l.status]), h("td", {}, META.sources[l.source] || l.source),
          h("td", {}, l.owner_email || "—"), h("td", { class: "num" }, l.next_action_at ? fmt.day(l.next_action_at) : "—"), h("td", { class: "num" }, l.task_count), h("td", { class: "num" }, fmt.ago(l.updated_at))))))));
    }
  }
  async function refresh() {
    try {
      const d = await api(`leads${search ? `?q=${encodeURIComponent(search)}` : ""}`);
      META = { statuses: d.statuses, sources: d.sources };
      leads = d.leads; draw();
      ctx.setFresh(`${leads.length} leads · opgehaald om ${fmt.time(new Date())}`);
    } catch (e) { body.replaceChildren(errorBox(e, refresh)); }
  }
  await refresh();
  return { refresh };
}
