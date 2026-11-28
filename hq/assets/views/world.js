// Agentwereld: isometrisch kantoor (links), contextpaneel (rechts), activiteitentijdlijn (onder).
// Alle statussen, bewegingen en overdrachten komen uit de takenopslag. Er wordt niets gesimuleerd.
import { h, fmt, skeleton, errorBox, badge, TASK, empty, toast, modal, field } from "../ui.js";
import { api } from "../api.js";
import { renderOffice, AGENT_COLOR } from "/assets/office/office-art.js";
import { taskControls, resultView } from "./tasks.js";

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

export async function startChainDialog(ctx, presetLeadId = null, onDone = () => {}) {
  let leads = [];
  try { leads = (await api("leads")).leads.filter(l => !["gewonnen", "verloren"].includes(l.status)); } catch (e) { return toast(e.message, "bad"); }
  if (!leads.length) return modal("Keten starten", empty("Nog geen leads", "Voeg eerst een lead met website toe bij Leads & klanten."), []);
  const sel = h("select", {}, leads.map(l => h("option", { value: l.id, selected: l.id === presetLeadId, disabled: !l.website }, `${l.company}${l.website ? ` — ${l.website}` : " (geen website)"}`)));
  const idem = crypto.randomUUID();
  modal("Keten Scout → Auditor → Sales starten", h("div", { class: "stack" },
    field("Lead", sel),
    h("p", { class: "callout info" }, "Scout controleert de website, Auditor meet verbeterpunten. Daarna vraagt HQ jouw goedkeuring voordat Sales een berichtconcept schrijft. Er wordt niets verstuurd.")),
    [{ label: "Annuleren", onClick: (c) => c() },
     { label: "Starten", cls: "btn-gold", onClick: async (close) => {
       try { const r = await api("tasks", { method: "POST", body: { lead_id: sel.value }, idempotencyKey: idem }); toast(r.duplicate ? "Deze keten was al gestart." : "Keten ingepland.", "ok"); close(); onDone(); }
       catch (e) { toast(e.missing?.length ? `${e.message} (ontbreekt: ${e.missing.join(", ")})` : e.message, "bad"); }
     } }]);
}

