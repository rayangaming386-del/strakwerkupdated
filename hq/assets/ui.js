// Kleine UI-bouwstenen. Alle tekst gaat via textContent: geen HTML-injectie vanuit data.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  // Scrollbare tabellen moeten met het toetsenbord te bereiken zijn.
  if (/\btbl-wrap\b/.test(attrs?.class || "") && !el.hasAttribute("tabindex")) { el.tabIndex = 0; el.setAttribute("role", "region"); el.setAttribute("aria-label", attrs["aria-label"] || "Tabel"); }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const nf = new Intl.NumberFormat("nl-NL");
const eurf = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const usdf = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const dtf = new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Amsterdam" });
const tf = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Amsterdam" });
const df = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", timeZone: "Europe/Amsterdam" });
const hf = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });

export const fmt = {
  n: (v) => v == null ? "—" : nf.format(v),
  eur: (cents) => cents == null ? "—" : eurf.format(cents / 100),
  usd: (v) => v == null ? "—" : usdf.format(v),
  dt: (v) => v ? dtf.format(new Date(v)) : "—",
  time: (v) => v ? tf.format(new Date(v)) : "—",
  day: (v) => v ? df.format(new Date(v)) : "—",
  hour: (v) => v ? hf.format(new Date(v)) : "—",
  ago(v) {
    if (!v) return "nooit";
    const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
    if (s < 0) return "zojuist";
    if (s < 60) return `${s} s geleden`;
    if (s < 3600) return `${Math.round(s / 60)} min geleden`;
    if (s < 86400) return `${Math.round(s / 3600)} uur geleden`;
    return `${Math.round(s / 86400)} dagen geleden`;
  },
};

export const STATE = {
  ok: { label: "Gemeten", cls: "b-ok" },
  geen_gegevens: { label: "Geen gegevens beschikbaar", cls: "b-warn" },
  niet_gekoppeld: { label: "Niet gekoppeld", cls: "b-off" },
  fout: { label: "Verbinding mislukt", cls: "b-bad" },
  gekoppeld: { label: "Gekoppeld", cls: "b-ok" },
  beperkt: { label: "Beperkt", cls: "b-warn" },
};
export const TASK = {
  niet_gekoppeld: { label: "Niet gekoppeld", cls: "b-off" }, beschikbaar: { label: "Beschikbaar", cls: "b-ok" },
  in_wachtrij: { label: "In wachtrij", cls: "b-info" }, bezig: { label: "Bezig", cls: "b-gold" },
  wacht_op_goedkeuring: { label: "Wacht op goedkeuring", cls: "b-warn" }, afgerond: { label: "Afgerond", cls: "b-ok" },
  gepauzeerd: { label: "Gepauzeerd", cls: "" }, mislukt: { label: "Mislukt", cls: "b-bad" }, geannuleerd: { label: "Geannuleerd", cls: "b-off" },
};
export const badge = (map, key, extra) => h("span", { class: `badge ${map[key]?.cls || ""}` }, extra || map[key]?.label || key);

/** Kengetal met expliciete toestand: gemeten waarde, 0, niet gekoppeld, fout of geen gegevens. */
export function metric(label, m, { format = fmt.n, hint, note } = {}) {
  const st = m?.state || "niet_gekoppeld";
  const has = st === "ok" && m.value != null;
  return h("div", { class: "card metric" },
    h("div", { class: "lbl" }, h("span", {}, label), has ? null : badge(STATE, st)),
    has ? h("div", { class: "val" }, format(m.value)) : h("div", { class: "val na" }, STATE[st]?.label || "Geen gegevens beschikbaar"),
    hint ? h("p", { class: "sub" }, hint) : null,
    h("p", { class: "sub" }, note || (m?.source ? `Bron: ${m.source === "eigen" ? "eigen meting" : m.source}${m.measuredAt ? ` · laatste meting ${fmt.ago(m.measuredAt)}` : ""}` : "")),
  );
}

