import { h, fmt, skeleton, errorBox, badge, STATE, bars, empty, notLinked } from "../ui.js";
import { api } from "../api.js";

const EVENT_LABEL = {
  calculator_start: "Calculator gestart", package_select: "Pakket gekozen", portfolio_open: "Project bekeken",
  quote_whatsapp_click: "WhatsApp vanuit offerte", contact_whatsapp_click: "WhatsApp (overig)", email_click: "E-mailklik",
  phone_click: "Belklik", demo_open: "Demo geopend",
};

function series(rows, bucket) {
  if (!rows?.length) return empty("Geen paginaweergaven in deze periode");
  const max = Math.max(...rows.map(r => r.pageviews), 1);
  const W = 640, H = 160, bw = W / rows.length;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H + 22}`); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Paginaweergaven per ${bucket === "hour" ? "uur" : "dag"}`);
  svg.style.width = "100%"; svg.style.height = "auto";
  rows.forEach((r, i) => {
    const hgt = Math.max(1, r.pageviews / max * H);
    const rect = document.createElementNS(svg.namespaceURI, "rect");
    Object.entries({ x: i * bw + 2, y: H - hgt, width: Math.max(2, bw - 4), height: hgt, rx: 3, fill: "#CFAE69", "fill-opacity": ".85" }).forEach(([k, v]) => rect.setAttribute(k, v));
    const t = document.createElementNS(svg.namespaceURI, "title");
    t.textContent = `${bucket === "hour" ? fmt.hour(r.t) : fmt.day(r.t)}: ${r.pageviews} weergaven, ${r.visitors} bezoekers`;
    rect.append(t); svg.append(rect);
    if (rows.length <= 14 || i % Math.ceil(rows.length / 10) === 0) {
      const lbl = document.createElementNS(svg.namespaceURI, "text");
      Object.entries({ x: i * bw + bw / 2, y: H + 16, "text-anchor": "middle", fill: "#98A2B0", "font-size": "10" }).forEach(([k, v]) => lbl.setAttribute(k, v));
      lbl.textContent = bucket === "hour" ? fmt.hour(r.t) : fmt.day(r.t);
      svg.append(lbl);
    }
  });
  return svg;
}

function card(title, sub, content) {
  return h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", {}, title), sub ? h("p", { class: "muted" }, sub) : null), content);
}

