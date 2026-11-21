// Startscherm (mobiel eerst): wat vraagt nu aandacht, welke keuzes liggen bij Rayan,
// en een opdrachtveld in gewone taal. Test- en productiegegevens zijn strikt gescheiden.
import { h, fmt, errorBox, skeleton, toast, empty } from "../ui.js";
import { api } from "../api.js";
import { put, envSwitch, getEnv, envQs, copyBtn, waHref, mailHref, DEPT } from "./klant-ui.js";

export async function mount(root, ctx) {
  const out = h("div", { class: "stack" });
  const ta = h("textarea", { rows: 3, placeholder: "Bijv.: Deze kapper wil een website met afspraken. Bedrijf: \"Kapsalon Delta\", mail delta@… Zet de aanvraag erin en bereid een offerte voor.", "aria-label": "Opdracht", style: { width: "100%" } });
  const body = h("div", { class: "stack", style: { gap: "22px" } }, skeleton(4));
  const cmd = h("form", { class: "card stack", onsubmit: async (e) => {
    e.preventDefault();
    const text = ta.value.trim(); if (!text) return;
    const b = e.submitter || cmd.querySelector("button"); b.disabled = true;
    try {
      const r = await api("opdracht", { method: "POST", body: { text, is_test: getEnv() === "test" } });
      put(out, 
        r.done.length ? h("div", { class: "callout" }, h("strong", {}, "Gedaan"), h("ul", { class: "acts" }, r.done.map(d => h("li", {}, d)))) : null,
        r.decide.length ? h("div", { class: "callout info" }, h("strong", {}, "Jouw beslissing"), h("ul", { class: "acts" }, r.decide.map(d => h("li", {}, d)))) : null,
        r.lead_id ? h("a", { href: `/hq/klanten?id=${r.lead_id}`, "data-nav": "" }, "Open de klantkaart →") : null);
      if (r.understood) { ta.value = ""; refresh(); }
    } catch (err) { toast(err.message, "bad"); } finally { b.disabled = false; }
  } },
    h("label", { for: "cmd", class: "muted", style: { fontSize: ".85rem" } }, "Opdracht in gewone taal"), Object.assign(ta, { id: "cmd" }),
    h("div", { class: "row" }, h("button", { class: "btn btn-gold", type: "submit" }, "Uitvoeren"), h("span", { class: "faint", style: { fontSize: ".78rem" } }, "Versturen en geld blijven altijd jouw beslissing.")), out);
  const pauseBtn = h("button", { class: "btn btn-sm", type: "button" }, "…");
  root.append(h("div", { class: "row", style: { justifyContent: "space-between" } }, envSwitch(() => refresh()), pauseBtn), cmd, body);

  async function refresh() {
    try {
      const d = await api(`vandaag${envQs()}`);
      pauseBtn.textContent = d.paused ? "Kantoor hervatten" : "Kantoor pauzeren";
      pauseBtn.className = `btn btn-sm ${d.paused ? "btn-gold" : ""}`;
      pauseBtn.onclick = async () => { try { await api("kantoor/pauze", { method: "PUT", body: { paused: !d.paused } }); toast(d.paused ? "Kantoor draait weer." : "Kantoor gepauzeerd: niets wordt automatisch verstuurd."); refresh(); } catch (e) { toast(e.message, "bad"); } };
      const sec = (id, title, sub, content) => h("section", { class: "stack", "aria-labelledby": id }, h("div", { class: "section-h" }, h("h2", { id }, title), sub ? h("p", { class: "muted" }, sub) : null), content);
      const b = d.briefing;
      put(body, 
        d.paused ? h("div", { class: "callout" }, "Het kantoor staat op pauze: geen automatische berichten, geen overleg, geen Scout-rondes.") : null,
        sec("v-wacht", `Wacht op antwoord (${d.requests.length})`, "Warme aanvragen gaan voor alles.",
          d.requests.length ? h("div", { class: "grid g2" }, d.requests.map(l => h("a", { class: "card lead-card", href: `/hq/klanten?id=${l.id}`, "data-nav": "" },
            h("div", { class: "row", style: { justifyContent: "space-between" } }, h("strong", {}, l.company), h("span", { class: "badge b-warn" }, `wacht ${fmt.ago(l.awaiting_reply_since).replace(" geleden", "")}`)),
            h("p", { class: "muted", style: { margin: "6px 0 0" } }, l.need_summary || "")))) : empty("Niemand wacht op je", "Nieuwe aanvragen verschijnen hier direct.")),
        sec("v-hand", `Klaar om zelf te versturen (${d.manual.length})`, "Toegestaan, maar zonder automatische route: kopiëren en versturen.",
          d.manual.length ? h("div", { class: "stack" }, d.manual.map(o => h("div", { class: "card stack" },
            h("div", { class: "row", style: { justifyContent: "space-between" } }, h("strong", {}, o.company), h("span", { class: "badge" }, o.kind.replace(/_/g, " "))),
            h("pre", { class: "pre" }, o.body),
            h("div", { class: "row" }, copyBtn(o.body), o.channel === "whatsapp" ? h("a", { class: "btn btn-sm", href: waHref(o.to_address, o.body), target: "_blank", rel: "noopener" }, "Open WhatsApp") : h("a", { class: "btn btn-sm", href: mailHref(o.to_address, o.subject, o.body) }, "Open mail"),
              h("button", { class: "btn btn-sm btn-gold", type: "button", onclick: async () => { await api(`outreach/${o.id}/verstuurd`, { method: "POST", body: {} }); toast("Gemarkeerd als verstuurd."); refresh(); } }, "Ik heb het verstuurd"))))) : empty("Niets klaar te zetten")),
        sec("v-off", `Offertes die aandacht vragen (${d.quotes.length})`, null,
          d.quotes.length ? h("div", { class: "grid g2" }, d.quotes.map(q => h("a", { class: "card", href: `/hq/klanten?id=${q.lead_id}`, "data-nav": "" },
            h("div", { class: "row", style: { justifyContent: "space-between" } }, h("strong", {}, q.company), h("span", { class: "num" }, fmt.eur(q.price_cents))),
            h("p", { class: "muted", style: { margin: "6px 0 0" } }, q.status === "concept" ? `Concept klaar${(q.extras || []).length ? " · bevat extra wensen: eerst beoordelen" : ""}` : `Verstuurd ${fmt.ago(q.sent_at)}${q.interest ? " · belangstelling getoond" : ""}`)))) : empty("Geen offertes die wachten")),
        sec("v-kz", `Keuzes voor jou (${d.decisions.length})`, null,
          d.decisions.length ? h("ul", { class: "acts big" }, d.decisions.map(x => h("li", {}, h("strong", {}, `${({ feedback: "Meerwerk", review: "Review", onzeker: "Controleren", fout: "Fout" })[x.soort] || x.soort}: `), `${x.titel} · ${x.waarom || ""}`))) : empty("Geen open keuzes")),
        sec("v-proj", `Actieve projecten (${d.projects.length}) · capaciteit ${d.capacity.active}/${d.capacity.max}`, `Vroegste start nieuw project: ${d.capacity.earliest_start}`,
          d.projects.length ? h("div", { class: "grid g2" }, d.projects.map(p => h("a", { class: "card", href: `/hq/klanten?id=${p.lead_id}`, "data-nav": "" },
            h("div", { class: "row", style: { justifyContent: "space-between" } }, h("strong", {}, p.name), h("span", { class: "badge b-info" }, p.status.replace(/_/g, " "))),
            h("p", { class: "muted", style: { margin: "6px 0 0" } }, p.intake_complete_at ? "Intake compleet · briefing klaar" : "Wacht op intake-materiaal")))) : empty("Geen lopende projecten")),
        sec("v-overleg", "Ochtendoverleg", b ? `${fmt.day(b.day)} · samenvatting door ${b.summary_by === "code" ? "gewone code" : b.summary_by}` : "Nog geen overleg.",
          h("div", { class: "stack" }, b ? h("p", {}, b.summary) : null,
            d.actions.length ? h("div", { class: "stack" }, d.actions.map(a => h("div", { class: "card stack" },
              h("div", { class: "row", style: { justifyContent: "space-between" } }, h("strong", {}, a.title), h("span", { class: "badge b-gold" }, DEPT[a.department] || a.department)),
              h("p", { class: "muted", style: { margin: 0 } }, `Waarom: ${a.reason}. Bijdrage: ${a.expected}.`),
              h("p", { style: { margin: 0 } }, `Volgende stap: ${a.next_step}`),
              h("div", { class: "row" }, a.lead_id ? h("a", { class: "btn btn-sm", href: `/hq/klanten?id=${a.lead_id}`, "data-nav": "" }, "Open") : null,
                a.status === "open" ? h("button", { class: "btn btn-sm", type: "button", onclick: async () => { await api(`acties/${a.id}`, { method: "POST", body: { status: "opgepakt" } }); refresh(); } }, "Opgepakt") : h("span", { class: "badge" }, a.status),
                h("button", { class: "btn btn-sm btn-gold", type: "button", onclick: async () => { await api(`acties/${a.id}`, { method: "POST", body: { status: "klaar" } }); refresh(); } }, "Klaar"))))) : empty("Geen open acties"))),
      );
      ctx.setFresh(`${d.env === "test" ? "TESTOMGEVING · " : ""}Opgehaald ${fmt.time(new Date())}`);
    } catch (e) { put(body, errorBox(e, refresh)); }
  }
  await refresh();
  return { refresh, poll: 30_000 };
}