export async function mount(root, ctx) {
  let view = store.get("hq-world-view") || (matchMedia("(max-width: 700px)").matches ? "lijst" : "kantoor");
  let data = null, selected = store.get("hq-world-agent") || "scout", lastEventId = null, events = [], office = null, detail = null;
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Weergave" });
  const startBtn = ctx.can("tasks.start") ? h("button", { class: "btn btn-gold", type: "button", onclick: () => startChainDialog(ctx, null, refresh) }, "Keten starten") : null;
  const stage = h("div", {}, skeleton(2, "g2"));
  const tlList = h("div", { class: "tl", role: "log", tabindex: "0", "aria-label": "Activiteitentijdlijn" });
  const timeline = h("details", { class: "timeline", open: store.get("hq-tl") !== "dicht" },
    h("summary", {}, h("span", { class: "chev", "aria-hidden": "true" }, "›"), "Activiteitentijdlijn", h("span", { class: "faint", style: { fontWeight: 400, fontSize: ".82rem" } }, "statusovergangen, stappen en overdrachten uit de takenopslag")), tlList);
  timeline.addEventListener("toggle", () => store.set("hq-tl", timeline.open ? "open" : "dicht"));
  const missions = h("div", {});
  const renderSeg = () => seg.replaceChildren(...[["kantoor", "Kantoorweergave"], ["lijst", "Lijstweergave"]].map(([k, v]) =>
    h("button", { type: "button", "aria-pressed": String(view === k), onclick: () => { view = k; store.set("hq-world-view", k); renderSeg(); draw(true); } }, v)));
  renderSeg();
  root.append(h("div", { class: "section-h" }, seg, h("div", { class: "row" }, startBtn)), stage, timeline, missions);

  async function loadDetail() {
    const a = data?.agents.find(x => x.key === selected);
    const t = a?.current || a?.last;
    detail = t ? await api(`tasks/${t.id}`).catch(() => null) : null;
  }

  function agentPanel(a) {
    const conn = a.connection;
    const t = detail?.task;
    const lvlNext = [100, 250, 500, 1000][a.xp.level - 1] || 1000;
    const myEvents = events.filter(e => e.to_agent === a.key || e.from_agent === a.key).slice(0, 8);
    return h("div", { class: "card stack", "aria-live": "polite" },
      h("div", { class: "agent-h" }, h("div", { class: "av", style: { background: AGENT_COLOR[a.key] } }, a.name[0]),
        h("div", {}, h("h2", {}, a.name), h("p", { class: "muted", style: { fontSize: ".84rem" } }, `${a.title} · zone ${a.zone}`)), h("span", { class: "spacer" }), badge(TASK, a.status)),
      h("p", { style: { fontSize: ".88rem" } }, a.mission),
      !conn.connected ? h("div", { class: "notlinked" }, h("strong", {}, "Niet gekoppeld"), h("p", {}, conn.note), conn.missing?.length ? h("p", {}, `Ontbreekt: ${conn.missing.join(", ")}`) : null)
        : conn.partial ? h("p", { class: "callout" }, conn.note, conn.missing?.length ? ` Ontbreekt: ${conn.missing.join(", ")}.` : "") : h("p", { class: "callout info" }, conn.note),
      a.tools.length ? h("div", {}, h("h3", {}, "Toegestane tools"), h("ul", { style: { margin: "6px 0 0", paddingLeft: "18px", fontSize: ".85rem", color: "#C9D0DA" } }, a.tools.map(x => h("li", {}, x)))) : null,
      h("dl", { class: "kv" },
        h("dt", {}, "In wachtrij/actief"), h("dd", {}, fmt.n(a.queue)),
        h("dt", {}, "Gemeten kosten (30 d)"), h("dd", {}, `${fmt.usd(a.cost30d.usd)} over ${a.cost30d.n} taken`),
        h("dt", {}, "Ervaring"), h("dd", {}, `${a.xp.xp} XP · niveau ${a.xp.level}`, h("div", { class: "xpbar", style: { marginTop: "6px" }, title: "Alleen voor goedgekeurde resultaten" }, h("i", { style: { width: `${Math.min(100, a.xp.xp / lvlNext * 100)}%` } })))),
      t ? h("div", { class: "stack" },
        h("div", { class: "row" }, h("h3", {}, a.current ? "Huidige opdracht" : "Laatste opdracht"), badge(TASK, t.status, t.control ? (t.control === "pauze_gevraagd" ? "Pauze gevraagd" : "Annulering gevraagd") : null)),
        h("p", {}, t.title), h("p", { class: "faint", style: { fontSize: ".8rem" } }, `Poging ${t.attempts}/${t.max_attempts} · gestart ${fmt.dt(t.started_at || t.created_at)} · kosten ${fmt.usd(t.cost_usd)}`),
        t.error ? h("div", { class: "err" }, h("strong", {}, "Fout"), h("p", {}, t.error)) : null,
        taskControls(t, ctx, refresh),
        t.result ? h("details", {}, h("summary", { style: { cursor: "pointer" } }, "Resultaten en bronnen"), resultView(t.result)) : null)
        : h("p", { class: "muted" }, conn.connected ? "Nog geen opdrachten uitgevoerd." : ""),
      h("div", {}, h("h3", {}, "Recente acties"), myEvents.length ? h("ul", { style: { margin: "6px 0 0", paddingLeft: "18px", fontSize: ".84rem" } }, myEvents.map(e => h("li", {}, h("span", { class: "faint" }, fmt.time(e.at), " "), e.message))) : h("p", { class: "faint", style: { fontSize: ".84rem" } }, "Geen recente acties.")));
  }

  function listView() {
    return h("div", { class: "tbl-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Agent", "Status", "Opdracht", "Wachtrij", "XP", "Kosten 30 d", ""].map(t => h("th", { scope: "col" }, t)))),
      h("tbody", {}, data.agents.map(a => h("tr", {},
        h("td", {}, h("strong", {}, a.name), h("div", { class: "faint", style: { fontSize: ".78rem" } }, a.title)),
        h("td", {}, badge(TASK, a.status)),
        h("td", {}, a.current ? a.current.title : a.last ? h("span", { class: "muted" }, `Laatst: ${a.last.title}`) : h("span", { class: "faint" }, a.connection.connected ? "—" : a.connection.note)),
        h("td", { class: "num" }, fmt.n(a.queue)), h("td", { class: "num" }, a.xp.xp), h("td", { class: "num" }, fmt.usd(a.cost30d.usd)),
        h("td", {}, h("button", { class: "btn btn-sm", type: "button", onclick: async () => { selected = a.key; store.set("hq-world-agent", a.key); await loadDetail(); draw(true); document.getElementById("agent-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }); } }, "Details")))))));
  }

  function draw(full = false) {
    if (!data) return;
    const a = data.agents.find(x => x.key === selected) || data.agents[0];
    const panel = h("aside", { class: "ctx", id: "agent-panel", "aria-label": "Contextpaneel" }, agentPanel(a));
    if (view === "kantoor") {
      const svgWrap = h("div", { class: "office" });
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svgWrap.append(svg);
      office = renderOffice(svg, {
        title: "Agentkantoor. Kies een agent voor details.",
        agents: data.agents.map(x => ({ key: x.key, name: x.name, status: x.status, label: x.statusLabel, queue: x.queue })),
        onSelect: async (k) => { selected = k; store.set("hq-world-agent", k); office.select(k); await loadDetail(); panel.replaceChildren(agentPanel(data.agents.find(y => y.key === k))); },
      });
      office.select(a.key);
      stage.replaceChildren(h("div", { class: "world" }, h("div", { class: "card office-card" }, svgWrap), panel));
    } else {
      office = null;
      stage.replaceChildren(h("div", { class: "stack" }, listView(), panel));
    }
    missions.replaceChildren(h("div", { class: "card" }, h("div", { class: "card-h" }, h("h2", {}, "Missies en mijlpalen"), h("p", { class: "muted" }, "Punten alleen voor afgeronde én goedgekeurde resultaten. Niet voor aantallen berichten, tokens of activiteit.")),
      h("div", { class: "missions" }, data.missions.map(m => h("div", { class: `mission ${m.done ? "done" : ""}` },
        h("div", { class: "row" }, h("strong", {}, m.title), h("span", { class: "spacer" }), m.done ? badge({ x: { cls: "b-ok" } }, "x", "Behaald") : h("span", { class: "num faint" }, `${Math.min(m.value, m.goal)}/${m.goal}`)),
        h("p", { class: "faint", style: { fontSize: ".8rem" } }, m.detail),
        h("div", { class: "xpbar" }, h("i", { style: { width: `${Math.min(100, m.value / m.goal * 100)}%` } })))))));
  }

  function drawTimeline() {
    if (!events.length) { tlList.replaceChildren(h("p", { class: "faint", style: { padding: "12px 16px" } }, "Nog geen activiteit. Start een keten om de eerste taak te zien.")); return; }
    tlList.replaceChildren(...events.slice(0, 80).map(e => h("div", { class: `tl-item ${e.type}` },
      h("span", { class: "num faint" }, fmt.time(e.at)),
      h("span", { class: "tl-agent" }, e.type === "overdracht" ? `${e.from_agent} → ${e.to_agent}` : e.to_agent || ""),
      h("span", {}, e.message, e.title ? h("span", { class: "faint" }, ` · ${e.title}`) : null))));
  }

  async function refresh() {
    try {
      const [w, tl] = await Promise.all([api("world"), api(`timeline?limit=80${lastEventId ? `&after=${lastEventId}` : ""}`)]);
      const fresh = tl.events;
      const firstLoad = lastEventId == null;
      if (fresh.length) { events = [...fresh, ...events].slice(0, 200); lastEventId = Math.max(...events.map(e => Number(e.id))); }
      const changed = JSON.stringify(w.agents.map(a => [a.key, a.status, a.queue, a.current?.id, a.current?.status, a.current?.control, a.xp.xp])) !== JSON.stringify(data?.agents.map(a => [a.key, a.status, a.queue, a.current?.id, a.current?.status, a.current?.control, a.xp.xp]));
      data = w;
      if (changed || firstLoad) { await loadDetail(); draw(); }
      drawTimeline();
      // Overdracht alleen tonen voor nieuwe, opgeslagen overdracht-events.
      if (!firstLoad && office) for (const e of fresh.filter(x => x.type === "overdracht").reverse()) office.handoff(e.from_agent, e.to_agent);
      ctx.setFresh(`Status opgehaald om ${fmt.time(w.serverTime)} · ververst elke 5 s`);
    } catch (e) {
      stage.replaceChildren(errorBox(e, refresh));
    }
  }
  await refresh();
  return { refresh, poll: 5_000 };
}
