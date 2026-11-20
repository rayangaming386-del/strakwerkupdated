
/* Menu-items met een eigen pagina (/werk, /prijzen ...): op de homepage scrollen ze naar de sectie.
   Zo ziet Google echte links naar de overzichtspagina's. */
document.querySelectorAll("a[data-sec]").forEach(a => a.addEventListener("click", e => {
  const sec = document.getElementById(a.dataset.sec);
  if (!sec || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
  e.preventDefault();
  if (a.closest(".mnav")) setTimeout(() => goTo(sec), 80); else goTo(sec);
}));
/* Gewone ankers (#kiezer, #prijzen, #case-vagpro ...) */
document.addEventListener("click", e => {
  const a = e.target.closest?.('a[href^="#"]'); if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  const id = a.getAttribute("href").slice(1), t = id && document.getElementById(id); if (!t) return;
  e.preventDefault();
  if (t.classList.contains("pj")) goProject(t); else goTo(t, id === "offerte" ? 90 : 8);
});

/* Pakket of optie kiezen vanaf een andere plek op de pagina */
function goPrices(){ goTo(document.getElementById("prijzen")); }
document.querySelectorAll("[data-base]").forEach(b => b.addEventListener("click", () => { setBase(b.dataset.base); selTouched = true; clearPresets(); render(); }));
document.querySelectorAll("[data-pick-base]").forEach(b => b.addEventListener("click", () => { setBase(b.dataset.pickBase); selTouched = true; clearPresets(); render(); goPrices(); }));
document.querySelectorAll("[data-pick-opt]").forEach(b => b.addEventListener("click", () => {
  const id = b.dataset.pickOpt, it = items.find(i => i.id === id);
  if (!blocked(id)){ state[id] = Math.max(1, state[id]); if (it.excl) state[it.excl] = 0; } enforce(); selTouched = true;
  showGroup(CONFIG.groups.findIndex(g => g.items.includes(it)), false);
  clearPresets(); render(); goPrices();
}));
optRoot.addEventListener("change", () => { selTouched = true; });
optRoot.addEventListener("click", e => { if (e.target.closest("[data-inc],[data-dec]")) selTouched = true; });

/* Prijzen in vaste teksten komen ook uit CONFIG */
document.querySelectorAll("[data-opt-price]").forEach(el => { const it = itemOf(el.dataset.optPrice); if (it) el.textContent = "+" + euro(it.price); });
document.querySelectorAll("[data-base-price]").forEach(el => { const b = CONFIG.bases[el.dataset.basePrice]; if (b) el.textContent = euro(b.price); });
