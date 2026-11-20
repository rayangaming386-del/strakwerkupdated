import { h, fmt, metric, skeleton, errorBox, badge, STATE } from "../ui.js";
import { api } from "../api.js";

const ok = (value) => ({ value, state: "ok", source: "CRM" });

function sourcesTable(sources) {
  return h("div", { class: "tbl-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, ["Gegevensbron", "Status", "Laatste meting", "Gecontroleerd", "Toelichting"].map(t => h("th", { scope: "col" }, t)))),
    h("tbody", {}, sources.map(s => h("tr", {},
      h("td", {}, s.label),
      h("td", {}, badge(STATE, s.state)),
      h("td", { class: "num" }, s.lastEventAt ? `${fmt.dt(s.lastEventAt)} (${fmt.ago(s.lastEventAt)})` : s.fetchedAt ? `opgehaald ${fmt.time(s.fetchedAt)}` : "—"),
      h("td", { class: "num" }, s.checkedAt ? fmt.time(s.checkedAt) : "—"),
      h("td", { class: "muted" }, s.error || (s.missing?.length ? `Ontbreekt: ${s.missing.join(", ")}` : s.note || ""), s.notes?.length ? h("div", { class: "faint" }, s.notes.join(" · ")) : null))))));
}

export async function mount(root, ctx) {
  const body = h("div", { class: "stack", style: { gap: "26px" } }, skeleton(8));
  root.append(
    h("div", { class: "section-h" }, h("p", { class: "muted" }, "Echte, beschikbare gegevens. Ontbreekt een koppeling, dan staat er “Niet gekoppeld” in plaats van een nul.")),
    body);

  async function refresh() {
    try {
      const d = await api("overview");
      const m = d.metrics, c = d.crm;
      const dbOk = d.sources.find(s => s.id === "eigen")?.state !== "niet_gekoppeld";
      const crm = (v) => dbOk ? ok(v) : { state: "niet_gekoppeld" };
      body.replaceChildren(
        h("section", { class: "stack", "aria-labelledby": "s-bez" },
          h("div", { class: "section-h" }, h("h2", { id: "s-bez" }, "Bezoekers")),
          h("div", { class: "grid g4" },
            metric("Actief (laatste 5 min)", m.active5m, { hint: "Bezoekers met een gemeten paginaweergave of klik in de laatste 5 minuten. Niet: wie nu nog kijkt." }),
            metric("Bezoekers vandaag", m.visitorsToday, { hint: "Unieke bezoekers sinds 00:00 (per dag geteld)." }),
            metric("Paginaweergaven vandaag", m.pageviewsToday),
            m.vercelVisitorsToday ? metric("Bezoekers vandaag (Vercel)", m.vercelVisitorsToday, { hint: "Ter vergelijking: telt anders en met vertraging." }) : null)),
        h("section", { class: "stack", "aria-labelledby": "s-klik" },
          h("div", { class: "section-h" }, h("h2", { id: "s-klik" }, "Contactklikken vandaag"),
            h("p", { class: "muted" }, "Een klik opent WhatsApp, mail of telefoon. Of er daarna echt een bericht is verstuurd, kan de site niet zien.")),
          h("div", { class: "grid g4" },
            metric("WhatsApp-klikken", m.clicks.whatsapp, { hint: m.clicks.quoteWhatsapp?.state === "ok" ? `waarvan vanuit de offerte: ${fmt.n(m.clicks.quoteWhatsapp.value)}` : null }),
            metric("E-mailklikken", m.clicks.email),
            metric("Belklikken", m.clicks.phone),
            metric("Calculator gestart", m.clicks.calculator))),
        h("section", { class: "stack", "aria-labelledby": "s-com" },
          h("div", { class: "section-h" }, h("h2", { id: "s-com" }, "Aanvragen en opdrachten"),
            h("p", { class: "muted" }, "Alleen bevestigde gegevens uit het CRM. Offertewaarde, gewonnen opdrachtwaarde en ontvangen omzet zijn drie verschillende dingen.")),
          h("div", { class: "grid g4" },
            metric("Bevestigde aanvragen", crm(c?.requests_30d), { hint: `Laatste 30 dagen · vandaag: ${fmt.n(c?.requests_today)}`, note: "Bron: CRM (handmatig geregistreerd)" }),
            metric("Openstaande offertes", crm(c?.open_quotes), { hint: `Offertewaarde: ${fmt.eur(c?.open_quotes_cents)}`, note: "Bron: CRM · status verstuurd" }),
            metric("Gewonnen opdrachten", crm(c?.won_count), { hint: `Gewonnen opdrachtwaarde: ${fmt.eur(c?.won_cents)}`, note: "Bron: CRM · geaccepteerde offertes" }),
            metric("Ontvangen omzet", crm(c?.received_cents), { format: fmt.eur, note: "Bron: handmatig geregistreerde betalingen" }))),
        h("section", { class: "stack", "aria-labelledby": "s-ag" },
          h("div", { class: "section-h" }, h("h2", { id: "s-ag" }, "Agents")),
          h("div", { class: "grid g4" },
            metric("Lopende agenttaken", dbOk ? { value: d.tasks.running, state: "ok", source: "takenwachtrij" } : { state: "niet_gekoppeld" }, { hint: `In wachtrij: ${fmt.n(d.tasks.queued)} · mislukt (7 d): ${fmt.n(d.tasks.failed7d)}` }),
            metric("Benodigde goedkeuringen", dbOk ? { value: d.approvalsOpen, state: "ok", source: "goedkeuringsinbox" } : { state: "niet_gekoppeld" }),
            metric("Agentkosten vandaag", dbOk ? { value: d.agentCost.today, state: "ok", source: "gemeten tokenverbruik" } : { state: "niet_gekoppeld" },
              { format: fmt.usd, hint: `Deze maand: ${fmt.usd(d.agentCost.month)} · dagbudget ${fmt.usd(d.agentCost.dailyBudget)}${d.agentCost.llm ? "" : " · taalmodel niet gekoppeld"}` }))),
        h("section", { class: "stack", "aria-labelledby": "s-src" },
          h("div", { class: "section-h" }, h("h2", { id: "s-src" }, "Gegevensbronnen")),
          sourcesTable(d.sources)),
      );
      ctx.setFresh(`Opgehaald om ${fmt.time(d.generatedAt)} · ververst elke 30 s`);
    } catch (e) {
      body.replaceChildren(errorBox(e, refresh));
      ctx.setFresh("Ophalen mislukt");
    }
  }
  await refresh();
  return { refresh, poll: 30_000 };
}
