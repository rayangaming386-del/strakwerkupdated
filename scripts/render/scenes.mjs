// HTML-sjablonen voor de scènes van een verticale video (1080×1920), in de huisstijl van
// StrakWerk: diepzwart, metallic goud, hoekig, gouden hoekmarkeringen, Geist.
// Beelden worden altijd in hun oorspronkelijke verhouding getoond (object-fit: contain in
// een kader met dezelfde verhouding), nooit bijgesneden of uitgerekt.
// Veilige zones voor Reels/TikTok: boven ~220 px, onder ~380 px en rechts ~140 px vrij van
// belangrijke tekst (daar staan de knoppen en het bijschrift van de app).

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// **woord** wordt goud; verder geen opmaak.
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<em class="g">$1</em>').replace(/\n/g, "<br>");

export const W = 1080, H = 1920;

const CSS = `
@font-face{font-family:"Geist"; font-weight:100 900; src:url(assets/fonts/geist-latin-wght-normal.woff2) format("woff2")}
@font-face{font-family:"Geist"; font-weight:100 900; src:url(assets/fonts/geist-latin-ext-wght-normal.woff2) format("woff2"); unicode-range:U+0100-02BA,U+1E00-1E9F,U+2020,U+20A0-20AB,U+20AD-20C0}
@font-face{font-family:"Geist Mono"; font-weight:100 900; src:url(assets/fonts/geist-mono-latin-wght-normal.woff2) format("woff2")}
*{box-sizing:border-box; margin:0; padding:0}
html,body{width:${W}px; height:${H}px; overflow:hidden; background:#070708}
body{font-family:"Geist", sans-serif; color:#F3EFE7; -webkit-font-smoothing:antialiased; position:relative}
.bg{position:absolute; inset:0; background:
  radial-gradient(900px 700px at 85% 8%, rgba(185,151,91,.18), transparent 70%),
  radial-gradient(800px 800px at 0% 100%, rgba(185,151,91,.10), transparent 70%), #070708}
.grain{position:absolute; inset:0; background:url(assets/bg/grain.webp); opacity:.35; mix-blend-mode:overlay}
.ghost{position:absolute; inset:0; background-size:cover; background-position:center; filter:blur(36px) saturate(.6); opacity:.18}
.frame{position:absolute; inset:64px 64px 64px 64px; pointer-events:none}
.frame::before,.frame::after{content:""; position:absolute; width:46px; height:46px; border:2px solid #B9975B}
.frame::before{top:0; left:0; border-right:0; border-bottom:0}
.frame::after{bottom:0; right:0; border-left:0; border-top:0}
.brand{position:absolute; top:132px; left:96px; font-weight:800; font-size:30px; letter-spacing:.08em; display:flex; gap:6px}
.brand .s{position:relative} .brand .s::after{content:""; position:absolute; left:0; right:0; bottom:-8px; height:3px; background:#B9975B}
.brand .w{color:transparent; -webkit-text-stroke:1.4px #F3EFE7}
.kicker{font:600 26px/1.2 "Geist Mono", monospace; letter-spacing:.16em; text-transform:uppercase; color:#C9A96E}
h1{font-weight:640; letter-spacing:-.035em; line-height:1.02; color:#F6F2EA}
h1 .g, p .g{font-style:normal; color:#E2CA97}
.sub{font-size:38px; line-height:1.35; color:#C8C2B8; font-weight:420}
.txt{position:absolute; left:96px; right:150px}
.foot{position:absolute; left:96px; bottom:420px; font:500 26px "Geist Mono", monospace; letter-spacing:.1em; color:#9C958A; text-transform:uppercase}
/* Laptopkader: alleen het scherm, zonder browserbolletjes of adresbalk */
.laptop{position:absolute; left:40px; width:1000px}
.laptop .scr{background:#0E0E10; border:2px solid #2B2A2E; border-radius:3px; padding:12px; box-shadow:0 60px 120px -40px rgba(0,0,0,.9), 0 0 0 1px rgba(185,151,91,.18)}
.laptop .scr img{display:block; width:100%; height:auto}
.laptop .base{height:20px; margin:0 -34px; background:linear-gradient(#2A292D,#151518); border-radius:0 0 6px 6px}
.phone{position:absolute; background:#0B0B0C; border:2px solid #34333A; border-radius:56px; padding:16px; box-shadow:0 70px 140px -40px rgba(0,0,0,.95), 0 0 0 1px rgba(185,151,91,.22)}
.phone .in{border-radius:42px; overflow:hidden; background:#000}
.phone img{display:block; width:100%; height:auto}
.key{display:inline-flex; align-items:center; gap:22px; border:2px solid #B9975B; padding:26px 36px; font-weight:700; font-size:64px; letter-spacing:-.01em; background:rgba(185,151,91,.08)}
.key b{font-family:"Geist Mono", monospace; color:#E2CA97; letter-spacing:.06em}
.wa{display:inline-block; width:58px; height:58px}
`;

