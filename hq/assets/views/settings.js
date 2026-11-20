import { h, fmt, skeleton, errorBox, toast, field, badge, STATE, modal } from "../ui.js";
import { api } from "../api.js";

const LIMITS = [
  ["max_concurrent", "Gelijktijdige taken", 1, 4, 1], ["task_timeout_s", "Tijdslimiet per taak (s)", 15, 55, 1], ["max_steps", "Maximaal aantal stappen", 3, 20, 1],
  ["max_attempts", "Pogingen per taak", 1, 3, 1], ["max_cost_usd_per_task", "Kostenlimiet per taak ($)", 0, 2, 0.01], ["daily_budget_usd", "Dagbudget agents ($)", 0, 25, 0.01],
];

export async function mount(root, ctx) {
  const body = h("div", { class: "stack", style: { gap: "18px" } }, skeleton(4, "g2"));
  root.append(body);
  const owner = ctx.can("settings.write");

  async function refresh() {
    try {
      const d = await api("settings");
      const blocks = [];

      blocks.push(h("section", { class: "card stack", "aria-labelledby": "s-int" }, h("h2", { id: "s-int" }, "Koppelingen"),
        h("p", { class: "muted", style: { fontSize: ".86rem" } }, "Alleen namen van ontbrekende instellingen worden getoond, nooit waarden. Sleutels staan uitsluitend op de server (Vercel › Settings › Environment Variables)."),
        h("div", { class: "tbl-wrap" }, h("table", {}, h("tbody", {}, d.integrations.map(i => h("tr", {}, h("td", {}, i.label), h("td", {}, badge(STATE, i.state)),
          h("td", { class: "muted" }, i.missing?.length ? `Ontbreekt: ${i.missing.join(", ")}` : "", i.note ? h("div", { class: "faint", style: { fontSize: ".78rem" } }, i.note) : null))))))));

      const inputs = {};
      blocks.push(h("section", { class: "card stack", "aria-labelledby": "s-lim" }, h("h2", { id: "s-lim" }, "Grenzen voor agents"),
        h("p", { class: "muted", style: { fontSize: ".86rem" } }, `Vandaag besteed: ${fmt.usd(d.spentTodayUsd)}. Bij het dagbudget worden geen nieuwe taken gestart. Terugkerende runs: ${d.recurring.enabled ? "aan" : "uit"} (in deze versie niet instelbaar).`),
        h("div", { class: "fgrid" }, LIMITS.map(([k, label, lo, hi, step]) => { inputs[k] = h("input", { type: "number", min: lo, max: hi, step, value: d.limits[k], disabled: !owner }); return field(label, inputs[k], { help: `${lo}–${hi}` }); })),
        owner ? h("div", {}, h("button", { class: "btn btn-gold", type: "button", onclick: async () => {
          try { await api("settings/limits", { method: "PUT", body: Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, Number(el.value)])) }); toast("Grenzen opgeslagen.", "ok"); refresh(); } catch (e) { toast(e.message, "bad"); }
        } }, "Opslaan")) : h("p", { class: "faint" }, "Alleen een eigenaar kan grenzen wijzigen.")));

      blocks.push(h("section", { class: "card stack", "aria-labelledby": "s-pk" }, h("h2", { id: "s-pk" }, "Pakketten en voorwaarden"),
        h("p", { class: "muted", style: { fontSize: ".86rem" } }, "Offertes gebruiken uitsluitend deze prijzen en voorwaarden. Agents kunnen ze niet aanpassen. Houd ze gelijk aan de prijzen op de website (CONFIG in index.html)."),
        ...d.packages.map(p => {
          const price = h("input", { type: "number", min: "0", step: "1", value: p.price_cents / 100, disabled: !owner });
          const terms = h("textarea", { rows: "3", disabled: !owner, placeholder: "Bijvoorbeeld: levertijd, betaaltermijn, wat inbegrepen is. Zonder voorwaarden geen offerte." }); terms.value = p.terms;
          return h("div", { class: "stack", style: { borderTop: "1px solid var(--line)", paddingTop: "12px" } },
            h("div", { class: "row" }, h("strong", {}, p.name), h("span", { class: "faint" }, p.pitch), h("span", { class: "spacer" }), p.terms ? null : h("span", { class: "badge b-warn" }, "Geen voorwaarden")),
            h("div", { class: "fgrid" }, field("Prijs (€)", price), field("Voorwaarden", terms, { full: true })),
            owner ? h("div", {}, h("button", { class: "btn btn-sm", type: "button", onclick: async () => {
              try { await api(`packages/${p.key}`, { method: "PUT", body: { price_eur: Number(price.value), terms: terms.value } }); toast(`${p.name} opgeslagen.`, "ok"); refresh(); } catch (e) { toast(e.message, "bad"); }
            } }, "Opslaan")) : null);
        })));

      if (ctx.can("members.manage")) {
        const email = h("input", { type: "email", placeholder: "naam@bedrijf.nl", "aria-label": "E-mailadres om uit te nodigen", style: { maxWidth: "280px" } });
        const role = h("select", { "aria-label": "Rol voor de uitnodiging", style: { maxWidth: "180px" } },h("option", { value: "medewerker" }, "Medewerker"), h("option", { value: "alleen_lezen" }, "Alleen-lezen"));
        blocks.push(h("section", { class: "card stack", "aria-labelledby": "s-mem" }, h("h2", { id: "s-mem" }, "Toegang"),
          h("p", { class: "muted", style: { fontSize: ".86rem" } }, `Geen openbare registratie: alleen via uitnodiging. Nieuwe accounts zijn nooit automatisch eigenaar. MFA verplicht voor: ${d.mfaRoles.join(", ")}.`),
          h("div", { class: "row" }, email, role, h("button", { class: "btn btn-gold", type: "button", onclick: async () => {
            try { await api("members/invite", { method: "POST", body: { email: email.value, role: role.value } }); toast("Uitnodiging verstuurd.", "ok"); email.value = ""; refresh(); } catch (e) { toast(e.message, "bad"); }
          } }, "Uitnodigen")),
          h("div", { class: "tbl-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Account", "Rol", "Status", "Laatst ingelogd", ""].map(t => h("th", {}, t)))),
            h("tbody", {}, d.members.map(m => h("tr", {}, h("td", {}, m.email, m.user_id === ctx.me.userId ? h("span", { class: "faint" }, " (jij)") : null),
              h("td", {}, d.roles.find(r => r.key === m.role)?.label), h("td", {}, m.status), h("td", { class: "num" }, m.last_login_at ? fmt.dt(m.last_login_at) : "—"),
              h("td", {}, m.user_id === ctx.me.userId ? null : h("div", { class: "row" },
                h("select", { "aria-label": `Rol van ${m.email}`, onchange: async (e) => {
                  const v = e.target.value; let confirm;
                  if (v === "eigenaar") { confirm = prompt('Eigenaarsrechten geven? Typ EIGENAAR om te bevestigen.'); if (confirm !== "EIGENAAR") { e.target.value = m.role; return; } }
                  try { await api(`members/${m.user_id}`, { method: "PATCH", body: { role: v, confirm } }); toast("Rol bijgewerkt.", "ok"); refresh(); } catch (err) { toast(err.message, "bad"); e.target.value = m.role; }
                } }, d.roles.map(r => h("option", { value: r.key, selected: r.key === m.role }, r.label))),
                h("button", { class: "btn btn-sm", type: "button", onclick: async () => {
                  try { await api(`members/${m.user_id}`, { method: "PATCH", body: { status: m.status === "geblokkeerd" ? "actief" : "geblokkeerd" } }); toast("Bijgewerkt.", "ok"); refresh(); } catch (e) { toast(e.message, "bad"); }
                } }, m.status === "geblokkeerd" ? "Deblokkeren" : "Blokkeren"))))))))));
      }

      let intern = false; try { intern = localStorage.getItem("sw-intern") === "1"; } catch {}
      blocks.push(h("section", { class: "card stack", "aria-labelledby": "s-test" }, h("h2", { id: "s-test" }, "Testverkeer"),
        h("p", { class: "muted", style: { fontSize: ".86rem" } }, "Markeer dit apparaat als intern: je eigen bezoeken aan de website tellen dan als testverkeer en niet in de productiecijfers."),
        h("div", { class: "row" }, badge({ a: { cls: intern ? "b-ok" : "b-off" } }, "a", intern ? "Dit apparaat is gemarkeerd" : "Niet gemarkeerd"),
          h("button", { class: "btn btn-sm", type: "button", onclick: () => { try { intern ? localStorage.removeItem("sw-intern") : localStorage.setItem("sw-intern", "1"); } catch {} refresh(); } }, intern ? "Markering weghalen" : "Markeer als intern"))));

      if (owner) {
        blocks.push(h("section", { class: "card stack", "aria-labelledby": "s-aud" }, h("h2", { id: "s-aud" }, "Controlelog"),
          h("button", { class: "btn btn-sm", type: "button", onclick: async () => {
            try {
              const r = await api("audit");
              modal("Controlelog (laatste 200)", h("div", { class: "tbl-wrap" }, h("table", {}, h("tbody", {}, r.entries.map(x => h("tr", {}, h("td", { class: "num faint" }, fmt.dt(x.at)), h("td", {}, x.actor_label || "systeem"), h("td", {}, x.action), h("td", { class: "mono faint" }, x.entity ? `${x.entity}:${String(x.entity_id || "").slice(0, 8)}` : "")))))));
            } catch (e) { toast(e.message, "bad"); }
          } }, "Controlelog bekijken")));
      }
      body.replaceChildren(...blocks);
    } catch (e) { body.replaceChildren(errorBox(e, refresh)); }
  }
  await refresh();
  return { refresh: null };
}
