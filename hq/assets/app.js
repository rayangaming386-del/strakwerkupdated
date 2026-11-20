import { h, icon, toast } from "./ui.js";
import { me, logout, api } from "./api.js";

const ROUTES = [
  { path: "/hq", key: "overzicht", title: "Overzicht", load: () => import("./views/overview.js") },
  { path: "/hq/bezoekers", key: "bezoekers", title: "Bezoekers", load: () => import("./views/visitors.js") },
  { path: "/hq/agentwereld", key: "agentwereld", title: "Agentwereld", load: () => import("./views/world.js") },
  { path: "/hq/taken", key: "taken", title: "Taken", load: () => import("./views/tasks.js") },
  { path: "/hq/leads", key: "leads", title: "Leads & klanten", load: () => import("./views/leads.js") },
  { path: "/hq/goedkeuringen", key: "goedkeuringen", title: "Goedkeuringen", load: () => import("./views/approvals.js") },
  { path: "/hq/instellingen", key: "instellingen", title: "Instellingen", load: () => import("./views/settings.js") },
];

const main = document.getElementById("main");
const shell = document.getElementById("shell");
let current = null, timer = null, session = null;

const ctx = {
  get me() { return session; },
  can: (perm) => Boolean(session?.permissions?.includes(perm)),
  setFresh(text) { document.getElementById("fresh").textContent = text || ""; },
  navigate,
};

function buildNav() {
  const nav = document.getElementById("nav");
  nav.replaceChildren(...ROUTES.map(r => h("a", { href: r.path, "data-nav": "", "data-key": r.key }, icon(r.key), h("span", {}, r.title), r.key === "goedkeuringen" ? h("span", { class: "count", id: "appr-count", hidden: true }) : null)));
}

function setMenu(open) {
  shell.classList.toggle("open", open);
  document.getElementById("menu-btn").setAttribute("aria-expanded", String(open));
  document.getElementById("scrim").hidden = !open;
}

async function navigate(path, { replace = false } = {}) {
  const [p, qs] = path.split("?");
  const r = ROUTES.find(x => x.path === (p.replace(/\/+$/, "") || "/hq")) || ROUTES[0];
  const target = r.path + (qs ? `?${qs}` : "");
  if (location.pathname + location.search !== target) history[replace ? "replaceState" : "pushState"](null, "", target);
  document.querySelectorAll("#nav a").forEach(a => { if (a.dataset.key === r.key) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  document.getElementById("page-title").textContent = r.title;
  document.title = `${r.title} | StrakWerk HQ`;
  ctx.setFresh("");
  setMenu(false);
  if (current?.unmount) current.unmount();
  clearInterval(timer); current = null;
  main.replaceChildren(h("div", { class: "loading-page" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Laden…"));
  try {
    const mod = await r.load();
    const box = h("div", { class: "stack", style: { gap: "22px" } });
    main.replaceChildren(box);
    current = (await mod.mount(box, ctx)) || {};
    if (current.poll && current.refresh) {
      timer = setInterval(() => { if (document.visibilityState === "visible") current.refresh(); }, current.poll);
    }
    main.focus({ preventScroll: true });
  } catch (e) {
    main.replaceChildren(h("div", { class: "err", role: "alert" }, h("strong", {}, "Pagina kon niet worden geladen"), h("p", {}, String(e.message || e))));
  }
}

async function pollApprovals() {
  try {
    const r = await api("approvals?status=open");
    const n = r.approvals.length, el = document.getElementById("appr-count");
    if (el) { el.hidden = !n; el.textContent = String(n); }
  } catch {}
}

async function boot() {
  session = await me();
  if (!session) { location.replace(`/login?next=${encodeURIComponent(location.pathname)}`); return; }
  buildNav();
  document.getElementById("user").replaceChildren(
    h("div", { class: "who" }, h("span", {}, session.email), h("span", {}, session.roleLabel + (session.aal === "aal2" ? " · MFA" : ""))),
    h("button", { class: "btn btn-sm", type: "button", onclick: logout }, "Uitloggen"));
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-nav]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault(); navigate(a.getAttribute("href"));
  });
  window.addEventListener("popstate", () => navigate(location.pathname, { replace: true }));
  document.getElementById("menu-btn").addEventListener("click", () => setMenu(!shell.classList.contains("open")));
  document.getElementById("scrim").addEventListener("click", () => setMenu(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && shell.classList.contains("open")) setMenu(false); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && current?.refresh) current.refresh(); });
  // Sessie verloopt na maximaal een uur; ververs ruim op tijd zolang HQ open staat.
  setInterval(() => fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin", headers: { "x-hq-request": "1" } }).then(r => { if (r.status === 401) toast("Je sessie is verlopen. Log opnieuw in.", "bad"); }), 45 * 60 * 1000);
  pollApprovals(); setInterval(pollApprovals, 30_000);
  window.addEventListener("hq:approvals", pollApprovals);
  navigate(location.pathname + location.search, { replace: true });
}

boot();
