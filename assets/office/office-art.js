// Isometrisch kantoor van StrakWerk HQ, getekend als SVG. Dit bestand bevat alleen tekenwerk
// en geen gegevens: HQ geeft de echte statussen mee, de loginpagina een vaste illustratie.
const NS = "http://www.w3.org/2000/svg";
const COS = Math.cos(Math.PI / 6), SIN = Math.sin(Math.PI / 6);
const S = 34; // tegelgrootte
const OX = 470, OY = 70;

export const ZONES = {
  acquisitie:   { label: "Acquisitie",   x: 0, y: 0, w: 5, h: 4, tint: "#5B8DEF" },
  analyse:      { label: "Analyse",      x: 6, y: 0, w: 5, h: 4, tint: "#3FB6A8" },
  sales:        { label: "Sales",        x: 0, y: 5, w: 5, h: 4, tint: "#CFAE69" },
  content:      { label: "Content",      x: 6, y: 5, w: 5, h: 4, tint: "#C98A5E" },
  ontwikkeling: { label: "Ontwikkeling", x: 3, y: 10, w: 5, h: 3, tint: "#8B7FE0" },
};
// Vaste werkplekken (rasterpositie) per agent.
export const DESKS = {
  scout:    { zone: "acquisitie", x: 1.6, y: 1.6 },
  auditor:  { zone: "analyse", x: 7.2, y: 1.4 },
  insights: { zone: "analyse", x: 9.4, y: 2.6 },
  sales:    { zone: "sales", x: 1.4, y: 6.4 },
  care:     { zone: "sales", x: 3.6, y: 7.6 },
  rank:     { zone: "content", x: 7.2, y: 6.4 },
  content:  { zone: "content", x: 9.4, y: 7.6 },
  builder:  { zone: "ontwikkeling", x: 5.2, y: 11.2 },
};
export const AGENT_COLOR = { scout: "#5B8DEF", auditor: "#3FB6A8", insights: "#56C2D6", sales: "#CFAE69", care: "#E3B873", rank: "#C98A5E", content: "#D9A07A", builder: "#8B7FE0" };

export const iso = (x, y, z = 0) => [OX + (x - y) * COS * S, OY + (x + y) * SIN * S - z];
const pts = (arr) => arr.map(p => p.join(",")).join(" ");

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function box(g, x, y, w, d, hgt, { top, left, right, z = 0, cls }) {
  const a = iso(x, y, z + hgt), b = iso(x + w, y, z + hgt), c = iso(x + w, y + d, z + hgt), e = iso(x, y + d, z + hgt);
  const b0 = iso(x + w, y, z), c0 = iso(x + w, y + d, z), e0 = iso(x, y + d, z);
  const grp = el("g", { class: cls }, g);
  el("polygon", { points: pts([e, c, c0, e0]), fill: left }, grp);
  el("polygon", { points: pts([b, c, c0, b0]), fill: right }, grp);
  el("polygon", { points: pts([a, b, c, e]), fill: top }, grp);
  return grp;
}

function floor(g) {
  const all = [iso(-0.5, -0.5), iso(11.5, -0.5), iso(11.5, 13.5), iso(-0.5, 13.5)];
  el("polygon", { points: pts(all), fill: "#10151D", stroke: "rgba(255,255,255,.06)" }, g);
  for (let i = 0; i <= 12; i++) {
    el("line", { x1: iso(-0.5 + i, -0.5)[0], y1: iso(-0.5 + i, -0.5)[1], x2: iso(-0.5 + i, 13.5)[0], y2: iso(-0.5 + i, 13.5)[1], stroke: "rgba(255,255,255,.025)" }, g);
  }
  for (let j = 0; j <= 14; j++) {
    el("line", { x1: iso(-0.5, -0.5 + j)[0], y1: iso(-0.5, -0.5 + j)[1], x2: iso(11.5, -0.5 + j)[0], y2: iso(11.5, -0.5 + j)[1], stroke: "rgba(255,255,255,.025)" }, g);
  }
  // Achterwanden
  const wl = [iso(-0.5, -0.5), iso(-0.5, 13.5), iso(-0.5, 13.5, 46), iso(-0.5, -0.5, 46)];
  const wr = [iso(-0.5, -0.5), iso(11.5, -0.5), iso(11.5, -0.5, 46), iso(-0.5, -0.5, 46)];
  el("polygon", { points: pts(wl), fill: "#141A24" }, g);
  el("polygon", { points: pts(wr), fill: "#171E29" }, g);
  // Ramen in de rechterwand
  for (let i = 0; i < 4; i++) {
    const x0 = 0.6 + i * 2.8;
    el("polygon", { points: pts([iso(x0, -0.5, 14), iso(x0 + 1.8, -0.5, 14), iso(x0 + 1.8, -0.5, 38), iso(x0, -0.5, 38)]), fill: "rgba(120,160,220,.09)", stroke: "rgba(255,255,255,.05)" }, g);
  }
}

