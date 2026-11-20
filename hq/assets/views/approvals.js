import { h, fmt, skeleton, errorBox, empty, toast, field, badge } from "../ui.js";
import { api } from "../api.js";
import { resultView } from "./tasks.js";

const KIND = { onderzoek: "Onderzoek", bericht: "Berichtconcept", offerte: "Offerte" };

function proposalView(a) {
  const p = a.final_proposal || a.proposal;
  if (a.kind === "bericht") return h("div", { class: "stack" },
    h("dl", { class: "kv" }, h("dt", {}, "Kanaal"), h("dd", {}, p.kanaal || "—"), h("dt", {}, "Ontvanger"), h("dd", {}, p.ontvanger || "nog niet bekend")),
    h("p", { class: "mono" }, p.onderwerp), h("pre", { class: "pre" }, p.bericht));
  if (a.kind === "offerte") return h("dl", { class: "kv" }, h("dt", {}, "Bedrijf"), h("dd", {}, p.bedrijf), h("dt", {}, "Pakket"), h("dd", {}, p.pakket),
    h("dt", {}, "Prijs"), h("dd", {}, fmt.eur(p.prijs_cents)), h("dt", {}, "Voorwaarden"), h("dd", {}, h("pre", { class: "pre" }, p.voorwaarden)), p.notitie ? [h("dt", {}, "Notitie"), h("dd", {}, p.notitie)] : null);
  return h("div", { class: "stack" },
    resultView({ bron: { url: p.website }, feiten: p.feiten, interpretaties: p.interpretaties, kansen: p.kansen, relevantie: p.scout?.relevantie }),
    p.scout?.feiten?.length ? h("details", {}, h("summary", { style: { cursor: "pointer" } }, "Bedrijfsinformatie van Scout"), resultView({ feiten: p.scout.feiten })) : null);
}

function rationaleView(r) {
  if (!r || !Object.keys(r).length) return null;
  return h("div", { class: "callout info" },
    r.methode ? h("p", {}, `Methode: ${r.methode}`) : null,
    r.gebruikte_feiten?.length ? h("p", {}, `Gebaseerd op: ${r.gebruikte_feiten.join(", ")}`) : null,
    r.onzekerheden?.length ? h("p", {}, `Onzekerheden: ${r.onzekerheden.join(" · ")}`) : null,
    r.let_op ? h("p", {}, r.let_op) : null);
}

function item(a, ctx, refresh) {
  const canDecide = ctx.can(a.kind === "offerte" ? "approvals.money" : "approvals.decide");
  const note = h("input", { type: "text", maxlength: "500", placeholder: "Optioneel: reden of opmerking" });
  let editing = false;
  const onderwerp = h("input", { type: "text", value: a.proposal.onderwerp || "", maxlength: "200" });
  const bericht = h("textarea", { rows: "10" }); bericht.value = a.proposal.bericht || "";
  const editBox = h("div", { class: "stack", hidden: true }, field("Onderwerp", onderwerp), field("Bericht", bericht, { help: "De aangepaste tekst wordt het goedgekeurde voorstel. Prijzen en reviews worden geweigerd." }));
  const decide = async (decision, btn) => {
    btn.disabled = true;
    try {
      const body = { decision, note: note.value, proposal_hash: a.proposal_hash };
      if (editing && decision === "goedkeuren") body.edited = { onderwerp: onderwerp.value, bericht: bericht.value };
      const r = await api(`approvals/${a.id}/decide`, { method: "POST", body });
      toast(r.status === "goedgekeurd" ? (r.enqueuedSales ? "Goedgekeurd. Sales maakt nu een berichtconcept." : "Goedgekeurd.") : "Afgewezen.", "ok");
      window.dispatchEvent(new Event("hq:approvals"));
      refresh(true);
    } catch (e) { toast(e.message, "bad"); btn.disabled = false; }
  };
  return h("article", { class: "card stack", "aria-labelledby": `ap-${a.id}` },
    h("div", { class: "row" }, h("span", { class: "badge b-warn" }, KIND[a.kind]), h("h2", { id: `ap-${a.id}` }, a.title), h("span", { class: "spacer" }), h("span", { class: "faint", style: { fontSize: ".8rem" } }, `aangevraagd ${fmt.ago(a.requested_at)}${a.agent_key ? ` door ${a.agent_key}` : ""}`)),
    h("div", {}, h("h3", {}, "Exact voorstel"), proposalView(a)),
    rationaleView(a.rationale),
    editBox,
    canDecide ? h("div", { class: "stack" }, field("Opmerking", note),
      h("div", { class: "row" },
        h("button", { class: "btn btn-gold", type: "button", onclick: (e) => decide("goedkeuren", e.currentTarget) }, "Goedkeuren"),
        a.kind === "bericht" ? h("button", { class: "btn", type: "button", onclick: (e) => { editing = !editing; editBox.hidden = !editing; e.currentTarget.textContent = editing ? "Aanpassen annuleren" : "Aanpassen"; } }, "Aanpassen") : null,
        h("button", { class: "btn btn-bad", type: "button", onclick: (e) => decide("afwijzen", e.currentTarget) }, "Afwijzen")),
      h("p", { class: "faint", style: { fontSize: ".78rem" } }, "Goedkeuring geldt alleen voor dit exacte voorstel en één keer. Er wordt niets automatisch verstuurd."))
      : h("p", { class: "muted" }, a.kind === "offerte" ? "Alleen een eigenaar kan offertes goedkeuren." : "Je rol kan geen voorstellen beoordelen."));
}

