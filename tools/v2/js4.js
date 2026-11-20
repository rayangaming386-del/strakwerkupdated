
/* Beweging (GSAP). Alles hieronder is extra: zonder GSAP of met "minder beweging" staat de inhoud er gewoon. */
if (hasGsap){
  document.documentElement.classList.add("gs");
  gsap.registerPlugin(ScrollTrigger, ...[window.SplitText, window.DrawSVGPlugin].filter(Boolean));
  ScrollTrigger.config({ ignoreMobileResize: true });
  const whenVisible = (el, on, off) => { if (!el) return; new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? on() : off()), { rootMargin: "120px" }).observe(el); };
  const mm = gsap.matchMedia();

  /* Portfolio op desktop: het ene vastgezette scrollmoment. Projecten schuiven over elkaar heen terwijl je scrolt.
     Krijgt voorrang bij het herberekenen, zodat alles eronder de extra scrollruimte meetelt. */
  mm.add("(min-width: 901px) and (min-height: 620px) and (prefers-reduced-motion: no-preference)", () => {
    const sec = document.getElementById("werk"), st = document.getElementById("showStage"), n = pjEls.length;
    const nav = st.querySelector(".show-nav"), navBtns = [...nav.querySelectorAll("button")];
    const media = pjEls.map(p => p.querySelector(".pj-media")), info = pjEls.map(p => p.querySelector(".pj-info")), screen = pjEls.map(p => p.querySelector(".pj-screen"));
    sec.classList.add("is-pin");
    const OPEN = "inset(-30% -12% -30% -12%)", SHUT = "inset(130% -12% -30% -12%)";
    const setNav = () => st.style.setProperty("--navh", nav.offsetHeight + "px"); setNav();
    let cur = -1;
    const setCur = i => { if (i === cur) return; cur = i; pjEls.forEach((p, j) => p.classList.toggle("cur", j === i)); navBtns.forEach((b, j) => b.setAttribute("aria-current", String(j === i))); };
    gsap.set(media.slice(1), { clipPath: SHUT });
    gsap.set(info.slice(1), { autoAlpha: 0, y: 46 });
    const tl = gsap.timeline({ defaults: { ease: "none" },
      scrollTrigger: { trigger: st, start: "top top", end: () => "+=" + Math.round(innerHeight * (n - 1) * 1.1), pin: true, scrub: .6, anticipatePin: 1, refreshPriority: 1, invalidateOnRefresh: true,
        onRefresh: setNav, onUpdate: self => setCur(Math.max(0, Math.min(n - 1, Math.floor(self.progress * tl.duration() + .45)))) } });
    for (let i = 1; i < n; i++){
      const t0 = i - 1;
      tl.to(info[i - 1], { autoAlpha: 0, y: -46, duration: .3, ease: "power1.in" }, t0 + .1)
        .to(screen[i - 1], { scale: .93, duration: 1 }, t0)
        .fromTo(media[i], { clipPath: SHUT }, { clipPath: OPEN, duration: .82, ease: "power2.inOut" }, t0 + .08)
        .fromTo(screen[i], { scale: 1.08 }, { scale: 1, duration: .82, ease: "power2.out" }, t0 + .08)
        .to(info[i], { autoAlpha: 1, y: 0, duration: .34, ease: "power1.out" }, t0 + .56);
    }
    tl.to({}, { duration: .14 });
    gsap.fromTo(".show-ghost", { xPercent: 3 }, { xPercent: -46, ease: "none", scrollTrigger: { trigger: sec, start: "top bottom", end: "bottom top", scrub: true } });
    pinST = tl.scrollTrigger; pinTl = tl; setCur(0);
    return () => { pinST = null; pinTl = null; sec.classList.remove("is-pin"); gsap.set([...media, ...info, ...screen, ".show-ghost"], { clearProps: "all" }); pjEls.forEach((p, j) => p.classList.toggle("cur", j === 0)); };
  });

  /* Woorden van het statement los zetten voor het oplichten tijdens scrollen */
  (function split(el){
    [...el.childNodes].forEach(n => {
      if (n.nodeType === 3){
        const f = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(t => {
          if (!t) return;
          if (/^\s+$/.test(t)) f.appendChild(document.createTextNode(t));
          else { const w = document.createElement("span"); w.className = "w"; w.textContent = t; f.appendChild(w); }
        });
        n.replaceWith(f);
      } else if (n.nodeType === 1) split(n);
    });
  })(document.getElementById("statement-text"));

  mm.add("(prefers-reduced-motion: no-preference)", ctx => {
    /* Koppen glijden per regel omhoog; pas splitsen als ze in de buurt van het scherm komen */
    let headIO;
    if (window.SplitText){
      const splitHead = h => SplitText.create(h, { type: "lines", mask: "lines", linesClass: "split-line", autoSplit: true,
        onSplit: self => { if (h.dataset.shown) return; return gsap.from(self.lines, { yPercent: 112, duration: 1.05, stagger: .09, ease: "power4.out", onComplete: () => h.dataset.shown = 1, scrollTrigger: { trigger: h, start: "top 88%", once: true } }); } });
      headIO = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; headIO.unobserve(e.target); ctx.add(() => splitHead(e.target)); }), { rootMargin: "700px 0px" });
      document.querySelectorAll(".sec-head .h2, .sp-side .h2, .rd-main .h2, .about-txt .h2, .ct-left .h2, .foot-big").forEach(h => headIO.observe(h));
    }

    /* Dienstenband: loopt sneller en trekt scheef bij hard scrollen */
    const mq = gsap.to(".mq-track", { xPercent: -50, duration: 46, ease: "none", repeat: -1 });
    whenVisible(document.querySelector(".band"), () => mq.resume(), () => mq.pause());
    const ts = { v: 1 }, skew = gsap.quickTo(".mq-track", "skewX", { duration: .6, ease: "power3" });
    let still;
    ScrollTrigger.create({ trigger: ".band", start: "top bottom", end: "bottom top", onUpdate: self => {
      const v = self.getVelocity();
      gsap.to(ts, { v: 1 + Math.min(Math.abs(v) / 260, 7), duration: .25, overwrite: true, onUpdate: () => mq.timeScale(ts.v),
        onComplete: () => gsap.to(ts, { v: 1, duration: 1.4, ease: "power2.out", onUpdate: () => mq.timeScale(ts.v) }) });
      skew(gsap.utils.clamp(-6, 6, -v / 420)); clearTimeout(still); still = setTimeout(() => skew(0), 140);
    } });

    /* Hero: diepte bij wegscrollen */
    const heroST = { trigger: ".hero", start: "top top", end: "bottom top", scrub: true };
    gsap.to(".dv-phone", { yPercent: -14, ease: "none", scrollTrigger: heroST });
    gsap.to(".dv-back", { yPercent: 12, ease: "none", scrollTrigger: heroST });
    gsap.to(".hero-light", { yPercent: 18, ease: "none", scrollTrigger: heroST });

    /* Statement: woorden lichten op */
    gsap.from("#statement-text .w", { color: "#6F6C66", stagger: .1, ease: "none", scrollTrigger: { trigger: "#statement", start: "top 80%", end: "bottom 58%", scrub: .5 } });

    /* Onthullingen: kleine groepen schuiven in zodra ze in beeld komen */
    const rise = (sel, trigger, opt = {}) => { const els = gsap.utils.toArray(sel); if (!els.length) return;
      gsap.from(els, { y: opt.y ?? 44, opacity: 0, duration: opt.d ?? .9, stagger: opt.s ?? .08, ease: "power3.out", scrollTrigger: { trigger: trigger || els[0], start: opt.start || "top 86%", once: true } }); };
    gsap.utils.toArray(".sec-head").forEach(h => rise(h.querySelectorAll(window.SplitText ? ".kicker, .lead, .sec-link" : ":scope > *"), h, { y: 30 }));
    rise(".kz-types button", ".kz-types", { s: .07 });
    rise(".kz-need", "#kzNeeds", { y: 18, s: .03, d: .6 });
    rise(".kz-br .pbtn, .kz-brmore", ".kz-br", { y: 18, s: .03, d: .6 });
    rise(".kz-sum", ".kz-grid", { y: 60 });
    rise(".fx .tile", ".fx", { y: 70, s: .07, d: 1 });
    rise(".sp-side > :not(.h2)", ".sp-side", { y: 28, s: .06 });
    rise(".how li", ".how", { y: 24 });
    rise(".base-switch.pk button", ".base-switch.pk", { y: 30, s: .06 });
    rise(".quote", ".cfg", { y: 60 });
    rise(".rd-main > :not(.h2)", ".rd-main", { y: 28, s: .07 });
    rise(".speedcheck", ".speedcheck", { y: 60 });
    rise(".compare .cmp", ".compare", { y: 60, s: .1 });
    rise(".steps .stp", ".steps", { y: 60, s: .09 });
    rise(".about-txt > :not(.h2)", ".about-txt", { y: 28, s: .06 });
    rise(".kbt", ".kb-teaser", { y: 36, s: .09 });
    rise(".faq-list details", ".faq-list", { y: 24, s: .05, d: .7 });
    rise(".ct-left > :not(.h2)", ".ct-left", { y: 28, s: .06 });
    rise(".form", ".form", { y: 60 });
    rise(".foot-cta .btn", ".foot-cta", { y: 24 });

    /* Beelden: van onder naar boven onthuld, met lichte diepte tijdens het scrollen */
    gsap.utils.toArray("[data-rvimg]").forEach(el => gsap.from(el, { clipPath: "inset(100% 0% 0% 0%)", duration: 1.3, ease: "power4.inOut", scrollTrigger: { trigger: el, start: "top 86%", once: true } }));
    gsap.utils.toArray("[data-plx]").forEach(el => gsap.fromTo(el, { yPercent: -10 }, { yPercent: 0, ease: "none", scrollTrigger: { trigger: el.parentElement, start: "top bottom", end: "bottom top", scrub: true } }));
    gsap.from(".sp-frame", { y: 70, opacity: 0, duration: 1.1, ease: "power3.out", scrollTrigger: { trigger: ".sp-frame", start: "top 88%", once: true } });
    gsap.fromTo(".giant div", { xPercent: 3 }, { xPercent: -16, ease: "none", scrollTrigger: { trigger: ".giant", start: "top bottom", end: "bottom top", scrub: true } });

    /* Beheerpaneel: menu scrollt mee door het frame */
    const bh = document.getElementById("bhImg");
    if (bh) gsap.to(bh, { y: () => -Math.max(0, bh.offsetHeight - bh.parentElement.offsetHeight), ease: "none", scrollTrigger: { trigger: bh.parentElement, start: "top 85%", end: "bottom 15%", scrub: .6, invalidateOnRefresh: true } });

    /* Kenteken typt zichzelf in */
    const pdOut = document.getElementById("pd-out"), plate = "GH-512-K";
    pd.value = ""; gsap.set(pdOut.children, { opacity: 0, y: 10 });
    const ptl = gsap.timeline({ paused: true });
    [...plate].forEach((_, i) => ptl.call(() => { if (document.activeElement !== pd) pd.value = plate.slice(0, i + 1); }, null, .25 + i * .11));
    ptl.to(pdOut.children, { opacity: 1, y: 0, duration: .5, stagger: .12, ease: "back.out(2)" }, "+=.2");
    ScrollTrigger.create({ trigger: ".t-a", start: "top 75%", once: true, onEnter: () => ptl.play() });
    pd.addEventListener("focus", () => { ptl.progress(1); }, { once: true });

    /* WhatsApp: eerst "typt...", dan het bericht */
    const typ = document.querySelector(".typing"), bub = document.querySelector(".bubble");
    gsap.set(bub, { autoAlpha: 0 });
    gsap.timeline({ scrollTrigger: { trigger: ".t-e", start: "top 80%", once: true } })
      .set(typ, { display: "flex" }).from(typ, { scale: .5, opacity: 0, transformOrigin: "100% 100%", duration: .35, ease: "back.out(2)" })
      .set(typ, { display: "none" }, "+=1.4")
      .fromTo(bub, { autoAlpha: 0, scale: .6, transformOrigin: "100% 100%" }, { autoAlpha: 1, scale: 1, duration: .8, ease: "back.out(2)" });

    /* Kentekenherkenning: scan loopt zolang hij in beeld is */
    const scan = document.querySelector(".scan");
    if (scan){
      const stl = gsap.timeline({ repeat: -1, repeatDelay: 1.2, paused: true, onRepeat: () => scan.classList.remove("done") })
        .set(".scan-out", { opacity: 0, y: 12 }).set(".beam", { top: "16%", opacity: 0 })
        .from(".scan .crn", { scale: 1.3, opacity: 0, duration: .5, stagger: .05, ease: "back.out(2)" })
        .to(".beam", { opacity: 1, duration: .2 }, "-=.1")
        .to(".beam", { top: "60%", duration: .8, ease: "sine.inOut", yoyo: true, repeat: 1 })
        .to(".beam", { opacity: 0, duration: .2 })
        .to(".shutter", { opacity: .55, duration: .06 }).to(".shutter", { opacity: 0, duration: .35 })
        .call(() => scan.classList.add("done"))
        .to(".scan-out", { opacity: 1, y: 0, duration: .6, ease: "back.out(2)" }, "+=.1")
        .to({}, { duration: 2.4 });
      whenVisible(scan, () => stl.play(), () => stl.pause());
    }

    /* Snelheidsring */
    const r = { v: 0 };
    gsap.to(r, { v: 98, duration: 1.8, ease: "power2.out", onUpdate: () => setRing(r.v), scrollTrigger: { trigger: "#ring", start: "top 90%", once: true } });

    /* Werkwijze: iconen tekenen zichzelf */
    if (window.DrawSVGPlugin) gsap.from(".stp .big svg > *", { drawSVG: 0, duration: 1.5, stagger: .06, ease: "power2.inOut", scrollTrigger: { trigger: ".steps", start: "top 82%", once: true } });

    return () => { headIO?.disconnect(); };
  });
  if (reduce) setRing(98);

  /* Knoppen trekken licht naar de muis (alleen desktop met muis) */
  mm.add("(min-width: 1000px) and (pointer: fine) and (prefers-reduced-motion: no-preference)", () => {
    const offs = [];
    document.querySelectorAll("[data-magnet]").forEach(b => {
      const x = gsap.quickTo(b, "x", { duration: .5, ease: "power3" }), y = gsap.quickTo(b, "y", { duration: .5, ease: "power3" });
      const mv = e => { const r = b.getBoundingClientRect(); x((e.clientX - r.left - r.width / 2) * .22); y((e.clientY - r.top - r.height / 2) * .3); }, out = () => { x(0); y(0); };
      b.addEventListener("pointermove", mv); b.addEventListener("pointerleave", out);
      offs.push(() => { b.removeEventListener("pointermove", mv); b.removeEventListener("pointerleave", out); gsap.set(b, { clearProps: "x,y" }); });
    });
    return () => offs.forEach(f => f());
  });

  /* Actief menu-item (na de vastgezette sectie, zodat die ruimte meetelt) */
  document.querySelectorAll(".nav a[data-sec]").forEach(a => {
    const sec = document.getElementById(a.dataset.sec); if (!sec) return;
    ScrollTrigger.create({ trigger: sec, start: "top 45%", end: "bottom 45%", refreshPriority: -1, onToggle: self => setActiveNav(a, self.isActive) });
  });

  addEventListener("load", () => ScrollTrigger.refresh());
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
} else if ("IntersectionObserver" in window){
  /* Zonder GSAP: actief menu-item via een eenvoudige waarnemer */
  document.querySelectorAll(".nav a[data-sec]").forEach(a => { const sec = document.getElementById(a.dataset.sec); if (!sec) return;
    new IntersectionObserver(([e]) => setActiveNav(a, e.isIntersecting), { rootMargin: "-45% 0px -54% 0px" }).observe(sec); });
}
