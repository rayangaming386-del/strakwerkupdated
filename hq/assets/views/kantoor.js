// Kantoor: ochtendoverleg, scorekaarten, verzendroutes en eigen fouten, Scout en segmenten,
// experimenten, partners, resultaten en instellingen (overleg, opvolging, capaciteit, beschikbaarheid).
import { h, fmt, errorBox, skeleton, toast, empty, field } from "../ui.js";
import { api } from "../api.js";
import { put, envSwitch, envQs, DEPT } from "./klant-ui.js";

const TABS = [["overleg", "Overleg"], ["scores", "Scorekaarten"], ["routes", "Routes & fouten"], ["scout", "Scout"], ["exp", "Experimenten"], ["partners", "Partners"], ["resultaten", "Resultaten"], ["instellingen", "Instellingen"]];

export async function mount(root, ctx) {
  let tab = new URLSearchParams(location.search).get("tab") || "overleg";
  const box = h("div", { class: "stack", style: { gap: "18px" } }, skeleton(4, "g2"));
  const tabs = h("div", { class: "seg tabs", role: "tablist" }, TABS.map(([k, l]) => h("button", { type: "button", role: "tab", "aria-pressed": String(k === tab), onclick: (e) => { tab = k; tabs.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === e.currentTarget))); render(); } }, l)));
  root.append(h("div", { class: "row" }, envSwitch(() => refresh())), tabs, box);
  let d = null;
  const act = (label, fn, cls = "") => h("button", { class: `btn btn-sm ${cls}`, type: "button", onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); await refresh(); } catch (err) { toast(err.message, "bad"); } finally { b.disabled = false; } } }, label);
  const card = (title, ...c) => h("section", { class: "card stack" }, title ? h("h2", { style: { fontSize: "1.02rem", margin: 0 } }, title) : null, ...c);

  function render() {
    if (!d) return;
    const T = {
      overleg: () => [
        card("Ochtendoverleg", h("p", { class: "muted", style: { margin: 0 } }, `Elke dag om ${d.settings.kantoor.meeting_time || "08:30"} (Nederlandse tijd). Cijfers komen uit gewone code; hooguit één AI-samenvatting als er bevestigd tegoed is.`),
          act("Overleg nu opnieuw opstellen", () => api(`kantoor/overleg${envQs()}`, { method: "POST", body: {} }), "btn-gold")),
        ...(d.briefings.length ? d.briefings.map(b => card(`${fmt.day(b.day)} · ${b.summary_by === "code" ? "samenvatting uit code" : "samenvatting door Claude"}`,
          h("p", { style: { margin: 0 } }, b.summary),
          b.facts?.vastgelopen?.length ? h("div", { class: "stack" }, h("strong", {}, "Vastgelopen (met bewijs)"), h("ul", { class: "acts" }, b.facts.vastgelopen.map(v => h("li", {}, `${v.waar}: ${v.bewijs || ""}`)))) : null,
          (b.previous || []).length ? h("div", { class: "stack" }, h("strong", {}, "Acties vorig overleg"), h("ul", { class: "acts" }, b.previous.map(p => h("li", {}, `${p.title} (${DEPT[p.department] || p.department}): ${p.status}${p.result ? ` · ${p.result}` : ""}`)))) : null))
          : [empty("Nog geen overleg", "Het eerste overleg verschijnt vanzelf om het ingestelde tijdstip.")]),
      ],
      scores: () => [
        h("p", { class: "muted" }, d.scorecards.note),
        h("div", { class: "grid g2" }, ["scout", "auditor", "acquisitie", "sales", "marketing"].map(k => { const s = d.scorecards[k]; return card(`${s.label} · bonus ${s.bonus >= 0 ? "+" : ""}${s.bonus}`,
          h("ul", { class: "acts" }, s.metrics.map(m => h("li", {}, `${m.naam}: ${m.aantal ?? "—"}${m.van != null ? ` van ${m.van}` : ""}${m.pct != null ? ` (${m.pct}%)` : m.van != null && !m.van ? " (nog onvoldoende bewijs)" : ""}`))),
          s.fouten.totaal ? h("p", { class: "muted", style: { margin: 0 } }, `Eigen fouten: ${s.fouten.totaal} (open: ${s.fouten.open})`) : null); })),
      ],
      routes: () => [
        card("E-mail vanaf het StrakWerk-adres", h("p", { class: "muted", style: { margin: 0 } }, d.mail ? "SMTP gekoppeld." : "SMTP niet gekoppeld: berichten worden in proefstand vastgelegd (TEST)."),
          h("dl", { class: "kv" }, h("dt", {}, "Automatisch inplannen"), h("dd", {}, d.routes.email.auto ? "aan" : "uit"), h("dt", {}, "Echt versturen (live)"), h("dd", {}, d.routes.email.live ? "aan" : "uit (proefstand)"),
            h("dt", {}, "Max. per dag"), h("dd", {}, String(d.routes.email.max_per_day)), h("dt", {}, "Min. dagen tussen berichten"), h("dd", {}, String(d.routes.email.min_days_between)),
            h("dt", {}, "Voorwaarden gecontroleerd"), h("dd", {}, d.routes.email.terms_checked_at ? fmt.dt(d.routes.email.terms_checked_at) : "nee")),
          d.routes.email.paused ? h("div", { class: "callout" }, `Gepauzeerd: ${d.routes.email.pause_reason}. Gaat pas weer open als de fout is hersteld en getest.`) : null,
          ctx.can("settings.write") ? h("div", { class: "row" },
            act(d.routes.email.auto ? "Automatisch uit" : "Automatisch aan", () => { const ok = d.routes.email.terms_checked_at || confirm("Heb je de voorwaarden van je verzenddienst (bijv. Gmail) gecontroleerd voor zakelijke berichten en limieten?"); if (!ok) return; return api("kantoor/routes", { method: "PUT", body: { email: { auto: !d.routes.email.auto, terms_checked: true } } }); }),
            act(d.routes.email.live ? "Live uit (proefstand)" : "Live aan", () => { if (!d.routes.email.live && !confirm("Live: berichten gaan echt naar ondernemers. Zeker weten?")) return; return api("kantoor/routes", { method: "PUT", body: { email: { live: !d.routes.email.live, terms_checked: true } } }); }, d.routes.email.live ? "" : "btn-gold")) : null),
        card("Mailtest met je eigen adres", h("p", { class: "muted", style: { margin: 0 } }, "Verstuurt één echt bericht naar het e-mailadres waarmee je bent ingelogd. Antwoord erop: je antwoord hoort op de klantkaart \"Mailtest StrakWerk HQ\" te verschijnen en de geplande opvolging hoort te stoppen."),
          ctx.can("settings.write") ? act("Testmail naar mezelf", async () => { const r = await api("kantoor/mailtest", { method: "POST", body: {} }); toast(`Verstuurd via ${r.route === "gmail_api" ? "Gmail API" : "SMTP"}. Antwoord erop en open daarna de klantkaart.`); }, "btn-gold") : null),
        card("WhatsApp en telefoon", h("p", { class: "muted", style: { margin: 0 } }, "Geen gratis automatische route: HQ zet berichten klaar met een kopieerknop en een link. Handmatig versturen verandert de contactregels niet.")),
        card("Eigen fouten", d.errors.length ? h("div", { class: "stack" }, d.errors.map(e => h("div", { class: "stack", style: { borderTop: "1px solid var(--line)", paddingTop: "8px" } },
          h("div", { class: "row" }, h("strong", {}, e.kind.replace(/_/g, " ")), h("span", { class: `badge ${e.resolved_at ? "b-ok" : "b-bad"}` }, e.resolved_at ? "hersteld" : "open"), e.route ? h("span", { class: "badge" }, `route ${e.route}`) : null),
          h("p", { style: { margin: 0 } }, e.description), e.resolved_note ? h("p", { class: "faint", style: { margin: 0 } }, e.resolved_note) : null,
          !e.resolved_at && ctx.can("settings.write") ? act("Hersteld: zelftest uitvoeren", () => api(`fouten/${e.id}/hersteld`, { method: "POST", body: { note: prompt("Wat is er aangepast?") || "" } }), "btn-gold") : null))) : empty("Geen fouten")),
      ],
      scout: () => [
        card("Ontdekken via OpenStreetMap", h("p", { class: "muted", style: { margin: 0 } }, "Gratis open data (© OpenStreetMap-bijdragers). Per bedrijf: bron, datum, websitestatus met de gedane controles, activiteit en prioriteit. Bestaande klanten worden herkend."),
          ...d.segments.map(s => h("div", { class: "stack", style: { borderTop: "1px solid var(--line)", paddingTop: "8px" } },
            h("div", { class: "row", style: { justifyContent: "space-between" } }, h("strong", {}, s.name), h("span", { class: `badge ${s.active ? "b-ok" : "b-off"}` }, s.active ? "actief" : "uit")),
            h("p", { class: "muted", style: { margin: 0 } }, `Werkhypothese: ${s.hypothesis}`),
            h("div", { class: "row" }, ...s.cities.map(c => act(`Zoek in ${c}`, async () => { const r = await api("scout/ontdekken", { method: "POST", body: { segment: s.key, city: c, limit: 15 } }); toast(r.duplicate ? "Vandaag al ingepland." : "Scout is gestart; resultaten verschijnen bij Klanten › Gevonden door Scout."); })),
              ctx.can("settings.write") ? act(s.active ? "Segment uit" : "Segment aan", () => api(`segmenten/${s.key}`, { method: "PUT", body: { active: !s.active } })) : null)))),
        card("Wekelijkse Scout-ronde", h("p", { class: "muted", style: { margin: 0 } }, d.settings.scout.enabled ? `Aan: ${d.settings.scout.per_week || 0} bedrijven per week (dinsdag).` : "Uit. Zet aan in Instellingen als je wekelijks nieuwe bedrijven wilt laten zoeken.")),
      ],
      exp: () => [
        card("Nieuw experiment (één wijziging tegelijk)", expForm()),
        ...(d.experiments.length ? d.experiments.map(x => card(`${x.experiment.name} · ${x.experiment.status}`,
          h("p", { style: { margin: 0 } }, `Wijziging: ${x.experiment.change}. Succes = ${x.experiment.metric}.`),
          h("p", { class: "muted", style: { margin: 0 } }, `A: ${x.A.positief}/${x.A.verzonden} · B: ${x.B.positief}/${x.B.verzonden} · minimaal ${x.experiment.min_samples} per variant → ${x.verdict}`),
          x.experiment.status === "loopt" && ctx.can("settings.write") ? h("div", { class: "row" }, act("Afronden", () => api(`experimenten/${x.experiment.id}/afronden`, { method: "POST", body: {} })), act("Terugdraaien naar A", () => api(`experimenten/${x.experiment.id}/afronden`, { method: "POST", body: { rollback: true } }))) : null)) : []),
        card("Promptversies", h("ul", { class: "acts" }, d.prompts.map(p => h("li", {}, `${p.key} v${p.version}${p.active ? " (actief)" : ""} · ${p.note}`, !p.active && ctx.can("settings.write") ? [" ", act("Activeer (terugzetten)", () => api(`promptversies/${p.id}/activeer`, { method: "POST", body: {} }))] : null)))),
      ],
      partners: () => [
        card("Partner toevoegen", partnerForm()),
        ...(d.partners.length ? d.partners.map(p => card(`${p.name} · ${p.kind}`, h("dl", { class: "kv" }, h("dt", {}, "Wij bieden"), h("dd", {}, p.we_offer || "—"), h("dt", {}, "Zij bieden"), h("dd", {}, p.they_offer || "—"), h("dt", {}, "Afspraken"), h("dd", {}, p.agreement || "—"), h("dt", {}, "Beloning"), h("dd", {}, p.reward_rule || "geen (alleen met een expliciete regel)"), h("dt", {}, "Verwijslink"), h("dd", {}, `www.strakwerkk.nl/?ref=${p.ref_code}`), h("dt", {}, "Aanvragen / betalend"), h("dd", {}, `${p.aanvragen} / ${p.betalend}`)))) : [empty("Nog geen partners")]),
      ],
      resultaten: () => { const r = d.results; return [
        card(`Trechter (laatste ${r.days} dagen)`, h("div", { class: "list-rows" }, r.funnel.map(f => h("div", {}, h("span", {}, f.label), h("span", { class: "num" }, fmt.n(f.n))))),
          h("p", { class: "faint", style: { margin: 0, fontSize: ".8rem" } }, `Gekwalificeerd: ${r.qualified_definition}`)),
        card("Omzet", h("dl", { class: "kv" }, h("dt", {}, "Betaald (bevestigd)"), h("dd", {}, fmt.eur(r.betaald_cents)), h("dt", {}, "Open offertes (niet betaald)"), h("dd", {}, `${fmt.eur(r.open_offertes.waarde_cents)} · ${r.open_offertes.aantal} stuks`))),
        card("Herkomst", r.attribution.length ? h("ul", { class: "acts" }, r.attribution.map(a => h("li", {}, `${a.via}: ${a.aanvragen} aanvraag/aanvragen, ${a.betalend} betalend`))) : empty("Nog geen aanvragen"), h("p", { class: "faint", style: { margin: 0, fontSize: ".8rem" } }, r.attribution_method)),
        card("Klikken (geen aanvragen)", r.clicks.length ? h("ul", { class: "acts" }, r.clicks.map(c => h("li", {}, `${c.name}: ${c.n}`))) : empty("Geen klikken gemeten"), h("p", { class: "faint", style: { margin: 0, fontSize: ".8rem" } }, r.clicks_note)),
        card("Voorstellen (Conversie en Vindbaarheid)", d.proposals.length ? h("div", { class: "stack" }, d.proposals.map(p => h("div", { class: "stack", style: { borderTop: "1px solid var(--line)", paddingTop: "8px" } },
          h("div", { class: "row" }, h("strong", {}, p.title), h("span", { class: "badge" }, p.confidence), h("span", { class: "badge" }, p.status)), h("p", { style: { margin: 0 } }, p.problem),
          h("p", { class: "faint", style: { margin: 0 } }, `Gemeten ${fmt.dt(p.measured_at)} · steekproef ${p.sample_size ?? "—"} · voorstel: ${p.change?.voorstel || ""}`),
          p.status === "voorstel" && ctx.can("settings.write") ? h("div", { class: "row" }, act("Goedkeuren", () => api(`voorstellen/${p.id}`, { method: "POST", body: { status: "goedgekeurd" } })), act("Afwijzen", () => api(`voorstellen/${p.id}`, { method: "POST", body: { status: "afgewezen" } }))) : null))) : empty("Nog geen voorstellen", "Maandag maakt HQ voorstellen uit echte bezoekersgegevens."),
          ctx.can("settings.write") ? act("Nu voorstellen maken", async () => { const r = await api("voorstellen/maken", { method: "POST", body: {} }); toast(r.note || `${r.created} nieuw voorstel/voorstellen.`); }) : null),
      ]; },
      instellingen: () => [settingsForm()],
    };
    put(box, ...T[tab]());
  }

  function expForm() {
    const f = { name: h("input"), department: h("select", {}, h("option", { value: "acquisitie" }, "Acquisitie")), change: h("input", { placeholder: "bv. andere slotvraag" }), variant_a: h("input"), variant_b: h("input"), metric: h("input", { value: "positieve reacties per verstuurd bericht" }), min_samples: h("input", { type: "number", value: 20, min: 5 }) };
    return h("form", { class: "fgrid", onsubmit: async (e) => { e.preventDefault(); try { await api("experimenten", { method: "POST", body: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value])) }); toast("Experiment gestart."); refresh(); } catch (err) { toast(err.message, "bad"); } } },
      field("Naam", f.name), field("Afdeling", f.department), field("De ene wijziging", f.change, { full: true }), field("Variant A (huidig)", f.variant_a), field("Variant B", f.variant_b), field("Succes betekent (vooraf)", f.metric, { full: true }), field("Minimaal per variant", f.min_samples),
      h("div", { class: "full" }, h("button", { class: "btn btn-gold btn-sm", type: "submit" }, "Starten")));
  }
  function partnerForm() {
    const f = { name: h("input"), kind: h("select", {}, ["fotograaf", "drukkerij", "vormgever", "ondernemer", "klant", "anders"].map(k => h("option", { value: k }, k))), contact_name: h("input"), we_offer: h("input"), they_offer: h("input"), agreement: h("textarea", { rows: 2 }), reward_rule: h("input", { placeholder: "Leeg laten = geen beloning" }) };
    return h("form", { class: "fgrid", onsubmit: async (e) => { e.preventDefault(); try { await api("partners", { method: "POST", body: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value])) }); toast("Partner toegevoegd."); refresh(); } catch (err) { toast(err.message, "bad"); } } },
      field("Naam", f.name), field("Soort", f.kind), field("Contactpersoon", f.contact_name), field("Wat wij bieden", f.we_offer), field("Wat zij bieden", f.they_offer), field("Afspraken", f.agreement, { full: true }), field("Beloningsregel", f.reward_rule, { full: true }),
      h("div", { class: "full" }, h("button", { class: "btn btn-gold btn-sm", type: "submit" }, "Toevoegen")));
  }
  function settingsForm() {
    const s = d.settings; const sf = s.sales.followup || {}, cap = s.sales.capacity || {}, av = s.availability || {};
    const f = { meeting_time: h("input", { type: "time", value: s.kantoor.meeting_time || "08:30" }), fu_max: h("input", { type: "number", min: 0, max: 2, value: sf.max ?? 2 }), fu_days: h("input", { value: (sf.days || [3, 7]).join(",") }),
      cap_max: h("input", { type: "number", min: 1, value: cap.max_projects ?? 3 }), cap_days: h("input", { type: "number", min: 1, value: cap.days_per_project ?? 14 }),
      from: h("input", { type: "time", value: av.from || "09:00" }), to: h("input", { type: "time", value: av.to || "17:00" }), quiet_from: h("input", { type: "time", value: av.quiet_from || "21:00" }), quiet_to: h("input", { type: "time", value: av.quiet_to || "08:00" }),
      scout_on: h("input", { type: "checkbox", checked: Boolean(s.scout.enabled) }), scout_n: h("input", { type: "number", min: 0, max: 100, value: s.scout.per_week || 0 }) };
    const save = async (e) => { e.preventDefault(); try {
      await api("kantoor/instellingen/kantoor", { method: "PUT", body: { meeting_time: f.meeting_time.value } });
      await api("kantoor/instellingen/sales", { method: "PUT", body: { followup: { max: Number(f.fu_max.value), days: f.fu_days.value.split(",").map(Number) }, capacity: { max_projects: Number(f.cap_max.value), days_per_project: Number(f.cap_days.value) } } });
      await api("kantoor/instellingen/availability", { method: "PUT", body: { from: f.from.value, to: f.to.value, quiet_from: f.quiet_from.value, quiet_to: f.quiet_to.value } });
      await api("kantoor/instellingen/scout", { method: "PUT", body: { enabled: f.scout_on.checked, per_week: Number(f.scout_n.value) } });
      toast("Opgeslagen."); refresh(); } catch (err) { toast(err.message, "bad"); } };
    return card("Instellingen", h("form", { class: "fgrid", onsubmit: save },
      field("Ochtendoverleg (NL-tijd)", f.meeting_time), field("Max. opvolgingen offerte", f.fu_max, { help: "Alleen bij getoonde interesse; stopt bij elke reactie." }), field("Na hoeveel dagen", f.fu_days, { help: "bv. 3,7" }),
      field("Projecten tegelijk", f.cap_max), field("Dagen per project", f.cap_days),
      field("Beschikbaar vanaf", f.from), field("Beschikbaar tot", f.to), field("Geen meldingen vanaf", f.quiet_from), field("Geen meldingen tot", f.quiet_to),
      field("Wekelijkse Scout-ronde", f.scout_on), field("Bedrijven per week", f.scout_n),
      ctx.can("settings.write") ? h("div", { class: "full" }, h("button", { class: "btn btn-gold btn-sm", type: "submit" }, "Opslaan")) : null),
      h("p", { class: "faint", style: { margin: 0, fontSize: ".8rem" } }, `Capaciteit nu: ${d.capacity.active}/${d.capacity.max} · AI: ${d.ai?.enabled ? "aan" : "uit (voorbeelddata)"}`));
  }

  async function refresh() {
    try { d = await api(`kantoor${envQs()}`); render(); ctx.setFresh(`Opgehaald ${fmt.time(new Date())}`); }
    catch (e) { put(box, errorBox(e, refresh)); }
  }
  await refresh();
  return { refresh };
}
