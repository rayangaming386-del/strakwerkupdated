// Gedeelde bouwstenen voor Vandaag, Klanten en Kantoor.
import { h, toast } from "../ui.js";

export const DEPT = { sales: "Sales", acquisitie: "Acquisitie", scout: "Scout", auditor: "Auditor", marketing: "Marketing", project: "Projectbeheer", care: "Nazorg", vertrouwen: "Vertrouwen", seo: "Vindbaarheid", conversie: "Conversie", resultaten: "Resultaten", rayan: "Rayan" };

export function getEnv() { try { return localStorage.getItem("hq-env") === "test" ? "test" : "productie"; } catch { return "productie"; } }
export const envQs = (sep = "?") => (getEnv() === "test" ? `${sep}env=test` : "");
export function envSwitch(onChange) {
  const mk = (v, label) => h("button", { type: "button", "aria-pressed": String(getEnv() === v), onclick: (e) => {
    try { localStorage.setItem("hq-env", v); } catch {}
    e.currentTarget.parentElement.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
    onChange(v);
  } }, label);
  return h("div", { class: "seg", role: "group", "aria-label": "Omgeving" }, mk("productie", "Echt"), mk("test", "Test & demo"));
}

export function copyBtn(text, label = "Kopieer") {
  return h("button", { class: "btn btn-sm", type: "button", onclick: async () => {
    try { await navigator.clipboard.writeText(text); toast("Gekopieerd."); } catch { toast("Kopiëren lukte niet; selecteer de tekst handmatig.", "bad"); }
  } }, label);
}
export const waHref = (phone, text) => `https://wa.me/${String(phone || "").replace(/\D/g, "")}?text=${encodeURIComponent(text || "")}`;
export const mailHref = (to, subject, body) => `mailto:${encodeURIComponent(to || "")}?subject=${encodeURIComponent(subject || "")}&body=${encodeURIComponent(body || "")}`;

/** replaceChildren zonder "null"-tekst voor weggelaten onderdelen. */
export const put = (el, ...c) => el.replaceChildren(...c.flat().filter(x => x != null && x !== false));
