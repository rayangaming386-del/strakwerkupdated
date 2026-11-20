import { h, fmt, skeleton, errorBox, badge, TASK, empty, toast, modal } from "../ui.js";
import { api } from "../api.js";

/** Knoppen voor pauzeren/annuleren/hervatten/opnieuw, alleen wat bij de status past. */
export function taskControls(t, ctx, after) {
  if (!ctx.can("tasks.control")) return null;
  const act = async (action, label) => {
    try {
      const r = await api(`tasks/${t.id}/control`, { method: "POST", body: { action } });
      toast(r.confirmed ? `${label}: bevestigd.` : `${label} gevraagd. De uitvoerder bevestigt dit bij de volgende stap.`, "ok");
      after?.();
    } catch (e) { toast(e.message, "bad"); }
  };
  const b = [];
  if (t.control) return h("p", { class: "callout" }, t.control === "pauze_gevraagd" ? "Pauze gevraagd; wacht op bevestiging van de uitvoerder." : "Annulering gevraagd; wacht op bevestiging van de uitvoerder.");
  if (["in_wachtrij", "bezig"].includes(t.status)) b.push(h("button", { class: "btn btn-sm", type: "button", onclick: () => act("pauzeren", "Pauzeren") }, "Pauzeren"));
  if (t.status === "gepauzeerd") b.push(h("button", { class: "btn btn-sm", type: "button", onclick: () => act("hervatten", "Hervatten") }, "Hervatten"));
  if (t.status === "mislukt") b.push(h("button", { class: "btn btn-sm", type: "button", onclick: () => act("opnieuw", "Opnieuw") }, "Opnieuw proberen"));
  if (["in_wachtrij", "bezig", "gepauzeerd", "wacht_op_goedkeuring", "mislukt"].includes(t.status)) b.push(h("button", { class: "btn btn-sm btn-bad", type: "button", onclick: () => act("annuleren", "Annuleren") }, "Annuleren"));
  return b.length ? h("div", { class: "row" }, b) : null;
}

/** Toont resultaten met feiten, interpretaties en bronnen gescheiden. */
export function resultView(r) {
  if (!r) return empty("Nog geen resultaat");
  const parts = [];
  if (r.bron?.url) parts.push(h("p", { style: { fontSize: ".84rem" } }, "Bron: ", h("a", { href: r.bron.url, target: "_blank", rel: "noopener noreferrer" }, r.bron.url), ` · ${fmt.dt(r.bron.gemeten_op || r.bron.opgehaald_op)}`, r.bron.robots ? h("span", { class: "faint" }, ` · ${r.bron.robots}`) : null));
  if (r.feiten?.length) parts.push(h("div", {}, h("h3", {}, "Gemeten feiten"), h("div", { class: "tbl-wrap", style: { marginTop: "6px" } }, h("table", {}, h("tbody", {}, r.feiten.map(f => h("tr", {}, h("td", { class: "muted" }, f.feit), h("td", {}, String(f.waarde), f.let_op ? h("div", { class: "faint", style: { fontSize: ".76rem" } }, f.let_op) : null, f.controle ? h("div", {}, h("a", { href: f.controle, target: "_blank", rel: "noopener noreferrer" }, "controleren")) : null))))))));
  if (r.relevantie) parts.push(h("div", {}, h("h3", {}, `Relevantie: ${r.relevantie.relevant}`), h("p", { style: { fontSize: ".88rem" } }, r.relevantie.activiteit),
    h("ul", { style: { fontSize: ".86rem", paddingLeft: "18px" } }, (r.relevantie.redenen || []).map(x => h("li", {}, x.reden, h("span", { class: "faint" }, ` — bewijs: ${x.bewijs}`))))));
  if (r.interpretaties?.length) parts.push(h("div", {}, h("h3", {}, "Interpretaties"), h("p", { class: "faint", style: { fontSize: ".78rem" } }, "Afgeleid uit de metingen; geen gemeten feiten."),
    h("ul", { style: { fontSize: ".86rem", paddingLeft: "18px" } }, r.interpretaties.map(i => h("li", {}, i.punt, h("span", { class: "faint" }, ` (op basis van: ${(i.op_basis_van || []).join(", ")}; ${i.methode})`))))));
  if (r.kansen?.length) parts.push(h("div", {}, h("h3", {}, "Kansen"), h("ul", { style: { fontSize: ".86rem", paddingLeft: "18px" } }, r.kansen.map(k => h("li", {}, k)))));
  if (r.onzekerheden?.length) parts.push(h("div", {}, h("h3", {}, "Onzekerheden"), h("ul", { style: { fontSize: ".84rem", paddingLeft: "18px", color: "#98A2B0" } }, r.onzekerheden.map(k => h("li", {}, k)))));
  if (r.concept) parts.push(h("div", { class: "stack" }, h("h3", {}, `Berichtconcept (${r.methode})`), h("p", { class: "mono" }, r.concept.onderwerp), h("pre", { class: "pre" }, r.concept.bericht)));
  if (r.methode && !r.concept) parts.push(h("p", { class: "faint", style: { fontSize: ".78rem" } }, `Methode: ${r.methode}`));
  return h("div", { class: "stack", style: { marginTop: "8px" } }, parts);
}

