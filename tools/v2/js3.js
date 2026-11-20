
/* Mobiel menu */
const mnav = document.getElementById("mnav"), menuBtn = document.getElementById("menuBtn");
function openMenu(){
  mnav.hidden = false; menuBtn.setAttribute("aria-expanded", "true"); document.body.style.overflow = "hidden";
  if (hasGsap && !reduce){
    gsap.fromTo(mnav, { clipPath: "inset(0% 0% 100% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: .6, ease: "power3.inOut", overwrite: true });
    gsap.fromTo(".mnav-links > a", { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, stagger: .05, duration: .6, ease: "power4.out", delay: .18, overwrite: true });
    gsap.fromTo(".mnav-more, .mnav-foot > *", { y: 16, opacity: 0 }, { y: 0, opacity: 1, stagger: .06, duration: .5, delay: .38, overwrite: true });
  }
  document.getElementById("menuClose").focus({ preventScroll: true });
}
function closeMenu(){
  if (mnav.hidden) return;
  menuBtn.setAttribute("aria-expanded", "false"); document.body.style.overflow = "";
  if (hasGsap && !reduce) gsap.to(mnav, { clipPath: "inset(0% 0% 100% 0%)", duration: .45, ease: "power3.in", overwrite: true, onComplete: () => { mnav.hidden = true; } });
  else mnav.hidden = true;
}
menuBtn.addEventListener("click", openMenu);
document.getElementById("menuClose").addEventListener("click", () => { closeMenu(); menuBtn.focus({ preventScroll: true }); });
mnav.querySelectorAll(".mnav-links a").forEach(a => a.addEventListener("click", closeMenu));
addEventListener("keydown", e => { if (e.key === "Escape" && !mnav.hidden){ closeMenu(); menuBtn.focus({ preventScroll: true }); } });

{{OLD}}

/* Dienstenkiezer: zelfde keuze als de calculator, in gewone taal */
const kzNeeds = document.getElementById("kzNeeds"), kzTypes = [...document.querySelectorAll("[data-kz-type]")];
KIEZER.needs.forEach(n => {
  const b = document.createElement("button"); b.type = "button"; b.className = "kz-need"; b.dataset.kzNeed = n.id; b.setAttribute("aria-pressed", "false");
  b.innerHTML = `<i aria-hidden="true"></i><span>${n.label}</span><small></small>`; kzNeeds.appendChild(b);
});
const fromPrice = { site: CONFIG.bases.nieuw.price, shop: CONFIG.bases.nieuw.price + itemOf("webshop").price, redesign: CONFIG.bases.redesign.price };
document.querySelectorAll("[data-kz-from]").forEach(el => el.textContent = "vanaf " + euro(fromPrice[el.dataset.kzFrom]));
const kzType = () => baseKey === "redesign" ? "redesign" : state.webshop ? "shop" : "site";
function syncKiezer(){
  const t = kzType(), inc = inclNow();
  kzTypes.forEach(b => b.setAttribute("aria-checked", String(b.dataset.kzType === t)));
  kzNeeds.querySelectorAll("[data-kz-need]").forEach(b => {
    const id = b.dataset.kzNeed, it = itemOf(id), lock = !!inc[id] || blocked(id);
    b.setAttribute("aria-pressed", String(!!state[id] || blocked(id))); b.classList.toggle("lock", lock);
    b.querySelector("small").textContent = inc[id] ? (isPromo(id) ? "gratis (actie)" : "inbegrepen") : blocked(id) ? "zit in je pakket" : it.monthly ? `${euro(it.price)} p/m` : `+${euro(it.price)}`;
  });
  document.getElementById("kzLines").innerHTML = lines().map((x, i) =>
    `<li class="${i === 0 ? "base-line" : ""}${x.t ? " is-incl" : ""}"><span>${x.n}</span><span>${x.t || euro(x.p) + (x.m ? " p/m" : "")}</span></li>`).join("");
  const { once, mo } = totals();
  document.getElementById("kzTotal").textContent = euro(once);
  document.getElementById("kzMo").textContent = mo ? `eenmalig + ${euro(mo)} p/m` : "eenmalig";
  document.getElementById("kzWa").href = document.getElementById("qwa").href;
  const tip = document.getElementById("qtip"), kt = document.getElementById("kzTip");
  kt.hidden = tip.hidden; kt.innerHTML = tip.innerHTML;
}
kzTypes.forEach(b => b.addEventListener("click", () => {
  const t = b.dataset.kzType;
  if (t === "redesign") setBase("redesign");
  else { if (baseKey === "redesign") setBase("nieuw"); state.webshop = t === "shop" ? 1 : 0; enforce(); }
  selTouched = true; clearPresets(); render(); track("Dienstenkiezer", { keuze: t });
}));
kzNeeds.addEventListener("click", e => {
  const b = e.target.closest("[data-kz-need]"); if (!b) return;
  const id = b.dataset.kzNeed, it = itemOf(id);
  if (inclNow()[id] || blocked(id)) return;
  state[id] = state[id] ? 0 : 1; if (it.excl && state[id]) state[it.excl] = 0; enforce();
  selTouched = true; clearPresets(); render(); if (state[id]) track("Optie aan", { optie: id, plek: "kiezer" });
});
document.getElementById("kzTip").addEventListener("click", e => { const b = e.target.closest("[data-tip]"); if (!b) return;
  setBase(b.dataset.tip); selTouched = true; clearPresets(); render(); track("Tip gevolgd", { pakket: CONFIG.bases[baseKey].name }); });
document.getElementById("kzReset").addEventListener("click", () => { selTouched = false; applyPreset("reset", false); });
document.querySelectorAll(".kz-br [data-preset]").forEach(b => b.addEventListener("click", () => { selTouched = true; track("Dienstenkiezer", { branche: b.dataset.preset }); }));
afterHooks.push(syncKiezer); syncKiezer();

/* Stijlpreview: vier richtingen in één afgebakend voorbeeld */
const spFrame = document.getElementById("spFrame"), spBtns = [...document.querySelectorAll(".sp-opts [data-style]")];
let spCur = "strak";
spBtns.forEach(b => b.addEventListener("click", () => {
  spCur = b.dataset.style; spBtns.forEach(x => x.setAttribute("aria-checked", String(x === b)));
  spFrame.dataset.style = spCur; spFrame.classList.remove("swap"); void spFrame.offsetWidth; spFrame.classList.add("swap");
  if (stijl && stijl !== spCur) document.getElementById("spOk").textContent = "";
  track("Stijlpreview", { stijl: STYLES[spCur] });
}));
document.querySelector(".sp-opts").addEventListener("keydown", e => {
  const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0; if (!d) return;
  e.preventDefault(); const i = (spBtns.findIndex(b => b.dataset.style === spCur) + d + spBtns.length) % spBtns.length; spBtns[i].focus(); spBtns[i].click();
});
document.getElementById("spUse").addEventListener("click", () => {
  stijl = spCur; document.getElementById("spOk").textContent = `Genoteerd: ${STYLES[stijl]}. Je vindt hem terug in je offerte en in het formulier.`;
  render(); track("Stijl gekozen", { stijl: STYLES[stijl] });
});

/* Contactformulier: bericht voor WhatsApp of e-mail, met de selectie uit de kiezer of calculator erbij */
const lead = document.getElementById("lead"), fsend = document.getElementById("f-send"), fmail = document.getElementById("f-mail");
const fSel = document.getElementById("fSel"), fSelOn = document.getElementById("f-sel-on"), fType = document.getElementById("f-type");
const hasCfg = () => selTouched || encodeCfg() !== "nieuw";
function selText(){
  const { once, mo } = totals(), out = [];
  if (hasCfg()) out.push("Mijn selectie:", ...lines().map(x => `• ${x.n}: ${x.t || euro(x.p) + (x.m ? " p/m" : "")}`), `Indicatie: ${euro(once)} eenmalig${mo ? ` + ${euro(mo)} per maand` : ""}`, `Online: ${cfgLink()}`);
  if (stijl) out.push(`Stijlvoorkeur: ${STYLES[stijl]}`);
  return out.join("\n");
}
function leadText(){
  const v = id => document.getElementById(id).value.trim();
  const sel = (hasCfg() || stijl) && fSelOn.checked ? `\n\n${selText()}` : "";
  return `Hoi StrakWerk!\n\nNaam: ${v("f-naam") || "-"}\nBedrijf: ${v("f-bedrijf") || "-"}\nIk zoek: ${v("f-type")}${sel}\n\n${v("f-msg")}`;
}
const syncLead = () => {
  const on = hasCfg() || !!stijl; fSel.hidden = !on;
  if (on){ const { once, mo } = totals();
    document.getElementById("fSelTxt").textContent = [hasCfg() ? lines().map(x => x.n).join(" · ") + ` · indicatie ${euro(once)} eenmalig${mo ? ` + ${euro(mo)} p/m` : ""}` : "", stijl ? `Stijl: ${STYLES[stijl]}` : ""].filter(Boolean).join(" · "); }
  fsend.href = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(leadText())}`;
  const bedrijf = document.getElementById("f-bedrijf").value.trim();
  fmail.href = `mailto:strakwerkk@gmail.com?subject=${encodeURIComponent("Websiteaanvraag" + (bedrijf ? " van " + bedrijf : ""))}&body=${encodeURIComponent(leadText())}`;
};
lead.addEventListener("input", syncLead); lead.addEventListener("change", syncLead);
lead.addEventListener("submit", e => { e.preventDefault(); fsend.click(); });
afterHooks.push(syncLead); syncLead();
/* Vanuit de kiezer naar het formulier: selectie staat klaar, soort aanvraag alvast gekozen */
document.getElementById("kzForm").addEventListener("click", e => {
  e.preventDefault(); e.stopPropagation(); selTouched = true; fSelOn.checked = true;
  fType.selectedIndex = { site: 0, shop: 1, redesign: 2 }[kzType()]; syncLead();
  goTo(lead, 90); fSel.classList.remove("flash"); void fSel.offsetWidth; fSel.classList.add("flash");
  setTimeout(() => document.getElementById("f-naam").focus({ preventScroll: true }), reduce ? 0 : 700);
  track("Dienstenkiezer", { naar: "formulier" });
});

/* Header, WhatsApp-knop en mobiele contactbalk */
const fab = document.getElementById("waFab"), header = document.getElementById("top"), mbar = document.getElementById("mbar");
let inPrices = false, quoteVisible = false, pastHero = false, atEnd = false, lastY = scrollY;
const syncBar = () => { mbar.classList.toggle("show", pastHero && !atEnd && !(inPrices && quoteVisible)); mbar.classList.toggle("is-prices", inPrices); };
const onScroll = () => {
  const y = scrollY;
  header.classList.toggle("scrolled", y > 10);
  if (Math.abs(y - lastY) > 6){ if (mnav.hidden) header.classList.toggle("hide", y > lastY && y > 500); lastY = y; }
  fab.classList.toggle("show", y > innerHeight * .8);
  const p = y > innerHeight * .7; if (p !== pastHero){ pastHero = p; syncBar(); }
};
addEventListener("scroll", onScroll, { passive: true }); onScroll();
header.addEventListener("focusin", () => header.classList.remove("hide"));
new IntersectionObserver(([e]) => { inPrices = e.isIntersecting; syncBar(); }, { rootMargin: "-30% 0px -30% 0px" }).observe(document.getElementById("prijzen"));
new IntersectionObserver(([e]) => { quoteVisible = e.isIntersecting; syncBar(); }, { threshold: .2 }).observe(document.getElementById("offerte"));
const endEls = new Set();
const endIO = new IntersectionObserver(es => { es.forEach(e => e.isIntersecting ? endEls.add(e.target) : endEls.delete(e.target)); atEnd = endEls.size > 0; syncBar(); });
endIO.observe(document.getElementById("contact")); endIO.observe(document.querySelector("footer"));
(() => { const tip = document.getElementById("fabTip"); let shown = false;
  const go = () => { if (shown || innerWidth <= 900 || !fab.classList.contains("show") || document.getElementById("prijzen").getBoundingClientRect().bottom > 0) return; shown = true;
    tip.classList.add("on"); setTimeout(() => tip.classList.remove("on"), 6000); removeEventListener("scroll", go); };
  addEventListener("scroll", go, { passive: true }); })();

/* Snelheidsring */
const ring = document.getElementById("ring"), ringv = document.getElementById("ringv");
const setRing = v => { ring.style.setProperty("--p", v); ringv.textContent = Math.round(v); };
if (!hasGsap || reduce) setRing(98);

/* Licht volgt de muis op de tegels */
document.querySelectorAll(".tile").forEach(t => t.addEventListener("pointermove", e => {
  const r = t.getBoundingClientRect();
  t.style.setProperty("--mx", (e.clientX - r.left) + "px"); t.style.setProperty("--my", (e.clientY - r.top) + "px");
}));

/* Hero: echte projecten op scherm, telefoon en tweede scherm. Wisselt vanzelf en via de knoppen. */
const stage = document.getElementById("stage");
const stageDev = { main: document.getElementById("dvMain"), phone: document.getElementById("dvPhone"), back: document.getElementById("dvBack") };
const stageTabs = [...document.querySelectorAll(".stage-tabs [data-set]")];
let stageCur = 0, stageTimer = 0, stageBusy = false;
function stageShow(i){
  if (i === stageCur || stageBusy) return; stageBusy = true;
  const set = STAGE_SETS[i], jobs = Object.entries(stageDev).map(([k, dev]) => { const im = dev.querySelector(`img[data-pj="${set[k]}"]`); return ensureImg(im).then(() => [dev, im, k]); });
  Promise.all(jobs).then(list => {
    list.forEach(([dev, im, k]) => {
      const old = dev.querySelector("img.on");
      if (old && old !== im){ old.classList.remove("on"); old.classList.add("was"); setTimeout(() => old.classList.remove("was"), 1000); }
      im.classList.add("on"); dev.href = PROJECTS[set[k]].href; dev.setAttribute("aria-label", `Project ${PROJECTS[set[k]].name} bekijken`);
    });
    document.getElementById("tagMain").textContent = PROJECTS[set.main].name;
    const cm = document.getElementById("capMain"), cp = document.getElementById("capPhone");
    cm.textContent = PROJECTS[set.main].name; cm.href = PROJECTS[set.main].href; cp.textContent = PROJECTS[set.phone].name; cp.href = PROJECTS[set.phone].href;
    stageCur = i; stageTabs.forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
    setTimeout(() => { stageBusy = false; }, 600);
  });
}
const stageAuto = on => {
  clearTimeout(stageTimer); stage.classList.toggle("auto", on);
  if (on) stageTimer = setTimeout(() => { stageShow((stageCur + 1) % STAGE_SETS.length); stage.classList.remove("auto"); void stage.offsetWidth; stageAuto(true); }, 6500);
};
stageTabs.forEach((b, i) => b.addEventListener("click", () => { stageAuto(false); stageShow(i); track("Hero-project", { project: b.textContent.trim() }); }));
if (!reduce){
  let seen = false, hover = false;
  const upd = () => stageAuto(seen && !hover && !document.hidden);
  new IntersectionObserver(([e]) => { seen = e.isIntersecting; upd(); }, { threshold: .35 }).observe(stage);
  stage.addEventListener("pointerenter", () => { hover = true; upd(); }); stage.addEventListener("pointerleave", () => { hover = false; upd(); });
  document.addEventListener("visibilitychange", upd);
  /* De andere projecten alvast ophalen zodra de pagina klaar is, zodat wisselen direct gaat */
  addEventListener("load", () => setTimeout(() => stage.querySelectorAll("img[data-src]").forEach(ensureImg), 1800), { once: true });
}
/* Kanteling met de muis (alleen desktop met muis) */
if (matchMedia("(min-width: 1000px) and (pointer: fine)").matches && !reduce){
  const hero = document.getElementById("hero"), tilt = document.getElementById("stageTilt"), main = stageDev.main;
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
  const loop = () => { cx += (tx - cx) * .07; cy += (ty - cy) * .07; tilt.style.transform = `rotateX(${(2 - cy * 7).toFixed(3)}deg) rotateY(${(-6 + cx * 10).toFixed(3)}deg)`;
    raf = Math.abs(tx - cx) + Math.abs(ty - cy) > .002 ? requestAnimationFrame(loop) : 0; };
  hero.addEventListener("pointermove", e => { const b = hero.getBoundingClientRect(); tx = (e.clientX - b.left) / b.width - .5; ty = (e.clientY - b.top) / b.height - .5;
    const m = main.getBoundingClientRect(); main.style.setProperty("--gx", ((e.clientX - m.left) / m.width * 100).toFixed(1) + "%"); main.style.setProperty("--gy", ((e.clientY - m.top) / m.height * 100).toFixed(1) + "%");
    if (!raf) raf = requestAnimationFrame(loop); }, { passive: true });
  hero.addEventListener("pointerleave", () => { tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(loop); });
}

/* Portfolio: pagina's per project wisselen, swipekaarten op mobiel, springen naar een project */
const showTrack = document.getElementById("showTrack"), pjEls = [...showTrack.querySelectorAll(".pj")];
let pinST = null, pinTl = null;
pjEls.forEach(pj => {
  const imgs = [...pj.querySelectorAll(".pj-screen img")], btns = [...pj.querySelectorAll(".pj-tabs button")];
  let cur = 0;
  const show = i => { cur = i; btns.forEach((b, j) => b.setAttribute("aria-pressed", String(i === j))); ensureImg(imgs[i]).then(() => { if (cur === i) imgs.forEach((x, j) => x.classList.toggle("on", j === i)); }); };
  btns.forEach((b, i) => b.addEventListener("click", () => { pj.dataset.manual = "1"; show(i); }));
  pj._next = () => { if (!pj.dataset.manual && btns.length > 1) show((cur + 1) % btns.length); };
});
if (!reduce) setInterval(() => {
  if (document.hidden || innerWidth <= 900) return;
  const p = showTrack.querySelector(".pj.cur"); if (!p || p.matches(":hover")) return;
  const r = p.getBoundingClientRect(); if (r.bottom < 80 || r.top > innerHeight - 80) return;
  p._next();
}, 4600);
function goProject(pj){
  const i = pjEls.indexOf(pj); if (i < 0) return;
  if (pinST && pinTl){ window.scrollTo({ top: Math.round(pinST.start + (pinST.end - pinST.start) * Math.min(1, i / (pjEls.length - 1 + .14))) + 2, behavior: reduce ? "auto" : "smooth" }); return; }
  if (showTrack.scrollWidth > showTrack.clientWidth + 10){ goTo(document.getElementById("showStage"), 76); showTrack.scrollTo({ left: pj.offsetLeft - parseFloat(getComputedStyle(showTrack).paddingLeft), behavior: reduce ? "auto" : "smooth" }); return; }
  goTo(pj, 96);
}
document.querySelectorAll(".show-nav [data-go]").forEach(b => b.addEventListener("click", () => goProject(pjEls[+b.dataset.go])));
(() => { const dots = [...document.querySelectorAll("#showDots button")], hint = document.getElementById("showHint"); let t = 0;
  const upd = () => { t = 0; const pad = parseFloat(getComputedStyle(showTrack).paddingLeft) || 0;
    let best = 0, d = 1e9; pjEls.forEach((p, i) => { const x = Math.abs(p.offsetLeft - pad - showTrack.scrollLeft); if (x < d){ d = x; best = i; } });
    dots.forEach((b, i) => b.setAttribute("aria-current", String(i === best))); if (showTrack.scrollLeft > 24) hint.classList.add("off"); };
  showTrack.addEventListener("scroll", () => { if (!t) t = requestAnimationFrame(upd); }, { passive: true });
  dots.forEach((b, i) => b.addEventListener("click", () => goProject(pjEls[i]))); })();

/* Cursorlabel op projectbeelden (alleen met muis) */
if (matchMedia("(hover: hover) and (pointer: fine)").matches){
  const cur = document.getElementById("cursor"); let x = 0, y = 0, tx = 0, ty = 0, raf = 0, on = false;
  const loop = () => { x += (tx - x) * .22; y += (ty - y) * .22; cur.style.transform = `translate(${(x + 16).toFixed(1)}px, ${(y + 18).toFixed(1)}px)`; raf = Math.abs(tx - x) + Math.abs(ty - y) > .3 ? requestAnimationFrame(loop) : 0; };
  document.addEventListener("pointermove", e => { tx = e.clientX; ty = e.clientY; const t = e.target.closest?.("[data-cursor]");
    if (t){ if (!on){ x = tx; y = ty; on = true; } if (cur.textContent !== t.dataset.cursor) cur.textContent = t.dataset.cursor; cur.classList.add("on"); }
    else if (on){ cur.classList.remove("on"); on = false; }
    if (on && !raf) raf = requestAnimationFrame(loop); }, { passive: true });
  document.addEventListener("pointerleave", () => { cur.classList.remove("on"); on = false; });
  addEventListener("scroll", () => { if (on){ cur.classList.remove("on"); on = false; } }, { passive: true });
}

/* Menu: kader glijdt naar het item onder de muis en rust op het actieve onderdeel */
const navEl = document.querySelector(".nav"), navInd = navEl.querySelector(".nav-ind");
let navHover = false;
const moveInd = a => { if (!a){ navInd.style.opacity = 0; return; } navInd.style.opacity = 1; navInd.style.width = a.offsetWidth + "px"; navInd.style.transform = `translateX(${a.offsetLeft}px)`; };
navEl.addEventListener("pointerover", e => { const a = e.target.closest("a"); if (a){ navHover = true; moveInd(a); } });
navEl.addEventListener("pointerleave", () => { navHover = false; moveInd(navEl.querySelector("a.active")); });
navEl.addEventListener("focusin", e => { const a = e.target.closest("a"); if (a) moveInd(a); });
const setActiveNav = (a, on) => { a.classList.toggle("active", on); if (!navHover) moveInd(navEl.querySelector("a.active")); };
