/* Projectpagina's: paginawissel, lightbox, en (met beweging aan) vloeiend scrollen en reveals */
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Paginawissel op het grote scherm
  const imgs = [...document.querySelectorAll(".screen > img")], btns = [...document.querySelectorAll(".tabs button")];
  let cur = 0, auto;
  const show = i => { cur = i; imgs.forEach((im, j) => im.classList.toggle("on", j === i)); btns.forEach((b, j) => b.setAttribute("aria-pressed", String(i === j))); };
  btns.forEach((b, i) => b.addEventListener("click", () => { clearInterval(auto); show(i); }));
  if (imgs.length > 1 && !reduce) auto = setInterval(() => show((cur + 1) % imgs.length), 4200);

  // Lightbox
  const lb = document.getElementById("lb"), lbImg = lb.querySelector("img");
  document.querySelectorAll(".gal figure").forEach(f => f.addEventListener("click", () => {
    const im = f.querySelector("img"); lbImg.src = im.src; lbImg.alt = im.alt; lb.hidden = false; window.__lenis?.stop();
  }));
  const close = () => { lb.hidden = true; window.__lenis?.start(); };
  lb.addEventListener("click", close);
  addEventListener("keydown", e => { if (e.key === "Escape" && !lb.hidden) close(); });

  if (!window.gsap || reduce) return;
  gsap.registerPlugin(ScrollTrigger, ...[window.SplitText].filter(Boolean));

  if (window.Lenis){
    const lenis = new Lenis({ lerp: .1 }); window.__lenis = lenis;
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000)); gsap.ticker.lagSmoothing(0);
  }

  const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
  if (window.SplitText){
    SplitText.create(".c-hero h1", { type: "chars", mask: "chars", autoSplit: true,
      onSplit: self => tl.from(self.chars, { yPercent: 110, duration: 1.1, stagger: .035 }, 0) });
  }
  tl.from(".c-hero .kicker, .c-kind, .c-lead, .c-cta", { y: 30, opacity: 0, duration: 1, stagger: .08 }, .2)
    .from(".c-stage .win", { y: 120, rotateX: 18, scale: .92, opacity: 0, transformPerspective: 1400, duration: 1.6, ease: "expo.out" }, .35)
    .from(".tabs", { y: 20, opacity: 0, duration: .8 }, .9);

  gsap.to(".c-stage .win", { scale: 1.04, ease: "none", scrollTrigger: { trigger: ".c-stage", start: "top top", end: "bottom top", scrub: true } });

  if (window.SplitText) document.querySelectorAll(".c-head h2, .c-box h2").forEach(h => SplitText.create(h, { type: "lines", mask: "lines", linesClass: "split-line", autoSplit: true,
    onSplit: self => gsap.from(self.lines, { yPercent: 110, duration: 1.1, stagger: .09, ease: "power4.out", scrollTrigger: { trigger: h, start: "top 86%", once: true } }) }));
  gsap.utils.toArray(".c-head p, .c-head .kicker").forEach(el => gsap.from(el, { y: 30, opacity: 0, duration: 1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%" } }));
  gsap.from(".f", { y: 70, opacity: 0, duration: 1, stagger: .07, ease: "power4.out", scrollTrigger: { trigger: ".feat", start: "top 84%" } });
  gsap.utils.toArray(".gal figure").forEach((f, i) => {
    gsap.from(f, { clipPath: "inset(18% 10% 18% 10% round 16px)", opacity: 0, duration: 1.3, ease: "power4.out", scrollTrigger: { trigger: f, start: "top 90%" } });
    gsap.fromTo(f.querySelector("img"), { yPercent: -4, scale: 1.08 }, { yPercent: 4, scale: 1.08, ease: "none", scrollTrigger: { trigger: f, start: "top bottom", end: "bottom top", scrub: true } });
  });
  gsap.from(".c-box", { y: 80, scale: .95, opacity: 0, duration: 1.2, ease: "power4.out", scrollTrigger: { trigger: ".c-box", start: "top 88%" } });
  gsap.from(".next .arrow", { scale: 0, rotate: -90, duration: 1, ease: "back.out(1.7)", scrollTrigger: { trigger: ".next", start: "top 90%" } });
  addEventListener("load", () => ScrollTrigger.refresh());
})();