export function openTask(id, ctx, after) {
  const body = h("div", {}, h("span", { class: "spinner" }), " Laden…");
  const m = modal("Taak", body, []);
  api(`tasks/${id}`).then(d => {
    const t = d.task;
    body.replaceChildren(h("div", { class: "stack" },
      h("div", { class: "row" }, h("strong", {}, t.title), h("span", { class: "spacer" }), badge(TASK, t.status)),
      h("dl", { class: "kv" },
        h("dt", {}, "Agent"), h("dd", {}, t.agent_key), h("dt", {}, "Lead"), h("dd", {}, t.company || "—"),
        h("dt", {}, "Taak-id"), h("dd", { class: "mono" }, t.id), h("dt", {}, "Keten-id"), h("dd", { class: "mono" }, t.chain_id),
        h("dt", {}, "Pogingen"), h("dd", {}, `${t.attempts} van ${t.max_attempts}`), h("dt", {}, "Tijdslimiet"), h("dd", {}, `${t.timeout_s} s`),
        h("dt", {}, "Kosten"), h("dd", {}, `${fmt.usd(t.cost_usd)} (${fmt.n(t.input_tokens)} in / ${fmt.n(t.output_tokens)} uit tokens)`),
        h("dt", {}, "Aangemaakt"), h("dd", {}, fmt.dt(t.created_at)), h("dt", {}, "Afgerond"), h("dd", {}, fmt.dt(t.finished_at))),
      t.error ? h("div", { class: "err" }, h("strong", {}, "Fout"), h("p", {}, t.error)) : null,
      taskControls(t, ctx, () => { m.close(); after?.(); }),
      d.runs.length ? h("div", {}, h("h3", {}, "Uitvoeringen"), h("div", { class: "tbl-wrap", style: { marginTop: "6px" } }, h("table", {}, h("thead", {}, h("tr", {}, ["#", "Uitvoerder", "Start", "Uitkomst", "Kosten"].map(x => h("th", {}, x)))),
        h("tbody", {}, d.runs.map(r => h("tr", {}, h("td", {}, r.attempt), h("td", { class: "mono" }, r.worker_id), h("td", {}, fmt.time(r.started_at)), h("td", {}, r.outcome || "loopt", r.error ? h("div", { class: "faint" }, r.error) : null), h("td", {}, fmt.usd(r.cost_usd)))))))) : null,
      h("div", {}, h("h3", {}, "Statusovergangen en stappen"), h("ul", { style: { fontSize: ".84rem", paddingLeft: "18px" } }, d.events.map(e => h("li", {}, h("span", { class: "faint" }, fmt.time(e.at), " "), e.message))))),
      t.result ? h("div", {}, h("h3", {}, "Resultaat"), resultView(t.result)) : null);
  }).catch(e => body.replaceChildren(errorBox(e)));
}

export async function mount(root, ctx) {
  let filter = "";
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Filter op status" });
  const F = [["", "Alle"], ["bezig", "Bezig"], ["in_wachtrij", "In wachtrij"], ["wacht_op_goedkeuring", "Wacht op goedkeuring"], ["mislukt", "Mislukt"], ["afgerond", "Afgerond"]];
  const renderSeg = () => seg.replaceChildren(...F.map(([k, v]) => h("button", { type: "button", "aria-pressed": String(k === filter), onclick: () => { filter = k; renderSeg(); refresh(); } }, v)));
  renderSeg();
  const body = h("div", {}, skeleton(1, "g2"));
  root.append(h("div", { class: "section-h" }, seg, h("p", { class: "muted" }, "Taken staan in de database en blijven bestaan na vernieuwen of sluiten van de browser.")), body);
  async function refresh() {
    try {
      const d = await api(`tasks${filter ? `?status=${filter}` : ""}`);
      if (!d.tasks.length) { body.replaceChildren(empty("Geen taken", filter ? "Geen taken met deze status." : "Start een keten vanuit Agentwereld of een lead.")); return; }
      body.replaceChildren(h("div", { class: "tbl-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Taak", "Agent", "Status", "Lead", "Pogingen", "Kosten", "Bijgewerkt"].map(t => h("th", { scope: "col" }, t)))),
        h("tbody", {}, d.tasks.map(t => h("tr", { class: "click", tabindex: "0", onclick: () => openTask(t.id, ctx, refresh), onkeydown: (e) => { if (e.key === "Enter") openTask(t.id, ctx, refresh); } },
          h("td", {}, h("strong", {}, t.title), t.error ? h("div", { class: "faint", style: { fontSize: ".78rem", color: "#F8A5A5" } }, t.error) : null),
          h("td", {}, t.agent_key), h("td", {}, badge(TASK, t.status, t.control ? "Wacht op bevestiging" : null)), h("td", {}, t.company || "—"),
          h("td", { class: "num" }, `${t.attempts}/${t.max_attempts}`), h("td", { class: "num" }, fmt.usd(t.cost_usd)), h("td", { class: "num" }, fmt.ago(t.updated_at))))))));
      ctx.setFresh(`Opgehaald om ${fmt.time(new Date())} · ververst elke 10 s`);
    } catch (e) { body.replaceChildren(errorBox(e, refresh)); }
  }
  await refresh();
  return { refresh, poll: 10_000 };
}