function zone(g, key, z) {
  const p = [iso(z.x, z.y), iso(z.x + z.w, z.y), iso(z.x + z.w, z.y + z.h), iso(z.x, z.y + z.h)];
  el("polygon", { points: pts(p), fill: z.tint, "fill-opacity": ".07", stroke: z.tint, "stroke-opacity": ".35", "stroke-width": "1", class: "zone" }, g);
  // Label plat op de vloer, langs de voorrand van de zone.
  const [lx, ly] = iso(z.x + 0.3, z.y + z.h - 0.25);
  const t = el("text", { x: 0, y: 0, class: "zone-label", fill: z.tint, transform: `matrix(${COS} ${SIN} ${-COS} ${SIN} ${lx} ${ly})` }, g);
  t.textContent = z.label.toUpperCase();
  // Plant in de hoek, voor de sfeer (geen data)
  const [px, py] = iso(z.x + z.w - 0.35, z.y + 0.35);
  el("ellipse", { cx: px, cy: py - 2, rx: 7, ry: 3.5, fill: "#2A2F36" }, g);
  el("circle", { cx: px, cy: py - 14, r: 9, fill: "#2F5D4A" }, g);
  el("circle", { cx: px + 5, cy: py - 19, r: 6, fill: "#3A7059" }, g);
}

function desk(g, key, d, agent) {
  const grp = el("g", { class: `desk st-${agent.status || "beschikbaar"}`, "data-agent": key }, g);
  box(grp, d.x - 0.7, d.y - 0.45, 1.4, 0.9, 16, { top: "#2A323F", left: "#1B212B", right: "#222A36" });
  // Monitor
  const m1 = iso(d.x - 0.35, d.y - 0.35, 18), m2 = iso(d.x + 0.45, d.y - 0.35, 18), m3 = iso(d.x + 0.45, d.y - 0.35, 36), m4 = iso(d.x - 0.35, d.y - 0.35, 36);
  el("polygon", { points: pts([m1, m2, m3, m4]), fill: "#0B0F15", stroke: "#39424F" }, grp);
  el("polygon", { points: pts([iso(d.x - 0.28, d.y - 0.35, 20), iso(d.x + 0.38, d.y - 0.35, 20), iso(d.x + 0.38, d.y - 0.35, 34), iso(d.x - 0.28, d.y - 0.35, 34)]), class: "screen", fill: agent.color, "fill-opacity": ".12" }, grp);
  // Stapel dossiers (= taken in wachtrij, alleen als er echt taken klaarstaan)
  const queued = Math.min(agent.queue || 0, 5);
  for (let i = 0; i < queued; i++) box(grp, d.x + 0.25, d.y + 0.05, 0.35, 0.28, 2, { z: 16 + i * 2.2, top: "#E8EDF3", left: "#B8C0CC", right: "#CDD4DE" });
  // Avatar
  const [ax, ay] = iso(d.x, d.y + 0.85);
  const av = el("g", { class: "avatar", transform: `translate(${ax} ${ay})` }, grp);
  el("ellipse", { cx: 0, cy: 2, rx: 11, ry: 5, fill: "rgba(0,0,0,.35)" }, av);
  const body = el("g", { class: "avatar-body" }, av);
  el("path", { d: "M-10 0 C-10 -16 10 -16 10 0 Z", fill: agent.color, "fill-opacity": agent.status === "niet_gekoppeld" ? ".25" : "1" }, body);
  el("circle", { cx: 0, cy: -21, r: 7.5, fill: "#E9D9C4", "fill-opacity": agent.status === "niet_gekoppeld" ? ".3" : "1" }, body);
  const ini = el("text", { x: 0, y: -4, class: "avatar-ini" }, body);
  ini.textContent = (agent.name || key).slice(0, 1).toUpperCase();
  if (agent.status === "niet_gekoppeld") el("circle", { cx: 0, cy: -10, r: 16, fill: "none", stroke: "rgba(255,255,255,.25)", "stroke-dasharray": "3 3" }, av);
  // Naamkaartje + status
  const tag = el("g", { class: "tag", transform: `translate(${ax} ${ay - 44})` }, grp);
  const label = agent.label || "";
  const wdt = Math.max(64, (agent.name.length + label.length) * 6.1 + 30);
  el("rect", { x: -wdt / 2, y: -12, width: wdt, height: 22, rx: 11, class: "tag-bg" }, tag);
  el("circle", { cx: -wdt / 2 + 11, cy: -1, r: 3.5, class: "tag-dot" }, tag);
  const tt = el("text", { x: -wdt / 2 + 20, y: 3, class: "tag-text" }, tag);
  const b = el("tspan", { "font-weight": "700" }, tt); b.textContent = agent.name;
  if (label) { const s = el("tspan", { dx: 6, class: "tag-sub" }, tt); s.textContent = label; }
  return grp;
}