export async function mount(root, ctx) {
  let period = new URLSearchParams(location.search).get("periode") || "vandaag";
  let envName = "production";
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Periode" });
  const envSeg = h("div", { class: "seg", role: "group", "aria-label": "Verkeer" });
  const body = h("div", { class: "stack", style: { gap: "18px" } }, skeleton(6, "g2"));
  const P = { vandaag: "Vandaag", "7d": "7 dagen", "30d": "30 dagen" };
  const renderSeg = () => {
    seg.replaceChildren(...Object.entries(P).map(([k, v]) => h("button", { type: "button", "aria-pressed": String(k === period), onclick: () => { period = k; renderSeg(); refresh(); } }, v)));
    envSeg.replaceChildren(...[["production", "Productie"], ["test", "Testverkeer"], ["preview", "Preview"]].map(([k, v]) => h("button", { type: "button", "aria-pressed": String(k === envName), onclick: () => { envName = k; renderSeg(); refresh(); } }, v)));
  };
  renderSeg();
  root.append(
    h("div", { class: "section-h" }, h("div", { class: "row" }, seg, envSeg),
      h("p", { class: "muted" }, "“Actief” betekent: een gemeten paginaweergave of klik in de laatste 5 minuten. Geen garantie dat iemand nu nog kijkt.")),
    body,
    h("details", { class: "card" }, h("summary", {}, h("strong", {}, "Hoe wordt er gemeten en wat zijn de beperkingen?")),
      h("div", { class: "stack", style: { marginTop: "12px", fontSize: ".9rem" } },
        h("p", {}, "Eigen meting: elke pagina stuurt een paginaweergave en vaste klik-events naar /api/collect. Zonder cookies; het IP-adres wordt niet opgeslagen. Een bezoeker wordt per dag geteld met een pseudonieme hash (dagzout, na 2 dagen gewist). Pseudoniem is niet hetzelfde als anoniem."),
        h("p", {}, "Niet meegeteld: browsers met Global Privacy Control of Do Not Track, bezoekers die meten uitzetten op /privacy, adblockers die het script blokkeren, bots en headless browsers. De cijfers zijn dus een ondergrens."),
        h("p", {}, "Verwijzers zijn alleen de hostnaam en ontbreken vaak (apps, privacy-instellingen). Campagnes alleen via utm_source/utm_medium/utm_campaign."),
        h("p", {}, "Een doorlopende conversietrechter wordt niet getoond: zonder cookies of profielen kunnen stappen van één bezoeker niet betrouwbaar worden verbonden. Daarom staan metingen los naast elkaar."),
        h("p", {}, "Testverkeer: open de site met ?sw_test=1 (geldt voor dat tabblad) of markeer dit apparaat in Instellingen. Dat verkeer telt niet mee in productie."))));

  async function refresh() {
    try {
      const d = await api(`visitors?period=${period}&env=${envName}`);
      const e = d.eigen, v = d.vercel;
      const eigenSrc = d.sources.find(s => s.id === "eigen");
      const vercelSrc = d.sources.find(s => s.id === "vercel");
      const blocks = [];
      if (!e) {
        blocks.push(eigenSrc?.state === "niet_gekoppeld" ? notLinked("Eigen meting", eigenSrc.missing, "Zonder database worden geen metingen opgeslagen.")
          : eigenSrc?.state === "fout" ? errorBox({ message: eigenSrc.error }, refresh)
          : h("div", { class: "empty" }, h("strong", {}, "Geen gegevens beschikbaar"), h("p", {}, eigenSrc?.note || "")));
      } else {
        blocks.push(h("div", { class: "grid g4" },
          h("div", { class: "card metric" }, h("div", { class: "lbl" }, "Bezoekers"), h("div", { class: "val" }, fmt.n(e.visitors)), h("p", { class: "sub" }, `${e.periodLabel} · uniek per dag geteld`)),
          h("div", { class: "card metric" }, h("div", { class: "lbl" }, "Paginaweergaven"), h("div", { class: "val" }, fmt.n(e.pageviews)), h("p", { class: "sub" }, e.periodLabel)),
          h("div", { class: "card metric" }, h("div", { class: "lbl" }, "Laatste meting"), h("div", { class: "val", style: { fontSize: "1.2rem" } }, fmt.ago(eigenSrc.lastEventAt)), h("p", { class: "sub" }, fmt.dt(eigenSrc.lastEventAt)))));
        blocks.push(card("Paginaweergaven", e.bucket === "hour" ? "per uur (Amsterdamse tijd)" : "per dag", series(e.series, e.bucket)));
        const devTotal = e.devices.reduce((s, r) => s + r.visitors, 0);
        blocks.push(h("div", { class: "grid g2" },
          card("Populaire pagina's", "weergaven", bars(e.pages, { value: "pageviews" })),
          card("Verwijzende websites", "bezoekers", bars(e.referrers)),
          card("Campagnes (UTM)", "bezoekers", bars(e.campaigns)),
          card("Apparaten", "aandeel bezoekers", bars(e.devices, { label: r => ({ mobiel: "Mobiel", tablet: "Tablet", desktop: "Desktop", onbekend: "Onbekend" })[r.key] || r.key, fmtv: n => devTotal ? `${Math.round(n / devTotal * 100)}% (${n})` : "—" })),
          card("Klikken en acties", "losse metingen, geen trechter", bars(e.events, { value: "count", label: r => EVENT_LABEL[r.key] || r.key })),
        ));
      }
      // Vercel als tweede, onafhankelijke bron
      if (vercelSrc) {
        if (vercelSrc.state === "niet_gekoppeld") blocks.push(notLinked("Vercel Web Analytics (optioneel)", vercelSrc.missing, "De officiële API kan ter vergelijking worden gekoppeld met een leestoken."));
        else if (vercelSrc.state === "fout") blocks.push(h("div", { class: "err" }, h("strong", {}, "Vercel Web Analytics: verbinding mislukt"), h("p", {}, vercelSrc.error)));
        else if (v) blocks.push(card("Vercel Web Analytics", `opgehaald ${fmt.time(v.fetchedAt)} · Vercel verwerkt met vertraging`, h("div", { class: "stack" },
          h("p", {}, `Bezoekers: ${fmt.n(v.visitors)} · paginaweergaven: ${fmt.n(v.pageviews)}`),
          v.pages ? bars(v.pages, { value: "pageviews" }) : null,
          v.notes?.length ? h("p", { class: "faint" }, v.notes.join(" · ")) : null)));
      }
      body.replaceChildren(...blocks);
      ctx.setFresh(`Opgehaald om ${fmt.time(new Date())}${eigenSrc?.lastEventAt ? ` · laatste meting ${fmt.ago(eigenSrc.lastEventAt)}` : ""} · ververst elke 30 s`);
    } catch (err) {
      body.replaceChildren(errorBox(err, refresh));
    }
  }
  await refresh();
  return { refresh, poll: 30_000 };
}