function shell(inner, { ghost } = {}) {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="bg"></div>${ghost ? `<div class="ghost" style="background-image:url('${esc(ghost)}')"></div>` : ""}<div class="grain"></div><div class="frame"></div>
<div class="brand" aria-hidden="true"><span class="s">STRAK</span><span class="w">WERK</span></div>
${inner}</body></html>`;
}

// Afmetingen van een beeld in het kader zonder bijsnijden: breedte vast, hoogte uit de verhouding.
const fit = (asset, width) => Math.round(width * (asset.height / asset.width));

/**
 * scene: { type: "hook"|"shot"|"phone"|"cta", kicker, text, sub, asset, asset2, keyword, footer }
 * assets: map pad → { src (file-URL of relatief pad), width, height }
 */
export function sceneHtml(scene, assets, { cover = false } = {}) {
  const a = scene.asset ? assets[scene.asset] : null;
  const b = scene.asset2 ? assets[scene.asset2] : null;
  const kicker = scene.kicker ? `<div class="kicker">${esc(scene.kicker)}</div>` : "";
  switch (scene.type) {
    case "hook": {
      const size = scene.text.length > 48 ? 104 : 120;
      return shell(`<div class="txt" style="top:${cover ? 520 : 600}px">${kicker}
        <h1 style="font-size:${size}px; margin-top:34px">${rich(scene.text)}</h1>
        ${scene.sub ? `<p class="sub" style="margin-top:44px; max-width:800px">${rich(scene.sub)}</p>` : ""}</div>
        ${scene.footer ? `<div class="foot">${esc(scene.footer)}</div>` : ""}`, { ghost: a?.src });
    }
    case "shot": {
      const lw = 1000, sh = fit(a, lw - 28) + 28;
      const top = 740;
      const ph = b ? 640 : 0, pw = b ? Math.round((ph - 32) * (b.width / b.height)) + 32 : 0;
      return shell(`<div class="txt" style="top:250px">${kicker}
        <h1 style="font-size:${scene.text.length > 40 ? 76 : 88}px; margin-top:26px">${rich(scene.text)}</h1></div>
        <div class="laptop" style="top:${top}px"><div class="scr"><img src="${esc(a.src)}" alt=""></div><div class="base"></div></div>
        ${b ? `<div class="phone" style="width:${pw}px; right:70px; top:${top + sh - 280}px"><div class="in"><img src="${esc(b.src)}" alt=""></div></div>` : ""}
        ${scene.sub ? `<p class="sub txt" style="top:${top + sh + 60}px; ${b ? "right:" + (pw + 170) + "px" : ""}">${rich(scene.sub)}</p>` : ""}`);
    }
    case "phone": {
      const ph = 1060, pw = Math.round((ph - 32) * (a.width / a.height)) + 32;
      return shell(`<div class="txt" style="top:250px">${kicker}
        <h1 style="font-size:${scene.text.length > 40 ? 72 : 84}px; margin-top:26px">${rich(scene.text)}</h1></div>
        <div class="phone" style="width:${pw}px; left:${Math.round((W - pw) / 2)}px; top:640px"><div class="in"><img src="${esc(a.src)}" alt=""></div></div>
        ${scene.sub ? `<p class="sub txt" style="top:1740px; display:none">${rich(scene.sub)}</p>` : ""}`);
    }
    case "screen": {
      // Schermopname in een telefoon. Het scherm (#hole) wordt later door ffmpeg met de echte
      // video gevuld; de verhouding van de opname blijft behouden.
      const ph = 1120, pw = Math.round((ph - 32) * (a.width / a.height)) + 32;
      return shell(`<div class="txt" style="top:250px">${kicker}
        <h1 style="font-size:${scene.text.length > 40 ? 72 : 84}px; margin-top:26px">${rich(scene.text)}</h1></div>
        <div class="phone" style="width:${pw}px; left:${Math.round((W - pw) / 2)}px; top:600px; border-radius:30px"><div class="in" style="border-radius:8px"><div id="hole" style="width:${pw - 32}px; height:${Math.round((pw - 32) * (a.height / a.width))}px; background:#000"></div></div></div>`);
    }
    case "prices": {
      const items = (scene.items || []).slice(0, 4);
      return shell(`<div class="txt" style="top:250px">${kicker}
        <h1 style="font-size:${scene.text.length > 40 ? 76 : 88}px; margin-top:26px">${rich(scene.text)}</h1></div>
        <div style="position:absolute; left:96px; right:96px; top:${scene.text.length > 24 ? 640 : 560}px; display:flex; flex-direction:column; gap:22px">
          ${items.map(it => `<div style="display:grid; grid-template-columns:1fr auto; align-items:center; gap:8px 24px; border:2px solid rgba(185,151,91,.45); padding:30px 34px; background:rgba(17,17,20,.86)">
            <b style="font-size:48px; letter-spacing:-.02em">${esc(it.name)}</b><b style="font-size:62px; color:#E2CA97; letter-spacing:-.03em">€${esc(it.price_eur)}</b>
            ${it.pitch ? `<span style="grid-column:1 / -1; font-size:30px; color:#C8C2B8; line-height:1.3">${esc(it.pitch)}</span>` : ""}</div>`).join("")}
        </div>
        ${scene.sub ? `<p class="sub txt" style="top:1470px">${rich(scene.sub)}</p>` : ""}`);
    }
    case "cta": {
      return shell(`<div class="txt" style="top:560px">${kicker}
        <h1 style="font-size:${scene.text.length > 40 ? 96 : 110}px; margin-top:34px">${rich(scene.text)}</h1>
        ${scene.keyword ? `<div style="margin-top:70px"><span class="key"><svg class="wa" viewBox="0 0 24 24" fill="#E2CA97" aria-hidden="true"><path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 3 3 0 00-.9 2.2 5.2 5.2 0 001.1 2.7 11.8 11.8 0 004.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 001.8-1.3 2.2 2.2 0 00.2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>App <b>‘${esc(scene.keyword)}’</b></span></div>` : ""}
        ${!scene.keyword && scene.url ? `<div style="margin-top:70px"><span class="key"><b>${esc(scene.url)}</b></span></div>` : ""}
        ${scene.sub ? `<p class="sub" style="margin-top:60px">${rich(scene.sub)}</p>` : ""}</div>
        ${scene.footer ? `<div class="foot">${esc(scene.footer)}</div>` : ""}`);
    }
    default:
      throw new Error(`Onbekend scènetype: ${scene.type}`);
  }
}