/**
 * Tekent het kantoor. agents: [{ key, name, status, label, queue }]. onSelect(key) bij klik/Enter.
 * Geeft een object terug waarmee overdrachten kunnen worden getoond.
 */
export function renderOffice(svg, { agents = [], onSelect = null, title = "Kantoor" } = {}) {
  svg.replaceChildren();
  svg.setAttribute("viewBox", "50 0 785 505");
  svg.setAttribute("role", onSelect ? "group" : "img");
  svg.setAttribute("aria-label", title);
  const g = el("g", {}, svg);
  floor(g);
  for (const [k, z] of Object.entries(ZONES)) zone(g, k, z);
  // Planbord van de centrale taakcoördinatie
  box(g, 5.25, 4.2, 0.5, 0.5, 30, { top: "#2A323F", left: "#1B212B", right: "#222A36" });
  const order = Object.keys(DESKS).sort((a, b) => (DESKS[a].x + DESKS[a].y) - (DESKS[b].x + DESKS[b].y));
  const byKey = Object.fromEntries(agents.map(a => [a.key, a]));
  for (const key of order) {
    const a = byKey[key];
    if (!a) continue;
    const d = desk(g, key, DESKS[key], { ...a, color: AGENT_COLOR[key] || "#98A2B0" });
    if (onSelect) {
      d.setAttribute("tabindex", "0");
      d.setAttribute("role", "button");
      d.setAttribute("aria-label", `${a.name}: ${a.label || a.status}`);
      d.addEventListener("click", () => onSelect(key));
      d.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(key); } });
    }
  }
  const fx = el("g", { class: "fx" }, svg);
  return {
    select(key) { svg.querySelectorAll(".desk").forEach(n => n.classList.toggle("selected", n.dataset.agent === key)); },
    // Dossier dat van de ene naar de andere werkplek beweegt. Alleen aanroepen voor een
    // overdracht die echt in de database staat.
    handoff(from, to) {
      const a = DESKS[from], b = DESKS[to];
      if (!a || !b || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const [x1, y1] = iso(a.x, a.y, 24), [x2, y2] = iso(b.x, b.y, 24);
      const doc = el("g", { class: "handoff" }, fx);
      el("rect", { x: -7, y: -9, width: 14, height: 18, rx: 2, fill: "#E8EDF3" }, doc);
      el("rect", { x: -4, y: -4, width: 8, height: 1.6, fill: "#98A2B0" }, doc);
      el("rect", { x: -4, y: 0, width: 8, height: 1.6, fill: "#98A2B0" }, doc);
      const t0 = performance.now(), dur = 1400;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / dur), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        const x = x1 + (x2 - x1) * e, y = y1 + (y2 - y1) * e - Math.sin(Math.PI * e) * 60;
        doc.setAttribute("transform", `translate(${x} ${y})`);
        if (p < 1) requestAnimationFrame(step); else setTimeout(() => doc.remove(), 300);
      };
      requestAnimationFrame(step);
    },
  };
}