export function skeleton(n = 4, cls = "g4") {
  return h("div", { class: `grid ${cls}`, "aria-busy": "true", "aria-label": "Laden" }, Array.from({ length: n }, () => h("div", { class: "skel" })));
}
export const empty = (title, text) => h("div", { class: "empty" }, h("strong", {}, title), text ? h("p", {}, text) : null);
export function errorBox(err, retry) {
  return h("div", { class: "err", role: "alert" },
    h("strong", {}, err?.status === 403 ? "Geen toegang" : "Dit onderdeel kon niet worden geladen"),
    h("p", {}, err?.message || "Onbekende fout."),
    err?.missing?.length ? h("p", {}, "Ontbreekt op de server: ", err.missing.map((m, i) => [i ? ", " : "", h("code", {}, m)])) : null,
    retry ? h("div", {}, h("button", { class: "btn btn-sm", type: "button", onclick: retry }, "Opnieuw proberen")) : null);
}
export function notLinked(title, missing, text) {
  return h("div", { class: "notlinked" }, h("div", { class: "row" }, badge(STATE, "niet_gekoppeld"), h("strong", {}, title)),
    text ? h("p", {}, text) : null,
    missing?.length ? h("p", {}, "Ontbreekt: ", missing.map((m, i) => [i ? ", " : "", h("code", {}, m)])) : null);
}

export function toast(msg, kind = "") {
  const t = h("div", { class: `toast ${kind}`, role: kind === "bad" ? "alert" : "status" }, msg);
  document.getElementById("toasts").append(t);
  setTimeout(() => t.remove(), kind === "bad" ? 8000 : 4500);
}

/** Eenvoudige dialoog. body: Node; actions: [{label, cls, onClick(close) }] */
export function modal(title, body, actions = []) {
  const dlg = h("dialog", { "aria-labelledby": "dlg-t" });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(h("div", { class: "dlg" },
    h("div", { class: "dlg-h" }, h("h2", { id: "dlg-t" }, title), h("button", { class: "icon-btn", type: "button", "aria-label": "Sluiten", onclick: close }, "✕")),
    h("div", { class: "dlg-b" }, body),
    actions.length ? h("div", { class: "dlg-f" }, actions.map(a => h("button", { class: `btn ${a.cls || ""}`, type: "button", onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await a.onClick(close); } finally { if (dlg.open) b.disabled = false; }
    } }, a.label))) : null));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return { close, dlg };
}

export function field(label, input, { full, help } = {}) {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return h("div", { class: `field ${full ? "full" : ""}` }, h("label", { for: id }, label), input, help ? h("p", { class: "faint", style: { fontSize: ".78rem" } }, help) : null);
}

export const ICON = {
  overzicht: "M3 3h6v6H3zM11 3h6v4h-6zM11 9h6v8h-6zM3 11h6v6H3z",
  bezoekers: "M3 16V9M8 16V4M13 16v-6M18 16V7",
  agentwereld: "M10 2l7 4v8l-7 4-7-4V6zM10 2v8m0 0l7-4m-7 4L3 6m7 4v8",
  studio: "M3 5h10v10H3zM13 8l4-2.5v9L13 12",
  taken: "M4 5h12M4 10h12M4 15h8",
  leads: "M7 9a3 3 0 100-6 3 3 0 000 6zM2 17c0-3 2.5-5 5-5s5 2 5 5M14 8a2.5 2.5 0 100-5M15 12c2 .4 3 2.2 3 5",
  goedkeuringen: "M4 10l4 4 8-9",
  instellingen: "M10 13a3 3 0 100-6 3 3 0 000 6zM10 1v3M10 16v3M1 10h3M16 10h3M3.6 3.6l2.1 2.1M14.3 14.3l2.1 2.1M3.6 16.4l2.1-2.1M14.3 5.7l2.1-2.1",
};
export function icon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("width", "18"); s.setAttribute("height", "18"); s.setAttribute("viewBox", "0 0 20 20"); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", ICON[name] || ""); p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "1.6"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
  s.append(p);
  return s;
}

export function bars(rows, { key = "key", value = "visitors", label = (r) => r[key], fmtv = fmt.n } = {}) {
  if (!rows?.length) return empty("Geen gegevens in deze periode");
  const max = Math.max(...rows.map(r => r[value] || 0), 1);
  return h("div", { class: "list-rows" }, rows.map(r => h("div", {},
    h("span", { style: { overflowWrap: "anywhere" } }, label(r)), h("span", { class: "num muted" }, fmtv(r[value])),
    h("div", { class: "bar", "aria-hidden": "true" }, h("i", { style: { width: `${Math.round((r[value] || 0) / max * 100)}%` } })))));
}
