/* Projectpagina's: paginawissel, lightbox, en (met beweging aan) vloeiend scrollen en reveals */
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Meten (anoniem, zonder cookies of persoonsgegevens). Let op: een event is een klik die WhatsApp of e-mail opent,
  // geen ontvangen aanvraag. Of het bericht echt verstuurd is, zie je alleen in WhatsApp of je mailbox.
  const page = location.pathname.replace(/\.html$/, "") || "/";
  const track = (name, data) => { try { window.va && window.va("event", { name, data }); } catch (x) {} };
  document.addEventListener("click", e => {
    const l = e.target.closest("a[href]"); if (!l) return;
    const href = l.getAttribute("href");
    if (l.id === "f-send") track("Formulier naar WhatsApp", { soort: document.getElementById("f-type")?.value || "", plek: page });
    else if (l.id === "f-mail") track("Formulier naar e-mail", { soort: document.getElementById("f-type")?.value || "", plek: page });
    else if (/wa\.me\//.test(l.href)) track("WhatsApp", { plek: page });
    else if (/^tel:/.test(href)) track("Bellen", { plek: page });
    else if (/^mailto:/.test(href)) track("E-mail", { plek: page });
    else if (/#prijzen$/.test(href)) track("Naar calculator", { plek: page });
  }, { capture: true });

  // Uitklapmenu op kleine schermen: sluiten bij een klik ernaast of met Escape
  const sm = document.querySelector(".smenu");
  if (sm){
    document.addEventListener("click", e => { if (sm.open && !sm.contains(e.target)) sm.open = false; });
    addEventListener("keydown", e => { if (e.key === "Escape" && sm.open){ sm.open = false; sm.querySelector("summary").focus(); } });
  }

  // Contactformulier: bouwt een kant-en-klaar bericht voor WhatsApp of e-mail (er wordt niets opgeslagen)
  const lead = document.getElementById("lead"), fsend = document.getElementById("f-send"), fmail = document.getElementById("f-mail");
  if (lead && fsend){
    const v = id => (document.getElementById(id)?.value || "").trim();
    const text = () => `Hoi StrakWerk!\n\nNaam: ${v("f-naam") || "-"}\nBedrijf: ${v("f-bedrijf") || "-"}\nIk zoek: ${v("f-type")}\n\n${v("f-msg")}`;
    const sync = () => {
      fsend.href = "https://wa.me/31623462397?text=" + encodeURIComponent(text());
      if (fmail){ const b = v("f-bedrijf"); fmail.href = "mailto:strakwerkk@gmail.com?subject=" + encodeURIComponent("Websiteaanvraag" + (b ? " van " + b : "")) + "&body=" + encodeURIComponent(text()); }
    };
    lead.addEventListener("input", sync); lead.addEventListener("change", sync); sync();
    lead.addEventListener("submit", e => { e.preventDefault(); fsend.click(); });
  }

  // Aftelling in de actiebalk (de balk zelf verdwijnt na de einddatum)
  const strip = document.querySelector(".promo-strip"), cd = strip && strip.querySelector("[data-cd]");
  if (cd){
    const end = Date.parse(strip.dataset.until), p2 = n => String(n).padStart(2, "0");
    const tick = () => { const ms = end - Date.now(); if (ms <= 0){ strip.remove(); clearInterval(t); return; }
      cd.textContent = `${Math.floor(ms / 864e5)}d ${p2(Math.floor(ms / 36e5) % 24)}u ${p2(Math.floor(ms / 6e4) % 60)}m ${p2(Math.floor(ms / 1e3) % 60)}s`; };
    const t = setInterval(tick, 1000); tick();
  }

  // Paginawissel op het grote scherm
  const imgs = [...document.querySelectorAll(".screen > img")], btns = [...document.querySelectorAll(".tabs button")];
  let cur = 0, auto;
  const show = i => { cur = i; imgs.forEach((im, j) => im.classList.toggle("on", j === i)); btns.forEach((b, j) => b.setAttribute("aria-pressed", String(i === j))); };
  btns.forEach((b, i) => b.addEventListener("click", () => { clearInterval(auto); show(i); }));
  if (imgs.length > 1 && !reduce) auto = setInterval(() => show((cur + 1) % imgs.length), 4200);

  // Lightbox
  const lb = document.getElementById("lb");
  if (lb){
    const lbImg = lb.querySelector("img");
    document.querySelectorAll(".gal figure").forEach(f => f.addEventListener("click", () => {
      const im = f.querySelector("img"); lbImg.src = im.src; lbImg.alt = im.alt; lb.hidden = false; window.__lenis?.stop();
    }));
    const close = () => { lb.hidden = true; window.__lenis?.start(); };
    lb.addEventListener("click", close);
    addEventListener("keydown", e => { if (e.key === "Escape" && !lb.hidden) close(); });
  }

  if (!window.gsap || reduce) return;
  gsap.registerPlugin(ScrollTrigger, ...[window.SplitText].filter(Boolean));
  gsap.config({ nullTargetWarn: false });

  if (window.Lenis){
    const lenis = new Lenis({ lerp: .1 }); window.__lenis = lenis;
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000)); gsap.ticker.lagSmoothing(0);
  }

  const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
  if (window.SplitText){
    SplitText.create(".c-hero h1", { type: "words,chars", mask: "chars", autoSplit: true,
      onSplit: self => gsap.from(self.chars, { yPercent: 110, duration: 1.1, stagger: .035, ease: "power4.out" }) });
  }
  tl.from(".c-hero .crumbs, .c-hero .kicker, .c-kind, .c-lead, .d-price, .c-cta", { y: 30, opacity: 0, duration: 1, stagger: .08 }, .2)
    .from(".c-stage .win, .d-shot", { y: 120, rotateX: 18, scale: .92, opacity: 0, transformPerspective: 1400, duration: 1.6, ease: "expo.out" }, .35)
    .from(".tabs", { y: 20, opacity: 0, duration: .8 }, .9);

  if (document.querySelector(".c-stage .win")) gsap.to(".c-stage .win", { scale: 1.04, ease: "none", scrollTrigger: { trigger: ".c-stage", start: "top top", end: "bottom top", scrub: true } });

  if (window.SplitText){
    // Koppen pas splitsen als ze in de buurt van het scherm komen
    const io = new IntersectionObserver(es => es.forEach(en => { if (!en.isIntersecting) return; io.unobserve(en.target); const h = en.target;
      SplitText.create(h, { type: "lines", mask: "lines", linesClass: "split-line", autoSplit: true,
        onSplit: self => { if (h.dataset.shown) return; return gsap.from(self.lines, { yPercent: 110, duration: 1.1, stagger: .09, ease: "power4.out", onComplete: () => h.dataset.shown = 1, scrollTrigger: { trigger: h, start: "top 86%", once: true } }); } }); }), { rootMargin: "700px 0px" });
    document.querySelectorAll(".c-head h2, .c-box h2").forEach(h => io.observe(h));
  }
  gsap.utils.toArray(".c-head p, .c-head .kicker").forEach(el => gsap.from(el, { y: 30, opacity: 0, duration: 1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%" } }));
  gsap.utils.toArray(".feat").forEach(g => gsap.from(g.children, { y: 70, opacity: 0, duration: 1, stagger: .07, ease: "power4.out", scrollTrigger: { trigger: g, start: "top 84%" } }));
  gsap.utils.toArray(".gal figure").forEach((f, i) => {
    gsap.from(f, { clipPath: "inset(18% 10% 18% 10% round 16px)", opacity: 0, duration: 1.3, ease: "power4.out", scrollTrigger: { trigger: f, start: "top 90%" } });
    gsap.fromTo(f.querySelector("img"), { yPercent: -4, scale: 1.08 }, { yPercent: 4, scale: 1.08, ease: "none", scrollTrigger: { trigger: f, start: "top bottom", end: "bottom top", scrub: true } });
  });
  if (document.querySelector(".c-box")) gsap.from(".c-box", { y: 80, scale: .95, opacity: 0, duration: 1.2, ease: "power4.out", scrollTrigger: { trigger: ".c-box", start: "top 88%" } });
  if (document.querySelector(".next .arrow")) gsap.from(".next .arrow", { scale: 0, rotate: -90, duration: 1, ease: "back.out(1.7)", scrollTrigger: { trigger: ".next", start: "top 90%" } });
  addEventListener("load", () => ScrollTrigger.refresh());
})();