function decided(a, ctx, refresh) {
  const p = a.final_proposal || a.proposal;
  const use = async (btn) => {
    btn.disabled = true;
    try { await api(`approvals/${a.id}/use`, { method: "POST", body: {} }); toast(a.kind === "bericht" ? "Gemarkeerd als verstuurd. Lead staat op Benaderd." : "Gemarkeerd als verstuurd.", "ok"); refresh(true); }
    catch (e) { toast(e.message, "bad"); btn.disabled = false; }
  };
  return h("article", { class: "card stack" },
    h("div", { class: "row" }, h("span", { class: `badge ${a.status === "goedgekeurd" ? "b-ok" : "b-bad"}` }, a.status === "goedgekeurd" ? (a.edited ? "Goedgekeurd (aangepast)" : "Goedgekeurd") : a.status === "vervallen" ? "Vervallen" : "Afgewezen"),
      h("strong", {}, a.title), h("span", { class: "spacer" }), h("span", { class: "faint", style: { fontSize: ".8rem" } }, `${fmt.dt(a.decided_at)}${a.decided_by_email ? ` · ${a.decided_by_email}` : ""}`)),
    a.decision_note ? h("p", { class: "muted" }, a.decision_note) : null,
    a.status === "goedgekeurd" && a.kind === "bericht" ? h("div", { class: "stack" }, h("p", { class: "mono" }, p.onderwerp), h("pre", { class: "pre" }, p.bericht),
      h("div", { class: "row" }, h("button", { class: "btn btn-sm", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(`${p.onderwerp}\n\n${p.bericht}`); toast("Gekopieerd.", "ok"); } catch { toast("Kopiëren mislukt; selecteer de tekst handmatig.", "bad"); } } }, "Kopiëren"),
        a.used_at ? h("span", { class: "badge b-off" }, `Verstuurd gemarkeerd ${fmt.dt(a.used_at)}`) : ctx.can("approvals.decide") ? h("button", { class: "btn btn-sm btn-gold", type: "button", onclick: (e) => use(e.currentTarget) }, "Ik heb dit verstuurd") : null)) : null,
    a.status === "goedgekeurd" && a.kind === "offerte" ? h("div", { class: "row" }, a.used_at ? h("span", { class: "badge b-off" }, `Verstuurd ${fmt.dt(a.used_at)}`) : ctx.can("approvals.money") ? h("button", { class: "btn btn-sm btn-gold", type: "button", onclick: (e) => use(e.currentTarget) }, "Offerte is verstuurd") : null) : null);
}

export async function mount(root, ctx) {
  let tab = "open";
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Goedkeuringen" });
  const renderSeg = () => seg.replaceChildren(...[["open", "Open"], ["goedgekeurd", "Goedgekeurd"], ["afgewezen", "Afgewezen"]].map(([k, v]) => h("button", { type: "button", "aria-pressed": String(k === tab), onclick: () => { tab = k; sig = ""; renderSeg(); refresh(); } }, v)));
  renderSeg();
  const body = h("div", { class: "stack" }, skeleton(2, "g2"));
  root.append(h("div", { class: "section-h" }, seg, h("p", { class: "muted" }, "Extern verzenden, publiceren, geld en verwijderen vragen altijd expliciete goedkeuring. Goedkeuring vervangt geen toestemming van de ontvanger.")), body);
  let sig = "";
  async function refresh(force = false) {
    if (force === true) sig = "";
    try {
      const d = await api(`approvals?status=${tab}`);
      // Niet opnieuw tekenen als er niets veranderd is: anders zou een half aangepast bericht verdwijnen.
      const nsig = tab + d.approvals.map(a => a.id + a.status + (a.used_at || "")).join("|");
      if (nsig === sig) return;
      sig = nsig;
      body.replaceChildren(...(d.approvals.length ? d.approvals.map(a => tab === "open" ? item(a, ctx, refresh) : decided(a, ctx, refresh)) : [empty(tab === "open" ? "Geen openstaande voorstellen" : "Nog niets in deze lijst")]));
      ctx.setFresh(`Opgehaald om ${fmt.time(new Date())}`);
    } catch (e) { body.replaceChildren(errorBox(e, refresh)); }
  }
  await refresh();
  return { refresh, poll: 15_000 };
}
