// Contentstudio: werkvoorraad, nieuwe opdracht, kalender, projecten, resultaten en
// automatisering. Gemaakt voor de telefoon: één kolom, grote knoppen, acties bovenaan.
import { h, fmt, skeleton, errorBox, empty, toast, modal, field, badge } from "../ui.js";
import { api, ApiError } from "../api.js";

const COL = {
  actie_nodig: { label: "Actie nodig", cls: "b-bad" }, concept: { label: "Concept", cls: "" }, render_bezig: { label: "Render bezig", cls: "b-gold" },
  klaar_voor_review: { label: "Klaar voor review", cls: "b-warn" }, ingepland: { label: "Ingepland", cls: "b-info" }, gepubliceerd: { label: "Gepubliceerd", cls: "b-ok" },
};
const RENDER = { in_wachtrij: { label: "Render in wachtrij", cls: "b-info" }, bezig: { label: "Render bezig", cls: "b-gold" }, klaar: { label: "Video klaar", cls: "b-ok" }, mislukt: { label: "Render mislukt", cls: "b-bad" }, geannuleerd: { label: "Render geannuleerd", cls: "b-off" } };
const PUB = { ingepland: { label: "Ingepland", cls: "b-info" }, bezig: { label: "Wordt geplaatst", cls: "b-gold" }, bij_dienst: { label: "Ligt bij Buffer", cls: "b-info" }, wachtrij_vol: { label: "Wachtrij vol: later opnieuw", cls: "b-warn" }, concept_klaar: { label: "Proef: klaar, niet live", cls: "" }, gepubliceerd: { label: "Gepubliceerd", cls: "b-ok" }, mislukt: { label: "Mislukt", cls: "b-bad" },
  onzeker: { label: "Wordt gecontroleerd", cls: "b-warn" }, export_klaar: { label: "Zelf plaatsen", cls: "b-warn" }, handmatig_geplaatst: { label: "Zelf geplaatst", cls: "b-ok" }, geannuleerd: { label: "Geannuleerd", cls: "b-off" } };
const CH = { instagram: "Instagram", tiktok: "TikTok" };
const TABS = [["werk", "Werkvoorraad"], ["nieuw", "Nieuw"], ["kalender", "Kalender"], ["projecten", "Projecten"], ["resultaten", "Resultaten"], ["auto", "Kantoor"]];
const thumb = (p) => p.replace(/\.webp$/, /mobiel/.test(p) ? "-320.webp" : "-800.webp");
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
const fail = (e) => toast(e instanceof ApiError ? e.message + (e.missing?.length ? ` (ontbreekt: ${e.missing.join(", ")})` : "") : String(e.message || e), "bad");

async function copy(text, what = "Gekopieerd") {
  try { await navigator.clipboard.writeText(text); toast(`${what}.`, "ok"); }
  catch { const t = h("textarea", {}); t.value = text; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); toast(`${what}.`, "ok"); }
}
function amsNowLocal(addDays = 1, hhmm = "18:30") {
  const d = new Date(Date.now() + addDays * 864e5);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${hhmm}`;
}

export async function mount(root, ctx) {
  const params = new URLSearchParams(location.search);
  let tab = TABS.some(t => t[0] === params.get("tab")) ? params.get("tab") : "werk";
  let data = null, filter = "alles", drawn = false;
  const seg = h("div", { class: "seg tabs", role: "tablist", "aria-label": "Onderdelen" });
  const body = h("div", { class: "stack", style: { gap: "16px" } }, skeleton(3, "g3"));
  root.append(seg, body);
  const renderSeg = () => seg.replaceChildren(...TABS.map(([k, v]) => h("button", { type: "button", role: "tab", "aria-selected": String(tab === k), "aria-pressed": String(tab === k),
    onclick: () => { tab = k; history.replaceState(null, "", `/hq/studio?tab=${k}`); renderSeg(); draw(); } }, v, k === "werk" && data?.counts?.actie_nodig ? h("span", { class: "count" }, data.counts.actie_nodig) : null)));
  renderSeg();

  async function refresh() {
    try {
      data = await api("studio/overview");
      renderSeg();
      if (tab === "werk" || !drawn) { drawn = true; draw(); }
      ctx.setFresh(`Opgehaald om ${fmt.time(new Date())} · ververst elke 15 s`);
    } catch (e) { body.replaceChildren(errorBox(e, refresh)); }
  }
  async function draw() {
    if (!data) return;
    try {
      if (tab === "werk") body.replaceChildren(...workView().filter(Boolean));
      else if (tab === "nieuw") body.replaceChildren(await newView());
      else if (tab === "kalender") body.replaceChildren(await calendarView());
      else if (tab === "projecten") body.replaceChildren(await projectsView());
      else if (tab === "resultaten") body.replaceChildren(await resultsView());
      else if (tab === "auto") body.replaceChildren(await autoView());
    } catch (e) { body.replaceChildren(errorBox(e, draw)); }
  }

  // ── Werkvoorraad ──────────────────────────────────────────────────────────
  function workView() {
    const pieces = data.pieces;
    const attention = pieces.filter(p => p.column === "actie_nodig" || p.column === "klaar_voor_review");
    const shown = filter === "alles" ? pieces : pieces.filter(p => p.column === filter);
    const rw = data.renderWorker;
    const chips = h("div", { class: "chips", role: "group", "aria-label": "Filter" },
      [["alles", "Alles", pieces.length], ...Object.entries(COL).map(([k, v]) => [k, v.label, data.counts[k] || 0])].map(([k, label, n]) =>
        h("button", { type: "button", class: "chip", "aria-pressed": String(filter === k), onclick: () => { filter = k; draw(); } }, label, h("span", { class: "num" }, n))));
    return [
      h("div", { class: "section-h" }, h("div", {}, h("h2", {}, "Wat heeft je aandacht nodig"),
        h("p", { class: "muted" }, attention.length ? `${attention.length} contentstuk(ken) wachten op jou.` : "Niets dringends. Nieuwe opdrachten verschijnen hier vanzelf.")),
        ctx.can("content.write") ? h("button", { class: "btn btn-gold", type: "button", onclick: () => { tab = "nieuw"; renderSeg(); draw(); } }, "Nieuwe video") : null),
      attention.length ? h("div", { class: "stack" }, attention.map(card)) : null,
      h("div", { class: "row infoline" },
        h("span", { class: "faint" }, "Render-machine: ", rw?.seen ? `laatst gezien ${fmt.ago(rw.seen)} (${rw.host || "onbekend"})` : "nog niet gezien"),
        h("span", { class: "faint" }, "· Opslag: ", data.storage === "supabase" ? "Supabase Storage" : data.storage === "local" ? "lokaal (ontwikkeling)" : "niet gekoppeld"),
        h("span", { class: "faint" }, "· Instagram: ", data.instagram.connected ? `gekoppeld (@${data.instagram.account?.name || "account"})` : "niet gekoppeld (export)"),
        data.settings.paused ? badge(COL, "actie_nodig", "Automatisering gepauzeerd") : null),
      h("h3", {}, "Alle contentstukken"), chips,
      shown.length ? h("div", { class: "stack" }, shown.map(card)) : empty("Geen contentstukken", "Maak een nieuwe video of zet een project op ‘opgeleverd’ met vrijgegeven beelden."),
    ];
  }
  function card(p) {
    const act = p.actions.find(a => a.action !== "wachten") || p.actions[0];
    return h("button", { type: "button", class: "pc", onclick: () => openPiece(p.id) },
      h("div", { class: "pc-top" }, badge(COL, p.column), p.render ? badge(RENDER, p.render.status, `${RENDER[p.render.status]?.label} · v${p.render.version}`) : null,
        ...p.publications.filter(x => x.status !== "geannuleerd").map(x => badge(PUB, x.status, `${CH[x.channel]}: ${PUB[x.status]?.label}`))),
      h("b", {}, p.title), h("span", { class: "muted" }, `${p.origin === "oplevering" ? "Na oplevering" : p.origin === "automatisering" ? "Automatisch" : "Handmatig"} · bijgewerkt ${fmt.ago(p.updated_at)}`),
      act ? h("span", { class: `pc-act ${act.action === "wachten" ? "" : "need"}` }, act.text) : null);
  }

  // ── Detail van een contentstuk ─────────────────────────────────────────────
  function openPiece(id) {
    const box = h("div", { class: "stack" }, h("span", { class: "spinner" }), " Laden…");
    const m = modal("Contentstuk", box, []);
    m.dlg.classList.add("full");
    let timer = null;
    const load = async () => {
      clearTimeout(timer);
      try {
        const d = await api(`studio/pieces/${id}`);
        box.replaceChildren(...pieceView(d, load).filter(Boolean));
        const busy = d.piece.status === "plannen" || ["in_wachtrij", "bezig"].includes(d.piece.render?.status) || d.piece.publications.some(x => ["ingepland", "bezig", "onzeker"].includes(x.status) && new Date(x.scheduled_at || 0) < Date.now() + 60_000);
        if (busy && m.dlg.open) timer = setTimeout(load, 4000);
      } catch (e) { box.replaceChildren(errorBox(e, load)); }
    };
    m.dlg.addEventListener("close", () => { clearTimeout(timer); refresh(); });
    load();
  }

  function pieceView(d, reload) {
    const p = d.piece, s = p.script, r = d.renders[0] || null;
    const act = async (fn, ok) => { try { await fn(); if (ok) toast(ok, "ok"); await reload(); } catch (e) { fail(e); } };
    const out = [
      h("div", { class: "stack", style: { gap: "4px" } }, h("h2", {}, p.title), h("p", { class: "muted" }, `Doelgroep: ${d.audiences[p.audience]?.label || p.audience} · doel: ${p.goal} · campagne ${p.campaign_code}`)),
      h("div", { class: "row" }, badge(COL, p.column), r ? badge(RENDER, r.status, `${RENDER[r.status]?.label} (v${r.version})`) : badge(RENDER, "geannuleerd", "Nog geen video"),
        ...p.publications.filter(x => x.status !== "geannuleerd").map(x => badge(PUB, x.status, `${CH[x.channel]}: ${PUB[x.status]?.label}`))),
      p.actions.length ? h("div", { class: "callout" }, h("strong", {}, "Wat er nu nodig is"), h("ul", { class: "acts" }, p.actions.map(a => h("li", {}, a.text)))) : null,
    ];

    if (p.status === "plannen") out.push(h("p", { class: "row" }, h("span", { class: "spinner" }), "De planner maakt drie voorstellen…"));
    const planTask = d.tasks.find(t => t.agent_key === "content");
    if (p.status === "plannen" && planTask?.status === "mislukt" && ctx.can("content.write"))
      out.push(h("button", { class: "btn btn-gold", type: "button", onclick: () => act(() => api(`studio/pieces/${p.id}/replan`, { method: "POST", body: {} }), "Opnieuw ingepland") }, "Plan opnieuw proberen"));

    // Drie hoeken
    if (p.angles && (p.status === "kiezen" || p.status === "concept")) {
      out.push(h("details", { class: "box", open: p.status === "kiezen" },
        h("summary", {}, h("h3", {}, p.status === "kiezen" ? "Kies een verkoophoek" : "De drie voorgestelde hoeken")),
        h("div", { class: "angles" }, p.angles.map((a, i) => h("article", { class: `angle ${p.angle_index === i ? "on" : ""}` },
          h("b", {}, a.name), h("p", { class: "muted" }, a.why),
          h("p", {}, h("span", { class: "faint" }, "Opening: "), a.opening),
          h("ol", { class: "scenes-mini" }, a.scenes.map(sc => h("li", {}, sc.text.replace(/\*\*/g, ""), sc.asset ? h("span", { class: "faint" }, ` · ${sc.asset.split("/").pop()}`) : null))),
          h("p", {}, h("span", { class: "faint" }, "Oproep: "), a.cta),
          ctx.can("content.write") && p.status === "kiezen" ? h("button", { class: "btn btn-gold", type: "button", onclick: () => act(() => api(`studio/pieces/${p.id}/angle`, { method: "POST", body: { index: i } }), "Hoek gekozen; de video wordt gemaakt") }, "Kies deze hoek") : null)))));
    }

    if (s) {
      // Video
      const dirty = p.render_dirty;
      const vbox = h("section", { class: "box stack" }, h("h3", {}, "Video"));
      if (r?.status === "klaar" && r.has_video !== false) {
        vbox.append(h("div", { class: "player" }, h("video", { src: `/api/hq/media/${r.id}/video`, poster: `/api/hq/media/${r.id}/cover`, controls: true, playsinline: true, preload: "metadata" })),
          h("p", { class: "faint" }, `Versie ${r.version} · ${r.duration_s} s · 1080×1920 · ${(r.bytes / 1e6).toFixed(1)} MB${dirty ? " · script is daarna gewijzigd" : ""}`),
          h("div", { class: "row" }, h("a", { class: "btn", href: `/api/hq/media/${r.id}/video?download=1` }, "MP4 downloaden"), h("a", { class: "btn", href: `/api/hq/media/${r.id}/cover?download=1` }, "Cover downloaden")));
      } else if (r && ["in_wachtrij", "bezig"].includes(r.status)) {
        vbox.append(h("p", { class: "row" }, h("span", { class: "spinner" }), r.status === "bezig" ? "De video wordt gemaakt (ongeveer een halve minuut)…" : "Wacht op de render-machine…"));
      } else if (r?.status === "mislukt") {
        vbox.append(h("div", { class: "err" }, h("strong", {}, "Render mislukt"), h("p", {}, r.error || "Onbekende fout."), h("p", { class: "faint" }, "Opnieuw proberen is veilig: er wordt een nieuwe versie gemaakt, de oude blijft bewaard.")));
      }
      if (ctx.can("content.write") && (dirty || r?.status === "mislukt") && !(r && ["in_wachtrij", "bezig"].includes(r.status)))
        vbox.append(h("button", { class: "btn btn-gold", type: "button", onclick: () => act(() => api(`studio/pieces/${p.id}/render`, { method: "POST", body: {} }), "Nieuwe versie ingepland") }, r?.status === "mislukt" ? "Opnieuw proberen" : "Nieuwe video maken"));
      if (r?.status === "klaar" && !dirty && p.status === "concept" && ctx.can("content.approve"))
        vbox.append(h("button", { class: "btn btn-gold", type: "button", onclick: () => act(() => api(`studio/pieces/${p.id}/approve`, { method: "POST", body: { render_id: r.id } }), "Goedgekeurd") }, "Video goedkeuren"));
      out.push(vbox);

      // Scènes
      const allowed = d.assets.filter(a => a.social_ok);
      out.push(h("section", { class: "box stack" }, h("h3", {}, "Scènes"), h("p", { class: "faint" }, "Pas één scène aan zonder het concept opnieuw te maken. Daarna maak je een nieuwe video."),
        h("div", { class: "stack" }, s.scenes.map((sc, i) => sceneCard(p, sc, i, allowed, d, act)))));

      // Captions
      out.push(h("section", { class: "box stack" }, h("h3", {}, "Captions"),
        s.captions.promo_line ? h("p", { class: "faint" }, `Actieregel (wordt alleen meegestuurd vóór ${fmt.dt(s.captions.promo_until)}): ${s.captions.promo_line}`) : null,
        ...["instagram", "tiktok"].map(ch => captionEditor(p, ch, s.captions[ch], act))));

      // Voorbeeld op de telefoon en publiceren
      out.push(previewBox(p, d));
      if (p.status === "goedgekeurd" || p.publications.some(x => x.status !== "geannuleerd")) out.push(publishBox(p, d, act));

      // Campagne en herkomst
      out.push(h("section", { class: "box stack" }, h("h3", {}, "Herkomst meten"),
        h("dl", { class: "kv" }, h("dt", {}, "WhatsApp-zoekwoord"), h("dd", {}, h("b", {}, d.links.keyword || "—")),
          h("dt", {}, "Campagnelink"), h("dd", {}, h("button", { class: "btn btn-sm", type: "button", onclick: () => copy(d.links.instagram, "Instagram-link gekopieerd") }, "Kopieer (Instagram)"), " ", h("button", { class: "btn btn-sm", type: "button", onclick: () => copy(d.links.tiktok, "TikTok-link gekopieerd") }, "Kopieer (TikTok)"))),
        h("p", { class: "faint" }, "Zet de campagnelink in je bio of story. Komt er een aanvraag binnen met het zoekwoord, koppel die lead dan aan deze video (Leads › lead › Campagne).")));
    }

    // Kosten en taken
    out.push(h("details", { class: "box" }, h("summary", {}, h("h3", {}, `Kosten en taken · ${fmt.usd(d.cost.total_usd)}`)),
      h("dl", { class: "kv" }, h("dt", {}, "Taalmodel (gemeten)"), h("dd", {}, fmt.usd(d.cost.llm_usd)),
        h("dt", {}, "Rendertijd"), h("dd", {}, `${d.cost.render_minutes} min × ${fmt.usd(d.cost.rate_usd_per_min)}/min = ${fmt.usd(d.cost.render_usd)}`)),
      h("ul", { class: "acts" }, d.tasks.map(t => h("li", {}, `${t.title} — ${t.status}${t.error ? ` (${t.error})` : ""}`)))));
    if (ctx.can("content.write") && p.status !== "gearchiveerd") out.push(h("button", { class: "btn btn-sm", type: "button", onclick: () => act(() => api(`studio/pieces/${p.id}/archive`, { method: "POST", body: {} }), "Gearchiveerd") }, "Archiveren"));
    return out;
  }

  function sceneCard(p, sc, i, allowed, d, act) {
    const view = h("div", { class: "scene" },
      // Eigen beelden (brand/) staan niet publiek op de site: label in plaats van miniatuur.
      sc.asset && !sc.asset.startsWith("/brand/") ? h("img", { src: thumb(sc.asset), alt: "", loading: "lazy", width: "96", height: sc.asset.includes("mobiel") ? "190" : "54" })
        : h("div", { class: "scene-ph" }, sc.asset ? (sc.type === "screen" ? "Opname" : "Eigen beeld") : sc.type === "cta" ? "CTA" : sc.type === "prices" ? "Prijzen" : "Tekst"),
      h("div", { class: "stack", style: { gap: "2px", minWidth: 0 } },
        h("span", { class: "faint" }, `Scène ${i + 1} · ${{ hook: "Opening", shot: "Beeld", phone: "Telefoon", cta: "Oproep" }[sc.type]} · ${sc.seconds} s`),
        h("b", {}, sc.text.replace(/\*\*/g, "")), sc.sub ? h("span", { class: "muted" }, sc.sub) : null, sc.keyword ? h("span", { class: "muted" }, `App ‘${sc.keyword}’`) : null),
      ctx.can("content.write") ? h("button", { class: "btn btn-sm", type: "button", onclick: () => edit() }, "Aanpassen") : null);
    const edit = () => {
      const text = h("textarea", { rows: "2", maxlength: "140" }); text.value = sc.text;
      const sub = h("input", { maxlength: "140" }); sub.value = sc.sub || "";
      const secs = h("input", { type: "number", min: "1.5", max: "6", step: "0.1" }); secs.value = sc.seconds;
      const asset = ["shot", "phone", "hook"].includes(sc.type) ? h("select", {}, sc.type === "hook" ? h("option", { value: "" }, "Geen achtergrond") : null,
        allowed.map(a => h("option", { value: a.path, selected: a.path === sc.asset }, `${a.label} (${a.kind})`))) : null;
      modal(`Scène ${i + 1} aanpassen`, h("div", { class: "stack" },
        field("Tekst (**woord** = goud)", text), field("Ondertitel", sub), asset ? field("Beeld (alleen vrijgegeven)", asset) : null, field("Duur (seconden)", secs),
        h("p", { class: "faint" }, "Geen reviews, resultaten, percentages of andere prijzen dan de pakketprijs: HQ weigert die.")), [
        { label: "Origineel terugzetten", onClick: async (close) => { try { await api(`studio/pieces/${p.id}/scenes/${sc.id}`, { method: "PATCH", body: { reset: true } }); close(); toast("Scène teruggezet.", "ok"); act(async () => {}); } catch (e) { fail(e); } } },
        { label: "Opslaan", cls: "btn-gold", onClick: async (close) => {
          const b = { text: text.value, sub: sub.value, seconds: Number(secs.value) };
          if (asset) b.asset = asset.value;
          try { await api(`studio/pieces/${p.id}/scenes/${sc.id}`, { method: "PATCH", body: b }); close(); toast("Scène opgeslagen. Maak een nieuwe video om hem te zien.", "ok"); act(async () => {}); } catch (e) { fail(e); }
        } }]);
    };
    return view;
  }

  function captionEditor(p, ch, text, act) {
    const ta = h("textarea", { rows: ch === "instagram" ? "9" : "5", "aria-label": `${CH[ch]}-caption` }); ta.value = text || "";
    const n = h("span", { class: "faint num" });
    const upd = () => { n.textContent = `${ta.value.length} tekens`; }; ta.addEventListener("input", upd); upd();
    return h("div", { class: "stack" }, h("div", { class: "row" }, h("b", {}, CH[ch]), n, h("span", { class: "spacer" }),
      h("button", { class: "btn btn-sm", type: "button", onclick: () => copy(ta.value, "Caption gekopieerd") }, "Kopiëren")),
      ta, ctx.can("content.write") ? h("div", { class: "row" },
        h("button", { class: "btn btn-sm", type: "button", onclick: () => act(() => api(`studio/pieces/${p.id}/captions/${ch}`, { method: "PUT", body: { text: ta.value } }), "Caption opgeslagen") }, "Opslaan"),
        h("button", { class: "btn btn-sm", type: "button", onclick: () => act(() => api(`studio/pieces/${p.id}/captions/${ch}`, { method: "PUT", body: { reset: true } }), "Origineel teruggezet") }, "Origineel")) : null);
  }

  function publishBox(p, d, act) {
    const box = h("section", { class: "box stack" }, h("h3", {}, "Publiceren per kanaal"),
      h("p", { class: "faint" }, "Renderstatus en publicatiestatus staan los van elkaar. Tijden in Nederlandse tijd. ‘Gepubliceerd’ verschijnt pas na bevestiging van het platform of Buffer."),
      d.office && !d.office.plan.live_publishing ? h("p", { class: "callout" }, "Live publicatie staat uit (proefstand): HQ zet alles klaar en controleert, maar plaatst niets.") : null);
    for (const ch of ["instagram", "tiktok"]) {
      const pub = p.publications.find(x => x.channel === ch && x.status !== "geannuleerd");
      const route = d.routes?.[ch];
      const mode = d.office?.plan.channels[ch];
      const row = h("div", { class: "pub" }, h("div", { class: "row" }, h("b", {}, CH[ch]), pub ? badge(PUB, pub.status) : h("span", { class: "faint" }, "Nog niet ingepland"),
        route ? h("span", { class: "faint" }, `· route: ${d.routeLabels?.[route.method === "api" ? "instagram_api" : route.method] || route.method}${mode ? ` · ${mode.mode === "auto" ? "automatisch" : "eerst beoordelen"}` : ""}`) : null));
      if (!pub && ctx.can("content.approve") && (p.status === "goedgekeurd")) {
        const when = h("input", { type: "datetime-local", "aria-label": `Tijdstip ${CH[ch]}` }); when.value = p.slot_at ? toLocal(p.slot_at) : amsNowLocal(ch === "instagram" ? 1 : 2);
        const isExport = !route || route.method === "export";
        row.append(h("div", { class: "row" }, when,
          h("button", { class: "btn btn-gold", type: "button", onclick: () => act(() => api(`studio/pieces/${p.id}/schedule`, { method: "POST", body: { channel: ch, at_local: when.value } }), isExport ? "Klaargezet als export" : "Ingepland") }, isExport ? "Klaarzetten (export)" : "Inplannen")),
          route?.reason ? h("p", { class: "faint" }, `${route.reason}: HQ zet MP4, cover en caption klaar.`) : null);
      }
      if (pub) {
        row.append(h("p", { class: "faint" }, pub.scheduled_at ? `Gepland: ${fmt.dt(pub.scheduled_at)}` : "", pub.published_at ? ` · Geplaatst: ${fmt.dt(pub.published_at)}` : "", pub.external_id ? ` · Post-ID ${pub.external_id}` : ""),
          ...[pub.permalink ? h("a", { href: pub.permalink, target: "_blank", rel: "noopener noreferrer" }, "Bekijk de post") : null,
          pub.last_error ? h("p", { class: pub.status === "wachtrij_vol" ? "faint" : "err-inline" }, pub.last_error) : null].filter(Boolean));
        const btns = h("div", { class: "row" });
        const rid = p.render?.id || p.approved_render_id;
        if (pub.status === "export_klaar") {
          btns.append(h("a", { class: "btn btn-sm", href: `/api/hq/media/${rid}/video?download=1` }, "MP4"), h("a", { class: "btn btn-sm", href: `/api/hq/media/${rid}/cover?download=1` }, "Cover"),
            h("button", { class: "btn btn-sm", type: "button", onclick: () => copy(pub.caption || "", "Caption gekopieerd") }, "Caption kopiëren"),
            h("button", { class: "btn btn-sm btn-gold", type: "button", onclick: () => manual(pub) }, "Ik heb dit geplaatst"));
        }
        // Alleen de tijd wijzigen: geen nieuwe AI-aanroep en geen nieuwe render.
        if (["ingepland", "wachtrij_vol", "export_klaar", "concept_klaar"].includes(pub.status) && ctx.can("content.approve")) {
          const nt = h("input", { type: "datetime-local", "aria-label": `Nieuwe tijd ${CH[ch]}` }); nt.value = pub.scheduled_at ? toLocal(pub.scheduled_at) : amsNowLocal(1);
          btns.append(nt, h("button", { class: "btn btn-sm", type: "button", onclick: () => act(() => api(`studio/publications/${pub.id}/tijd`, { method: "POST", body: { at_local: nt.value } }), "Tijd gewijzigd (geen nieuwe video nodig)") }, "Tijd wijzigen"));
        }
        if (pub.status === "mislukt" && ctx.can("content.approve")) btns.append(h("button", { class: "btn btn-sm btn-gold", type: "button", onclick: () => act(() => api(`studio/publications/${pub.id}/opnieuw`, { method: "POST", body: {} }), "Opnieuw ingepland (eerst controle)") }, "Opnieuw proberen"));
        if (["ingepland", "export_klaar", "mislukt", "wachtrij_vol", "concept_klaar"].includes(pub.status) && ctx.can("content.approve")) btns.append(h("button", { class: "btn btn-sm", type: "button", onclick: () => act(() => api(`studio/publications/${pub.id}/annuleren`, { method: "POST", body: {} }), "Geannuleerd") }, "Annuleren"));
        if (["gepubliceerd", "handmatig_geplaatst"].includes(pub.status)) btns.append(h("button", { class: "btn btn-sm", type: "button", onclick: () => metric(pub) }, "Resultaat invullen"));
        row.append(btns);
      }
      box.append(row);
    }
    const manual = (pub) => {
      const url = h("input", { type: "url", placeholder: "https://www.instagram.com/reel/… (optioneel)" });
      modal("Zelf geplaatst", h("div", { class: "stack" }, field("Link naar de post", url)), [{ label: "Annuleren", onClick: c => c() }, { label: "Opslaan", cls: "btn-gold", onClick: async (c) => {
        try { await api(`studio/publications/${pub.id}/zelf_geplaatst`, { method: "POST", body: { permalink: url.value } }); c(); act(async () => {}, "Gemarkeerd als geplaatst"); } catch (e) { fail(e); } } }]);
    };
    const metric = (pub) => {
      const sel = h("select", {}, ["views", "reach", "likes", "comments", "shares", "saves"].map(k => h("option", { value: k }, k)));
      const val = h("input", { type: "number", min: "0", step: "1", inputmode: "numeric" });
      modal("Resultaat invullen", h("div", { class: "stack" }, field("Meting", sel), field("Aantal (uit de app)", val), h("p", { class: "faint" }, "Leeg laten = onbekend. Vul alleen in wat je in Instagram of TikTok ziet.")),
        [{ label: "Annuleren", onClick: c => c() }, { label: "Opslaan", cls: "btn-gold", onClick: async (c) => { try { await api(`studio/publications/${pub.id}/metrics`, { method: "POST", body: { metric: sel.value, value: Number(val.value) } }); c(); toast("Opgeslagen.", "ok"); } catch (e) { fail(e); } } }]);
    };
    return box;
  }

  // Voorbeeld zoals de post op een telefoon verschijnt: video, account en caption per kanaal.
  function previewBox(p, d) {
    const r = p.render;
    if (!r || r.status !== "klaar" || !p.script) return null;
    const handle = (ch) => d.brand?.socials?.[ch] ? `@${d.brand.socials[ch]}` : "@strakwerk (account nog niet ingesteld)";
    const tabs = h("div", { class: "seg", role: "group", "aria-label": "Kanaal" });
    const holder = h("div", {});
    let cur = "instagram";
    const draw = () => {
      tabs.replaceChildren(...["instagram", "tiktok"].map(ch => h("button", { type: "button", "aria-pressed": String(cur === ch), onclick: () => { cur = ch; draw(); } }, CH[ch])));
      const pub = p.publications.find(x => x.channel === cur && x.status !== "geannuleerd");
      const cap = pub?.caption || p.script.captions[cur] || "";
      holder.replaceChildren(h("div", { class: `pv pv-${cur}` },
        h("video", { src: `/api/hq/media/${r.id}/video`, poster: `/api/hq/media/${r.id}/cover`, muted: true, loop: true, playsinline: true, autoplay: true, preload: "metadata", "aria-label": "Voorbeeld van de video" }),
        h("div", { class: "pv-ui" }, h("b", {}, handle(cur)), h("p", { class: "pv-cap" }, cap.split("\n").filter(Boolean).slice(0, 3).join(" ")), h("span", { class: "pv-more" }, "… meer")),
        h("div", { class: "pv-side", "aria-hidden": "true" }, "♡", "💬", "↗")));
    };
    draw();
    return h("section", { class: "box stack" }, h("h3", {}, "Voorbeeld op de telefoon"), tabs, holder,
      h("p", { class: "faint" }, "Benadering van hoe Instagram en TikTok de post tonen. Account uit je StrakWerk-instellingen."),
      h("div", { class: "row" }, h("a", { class: "btn btn-sm", href: `/api/hq/media/${r.id}/subtitles?download=1` }, "Ondertitels (SRT)")));
  }
  const toLocal = (iso) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };

  // ── Nieuwe opdracht ─────────────────────────────────────────────────────────
  async function newView() {
    if (!ctx.can("content.write")) return empty("Geen rechten", "Je rol kan geen contentopdrachten maken.");
    const projects = data.projects;
    const proj = h("select", { "aria-label": "Project" }, h("option", { value: "" }, "StrakWerk zelf (geen klantproject)"), projects.map(p => h("option", { value: p.id }, `Portfolio: ${p.name} (${p.released_count}/${p.asset_count} beelden vrij)`)));
    const topic = h("select", { "aria-label": "Onderwerp" }, Object.entries(data.topics || {}).map(([k, v]) => h("option", { value: k }, v.title)));
    const aud = h("select", {}, Object.entries(data.audiences).map(([k, v]) => h("option", { value: k, selected: k === "ondernemers" }, v.label)));
    const goal = h("select", {}, Object.entries(data.goals).map(([k, v]) => h("option", { value: k }, v)));
    const grid = h("div", { class: "asset-grid" });
    const topicField = field("Onderwerp", topic);
    const loadAssets = async () => {
      topicField.hidden = Boolean(proj.value);
      if (!proj.value) { grid.replaceChildren(h("p", { class: "faint" }, "Eigen beelden van StrakWerk: schermopname van de configurator, pakketten en offerte (altijd beschikbaar).")); return; }
      const d = await api(`studio/projects/${proj.value}`);
      const sector = (d.project.sector || "").toLowerCase();
      aud.value = /salon|beauty/.test(sector) ? "saloneigenaren" : /auto|garage/.test(sector) ? "garages" : aud.value;
      grid.replaceChildren(...d.assets.map(a => {
        const usable = a.social_ok && !(a.valid_until && new Date(a.valid_until) < new Date());
        const cb = h("input", { type: "checkbox", value: a.id, checked: usable, disabled: !usable, "aria-label": a.label });
        return h("label", { class: `asset ${usable ? "" : "off"}` }, cb, h("img", { src: thumb(a.path), alt: "", loading: "lazy" }), h("span", {}, a.label),
          h("small", { class: "faint" }, usable ? (a.valid_until ? `geldig tot ${fmt.day(a.valid_until)}` : "vrijgegeven") : a.blocked ? "niet bruikbaar" : "niet vrijgegeven"));
      }));
    };
    proj.addEventListener("change", loadAssets);
    await loadAssets();
    return h("div", { class: "stack" },
      h("div", { class: "section-h" }, h("h2", {}, "Nieuwe video"), h("p", { class: "muted" }, "StrakWerk is altijd de afzender. Kies een onderwerp voor je eigen aanbod, of gebruik een opgeleverd project als portfolio. De planner maakt drie hoeken; jij kiest er één.")),
      h("div", { class: "fgrid" }, field("Waarover", proj), topicField, field("Doelgroep", aud), field("Doel", goal)),
      h("h3", {}, "Beelden"), grid,
      h("button", { class: "btn btn-gold big", type: "button", onclick: async (e) => {
        const ids = [...grid.querySelectorAll("input:checked")].map(x => x.value);
        const btn = e.currentTarget; btn.disabled = true;
        try { const r = await api("studio/pieces", { method: "POST", body: { project_id: proj.value || null, topic: topic.value, audience: aud.value, goal: goal.value, asset_ids: ids }, idempotencyKey: uuid() });
          toast("Opdracht gemaakt; de planner gaat aan de slag.", "ok"); tab = "werk"; renderSeg(); await refresh(); openPiece(r.id); }
        catch (err) { fail(err); } finally { btn.disabled = false; }
      } }, "Drie voorstellen laten maken"));
  }

  // ── Kalender ──────────────────────────────────────────────────────────────
  async function calendarView() {
    const d = await api(`studio/calendar?days=35&from=${encodeURIComponent(new Date(Date.now() - 2 * 864e5).toISOString())}`);
    const dayKey = (iso) => new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
    const items = [...d.publications.map(p => ({ at: p.scheduled_at || p.published_at, kind: "pub", p })), ...d.slots.filter(s => !d.publications.some(p => p.channel === s.channel && Math.abs(new Date(p.scheduled_at) - new Date(s.at)) < 6 * 3600e3)).map(s => ({ at: s.at, kind: "slot", s }))]
      .filter(x => x.at).sort((a, b) => new Date(a.at) - new Date(b.at));
    const groups = {};
    for (const it of items) (groups[dayKey(it.at)] ||= []).push(it);
    return h("div", { class: "stack" },
      h("div", { class: "section-h" }, h("h2", {}, "Kalender"), h("p", { class: "muted" }, "Nederlandse tijd (Europe/Amsterdam). Lege tijdsloten komen uit je automatisering.")),
      Object.keys(groups).length ? h("div", { class: "cal" }, Object.entries(groups).map(([day, list]) => h("section", { class: "cal-day" }, h("h3", {}, day),
        list.map(it => it.kind === "pub" ? h("button", { type: "button", class: "cal-item", onclick: () => openPiece(it.p.piece_id) }, h("span", { class: "num" }, fmt.hour(it.at)), h("span", {}, CH[it.p.channel]), h("b", {}, it.p.project_name), badge(PUB, it.p.status))
          : h("div", { class: "cal-item slot" }, h("span", { class: "num" }, fmt.hour(it.at)), h("span", {}, CH[it.s.channel]), h("span", { class: "faint" }, it.s.paused ? "Vrij slot (automatisering gepauzeerd)" : "Vrij slot voor automatische aflevering")))))) : empty("Nog niets gepland", "Keur een video goed en plan hem in, of zet automatisering aan."));
  }

  // ── Projecten ─────────────────────────────────────────────────────────────
  async function projectsView() {
    const d = await api("studio/projects");
    return h("div", { class: "stack" },
      h("div", { class: "section-h" }, h("h2", {}, "Klantprojecten"), h("p", { class: "muted" }, "Traject: akkoord → intake → in aanbouw → websitecontrole → opgeleverd → nazorg. Bij ‘opgeleverd’ met minstens 3 vrijgegeven beelden maakt HQ één keer een eerste contentopdracht."),
        ctx.can("content.write") ? h("button", { class: "btn", type: "button", onclick: () => newProject() }, "Project toevoegen") : null),
      h("div", { class: "stack" }, d.projects.map(p => h("button", { type: "button", class: "pc", onclick: () => openProject(p.id) },
        h("div", { class: "pc-top" }, h("span", { class: "badge b-gold" }, d.statuses[p.status]), p.company ? h("span", { class: "badge" }, `Klant: ${p.company}`) : null),
        h("b", {}, p.name), h("span", { class: "muted" }, `${p.released_count} van ${p.asset_count} beelden vrij voor social media · ${p.piece_count} contentstuk(ken)`)))));
  }
  function newProject() {
    const name = h("input", { maxlength: "160" }), url = h("input", { placeholder: "https://…" }), sector = h("input", { placeholder: "Bijv. Beautysalon" }), city = h("input");
    modal("Project toevoegen", h("div", { class: "fgrid" }, field("Naam *", name), field("Website", url), field("Branche", sector), field("Plaats", city)), [
      { label: "Annuleren", onClick: c => c() }, { label: "Opslaan", cls: "btn-gold", onClick: async (c) => {
        try { await api("studio/projects", { method: "POST", body: { name: name.value, live_url: url.value, sector: sector.value, city: city.value } }); c(); toast("Project toegevoegd.", "ok"); draw(); } catch (e) { fail(e); } } }]);
  }
  function openProject(id) {
    const box = h("div", {}, h("span", { class: "spinner" }));
    const m = modal("Project", box, []); m.dlg.classList.add("full");
    const load = async () => {
      try {
        const d = await api(`studio/projects/${id}`);
        const p = d.project;
        const st = h("select", { disabled: !ctx.can("content.write"), "aria-label": "Status" }, Object.entries(d.statuses).map(([k, v]) => h("option", { value: k, selected: k === p.status }, v)));
        st.addEventListener("change", async () => {
          try { const r = await api(`studio/projects/${id}`, { method: "PATCH", body: { status: st.value } });
            toast(r.deliveryPiece?.id ? (r.deliveryPiece.duplicate ? "Status bijgewerkt (contentopdracht bestond al)." : "Opgeleverd: eerste contentopdracht gemaakt.") : r.deliveryPiece?.skipped ? `Status bijgewerkt. Geef eerst minstens 3 beelden vrij voor de contentopdracht (${r.deliveryPiece.released} vrij).` : "Status bijgewerkt.", "ok"); load(); } catch (e) { fail(e); }
        });
        box.replaceChildren(h("div", { class: "stack" },
          h("div", { class: "row" }, h("h2", {}, p.name), h("span", { class: "spacer" }), st),
          h("p", { class: "muted" }, [p.sector, p.city, p.live_url].filter(Boolean).join(" · ")), p.summary ? h("p", {}, p.summary) : null,
          (p.features || []).length ? h("ul", { class: "acts" }, p.features.map(f => h("li", {}, f))) : null,
          h("h3", {}, "Beelden en vrijgave voor social media"),
          h("div", { class: "asset-grid" }, d.assets.map(a => {
            const tog = h("input", { type: "checkbox", checked: a.social_ok, disabled: !ctx.can("assets.release") || a.blocked, "aria-label": `${a.label} vrijgeven` });
            tog.addEventListener("change", async () => { try { await api(`studio/assets/${a.id}`, { method: "PATCH", body: { social_ok: tog.checked } }); toast(tog.checked ? "Vrijgegeven voor social media." : "Vrijgave ingetrokken.", "ok"); load(); } catch (e) { tog.checked = !tog.checked; fail(e); } });
            return h("div", { class: `asset ${a.social_ok ? "" : "off"}` }, h("img", { src: thumb(a.path), alt: a.alt || "", loading: "lazy" }), h("b", {}, a.label),
              h("label", { class: "row", style: { gap: "6px" } }, tog, a.blocked ? "Niet bruikbaar" : "Vrij voor social media"),
              a.notes ? h("small", { class: "faint" }, a.notes) : null, a.valid_until ? h("small", { class: "faint" }, `Geldig tot ${fmt.dt(a.valid_until)}`) : null);
          })),
          h("h3", {}, "Contentstukken"), d.pieces.length ? h("ul", { class: "acts" }, d.pieces.map(c => h("li", {}, h("a", { href: "#", onclick: (e) => { e.preventDefault(); m.close(); openPiece(c.id); } }, c.title), ` · ${c.status}`))) : h("p", { class: "faint" }, "Nog geen."),
          h("h3", {}, "Geschiedenis"), h("ul", { class: "acts" }, d.history.map(x => h("li", {}, `${fmt.dt(x.at)} · ${x.from_status ? `${d.statuses[x.from_status]} → ` : ""}${d.statuses[x.to_status] || ""}${x.note ? ` · ${x.note}` : ""}`)))));
      } catch (e) { box.replaceChildren(errorBox(e, load)); }
    };
    load();
  }

  // ── Resultaten ──────────────────────────────────────────────────────────────
  async function resultsView() {
    const d = await api("studio/insights");
    const v = (x) => x == null ? h("span", { class: "faint" }, "onbekend") : fmt.n(x);
    return h("div", { class: "stack" },
      h("div", { class: "callout" }, h("strong", {}, "Voorstel voor de volgende video"), h("p", {}, d.suggestion.text), h("p", { class: "faint" }, `Basis: ${d.suggestion.basis}`)),
      d.note ? h("p", { class: "faint" }, d.note) : null,
      d.pieces.length ? h("div", { class: "stack" }, d.pieces.map(p => h("article", { class: "box stack", style: { gap: "8px" } },
        h("div", { class: "row" }, h("b", {}, p.title), h("span", { class: "spacer" }), h("span", { class: `badge ${p.live ? "b-ok" : ""}` }, p.live ? "Geplaatst" : "Nog niet geplaatst")),
        h("p", { class: "faint" }, `Zoekwoord ${p.keyword} · campagne ${p.campaign_code}`),
        h("dl", { class: "kv four" }, h("dt", {}, "Views"), h("dd", { class: "num" }, v(p.views)), h("dt", {}, "Klikken"), h("dd", { class: "num" }, v(p.clicks)),
          h("dt", {}, "Aanvragen"), h("dd", { class: "num" }, v(p.requests)), h("dt", {}, "Geaccepteerd"), h("dd", { class: "num" }, p.accepted == null ? v(null) : `${p.accepted}${p.accepted_cents ? ` (${fmt.eur(p.accepted_cents)})` : ""}`)))))
      : empty("Nog geen video's"));
  }

  // ── Kantoor: één keer instellen, daarna werkt HQ zelf ────────────────────────
  async function autoView() {
    const [d, b, au] = await Promise.all([api("studio/office"), api("ai/budget"), api("studio/automation")]);
    const can = ctx.can("content.settings");
    const P = d.plan;
    const save = async (path, body, ok = "Opgeslagen.") => { try { await api(path, { method: "PUT", body }); toast(ok, "ok"); draw(); refresh(); } catch (e) { fail(e); } };
    const DAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];
    const on = h("input", { type: "checkbox", checked: P.enabled, disabled: !can });
    const wl = h("input", { type: "number", min: "0", max: "14", step: "1", disabled: !can }); wl.value = P.weekly_limit;
    const time = h("input", { type: "time", disabled: !can }); time.value = P.post_time;
    const days = DAYS.map((n, i) => { const c = h("input", { type: "checkbox", checked: P.weekdays.includes(i + 1), disabled: !can }); return [c, h("label", { class: "day" }, c, n)]; });
    const auds = Object.entries(d.audiences).map(([k, v]) => { const c = h("input", { type: "checkbox", value: k, checked: P.audiences.includes(k), disabled: !can }); return [c, h("label", { class: "day" }, c, v.label)]; });
    const goals = Object.entries(d.goals).map(([k, v]) => { const c = h("input", { type: "checkbox", value: k, checked: P.goals.includes(k), disabled: !can }); return [c, h("label", { class: "day" }, c, v)]; });
    const pf = h("input", { type: "number", min: "0", max: "10", step: "1", disabled: !can }); pf.value = P.portfolio_every;
    const live = h("input", { type: "checkbox", checked: P.live_publishing, disabled: !can });
    const chans = ["instagram", "tiktok"].map(ch => {
      const c = P.channels[ch];
      const en = h("input", { type: "checkbox", checked: c.enabled, disabled: !can });
      const mode = h("select", { disabled: !can, "aria-label": `Modus ${CH[ch]}` }, Object.entries(d.modeLabels).map(([k, v]) => h("option", { value: k, selected: c.mode === k }, v)));
      const route = h("select", { disabled: !can, "aria-label": `Route ${CH[ch]}` }, Object.entries(d.routeLabels).filter(([k]) => k !== "instagram_api" || ch === "instagram").map(([k, v]) => h("option", { value: k, selected: c.route === k }, v)));
      const r = d.routes[ch];
      return { ch, en, mode, route, el: h("div", { class: "pub" }, h("div", { class: "row" }, h("b", {}, CH[ch]), h("label", { class: "row", style: { gap: "6px" } }, en, "Aan")),
        h("div", { class: "fgrid" }, field("Na het maken", mode), field("Publicatieroute (één per kanaal)", route)),
        h("p", { class: "faint" }, r.reason ? `Nu: export (${r.reason}).` : `Nu: ${d.routeLabels[r.route]}.`)) };
    });
    const planBox = h("section", { class: "box stack" },
      h("div", { class: "row" }, h("h2", {}, "Kantoor"), h("span", { class: "spacer" }), h("label", { class: "row", style: { gap: "6px" } }, on, P.enabled ? "Aan: HQ maakt zelf video's" : "Uit")),
      h("p", { class: "muted" }, "Eén keer instellen. HQ bedenkt daarna zelf onderwerpen, schrijft scripts, kiest eigen beelden, maakt MP4 en cover, schrijft captions, plant in en controleert de uitkomst. Je krijgt alleen een melding als jouw actie nodig is."),
      h("div", { class: "fgrid" }, field("Video's per week", wl, { help: "Startinstelling: 3." }), field("Tijd (Nederlandse tijd)", time), field("Elke hoeveelste video uit het portfolio", pf, { help: "0 = nooit; portfolio alleen als een project vrijgegeven beelden heeft." })),
      h("h3", {}, "Publicatiedagen"), h("div", { class: "days" }, days.map(x => x[1])),
      h("h3", {}, "Doelgroepen"), h("div", { class: "days" }, auds.map(x => x[1])),
      h("h3", {}, "Doelen"), h("div", { class: "days" }, goals.map(x => x[1])),
      h("h3", {}, "Kanalen"), ...chans.map(c => c.el),
      h("label", { class: `row live ${P.live_publishing ? "on" : ""}`, style: { gap: "8px" } }, live, h("span", {}, h("b", {}, "Live publiceren"), " · uit = proefstand: HQ zet alles klaar als concept en plaatst niets. Zet pas aan als je accounts gekoppeld zijn.")),
      can ? h("button", { class: "btn btn-gold", type: "button", onclick: () => save("studio/office", {
        enabled: on.checked, weekly_limit: Number(wl.value), post_time: time.value, portfolio_every: Number(pf.value), live_publishing: live.checked,
        weekdays: days.map((x, i) => x[0].checked ? i + 1 : null).filter(Boolean), audiences: auds.filter(x => x[0].checked).map(x => x[0].value), goals: goals.filter(x => x[0].checked).map(x => x[0].value),
        channels: Object.fromEntries(chans.map(c => [c.ch, { enabled: c.en.checked, mode: c.mode.value, route: c.route.value }])) }, "Kantoor opgeslagen") }, "Opslaan") : null,
      h("h3", {}, "Komende publicatiemomenten"),
      d.slots.length ? h("ul", { class: "acts" }, d.slots.slice(0, 8).map(s => h("li", {}, fmt.dt(s)))) : h("p", { class: "faint" }, "Geen: kies dagen en een weeklimiet."));

    // AI-budget (alle afdelingen samen).
    const bud = b.budget;
    const fmtDate = (iso) => iso ? iso.slice(0, 10) : "";
    const ps = h("input", { type: "date", disabled: !can }); ps.value = fmtDate(bud.period_start);
    const pe = h("input", { type: "date", disabled: !can }); pe.value = fmtDate(bud.period_end);
    const granted = h("input", { type: "number", min: "0", step: "1", disabled: !can, placeholder: "bijv. 100" }); granted.value = bud.granted_usd ?? "";
    const limit = h("input", { type: "number", min: "0", step: "1", disabled: !can, placeholder: "bijv. 80" }); limit.value = bud.hq_limit_usd ?? "";
    const console_ = h("input", { type: "number", min: "0", step: "0.01", disabled: !can, placeholder: "uit de Anthropic Console" }); console_.value = bud.console_used_usd ?? "";
    const conf = h("input", { type: "checkbox", checked: bud.confirmed, disabled: !can });
    const aiOn = h("input", { type: "checkbox", checked: bud.enabled, disabled: !can });
    const budBox = h("section", { class: `box stack ${b.active ? "" : "paused"}` },
      h("div", { class: "row" }, h("h2", {}, "AI-budget"), h("span", { class: "spacer" }), h("span", { class: `badge ${b.active ? "b-ok" : "b-warn"}` }, b.active ? "AI actief" : "AI uit")),
      h("p", { class: "muted" }, b.reasonLabel),
      h("p", { class: "faint" }, "Eén limiet voor Marketing, Scout, Auditor en Sales samen. HQ reserveert vóór elke aanroep de maximale prijs. Bij het plafond of onvoldoende tegoed pauzeren alleen de AI-taken; gemaakte video's publiceren gewoon volgens planning."),
      h("div", { class: "fgrid" }, field("Periode van", ps), field("Periode tot", pe), field("Toegekend tegoed ($)", granted), field("HQ-limiet ($)", limit, { help: "Bijv. $80 als er $100 is toegekend." }), field("Verbruik volgens Console ($)", console_, { help: "Optioneel: om ander verbruik te zien." })),
      h("label", { class: "row", style: { gap: "8px" } }, conf, "Ik heb het beschikbare tegoed gezien in de Anthropic Console"),
      h("label", { class: "row", style: { gap: "8px" } }, aiOn, "AI gebruiken (alleen na bevestiging)"),
      can ? h("button", { class: "btn", type: "button", onclick: () => save("ai/budget", { period_start: ps.value || null, period_end: pe.value ? new Date(new Date(pe.value).getTime() + 864e5).toISOString().slice(0, 10) : null,
        granted_usd: granted.value, hq_limit_usd: limit.value, console_used_usd: console_.value, confirmed: conf.checked, enabled: aiOn.checked }, "AI-budget opgeslagen") }, "Opslaan") : null,
      h("dl", { class: "kv" },
        h("dt", {}, "HQ verbruikt (gemeten)"), h("dd", {}, fmt.usd(b.hq_settled_usd)), h("dt", {}, "Gereserveerd (lopend)"), h("dd", {}, fmt.usd(b.hq_reserved_usd)),
        h("dt", {}, "Nog beschikbaar voor HQ"), h("dd", {}, fmt.usd(b.remaining_usd)),
        h("dt", {}, "Ander verbruik"), h("dd", {}, b.other_usd == null ? h("span", { class: "faint" }, "onbekend") : fmt.usd(b.other_usd)),
        ...Object.values(b.byDepartment).flatMap(x => [h("dt", {}, x.label), h("dd", {}, `${fmt.usd(x.usd)} · ${x.calls} aanroep(en)`)]),
        h("dt", {}, "Wachtende AI-taken"), h("dd", {}, String(b.waiting_tasks))),
      h("p", { class: "faint" }, b.other_note));

    // Accounts van StrakWerk (afzender).
    const br = d.brand;
    const igh = h("input", { disabled: !can, placeholder: "strakwerk" }); igh.value = br.socials.instagram;
    const tth = h("input", { disabled: !can, placeholder: "strakwerk" }); tth.value = br.socials.tiktok;
    const bi = h("input", { disabled: !can, placeholder: "Buffer-kanaal-ID" }); bi.value = br.buffer_channels.instagram;
    const bt = h("input", { disabled: !can, placeholder: "Buffer-kanaal-ID" }); bt.value = br.buffer_channels.tiktok;
    const chList = h("div", {});
    const brandBox = h("section", { class: "box stack" }, h("h2", {}, "StrakWerk als afzender"),
      h("dl", { class: "kv" }, h("dt", {}, "Website"), h("dd", {}, br.site), h("dt", {}, "E-mail"), h("dd", {}, br.email || "—"), h("dt", {}, "Telefoon/WhatsApp"), h("dd", {}, br.phone || "—"), h("dt", {}, "Plaats"), h("dd", {}, br.place)),
      h("p", { class: "faint" }, "Deze gegevens en de pakketprijzen komen uit de website zelf. Accounts vul je hier in."),
      h("div", { class: "fgrid" }, field("Instagram-account", igh), field("TikTok-account", tth), field("Buffer-kanaal Instagram", bi), field("Buffer-kanaal TikTok", bt)),
      can ? h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => save("studio/brand", { socials: { instagram: igh.value, tiktok: tth.value }, buffer_channels: { instagram: bi.value, tiktok: bt.value } }, "Accounts opgeslagen") }, "Opslaan"),
        h("button", { class: "btn btn-sm", type: "button", disabled: !d.buffer.configured, onclick: async () => {
          try { const r = await api("integrations/buffer/channels"); chList.replaceChildren(h("ul", { class: "acts" }, r.channels.map(c => h("li", {}, `${c.service}: ${c.name} · `, h("code", {}, c.id), " ", h("button", { class: "btn btn-sm", type: "button", onclick: () => { if (/instagram/i.test(c.service)) bi.value = c.id; if (/tiktok/i.test(c.service)) bt.value = c.id; } }, "Gebruik"))))); }
          catch (e) { fail(e); }
        } }, d.buffer.configured ? "Kanalen ophalen uit Buffer" : "Buffer niet gekoppeld (BUFFER_API_KEY)")) : null, chList);

    // Pauze en kosten (bestaand).
    const s = au.settings;
    const budget = h("input", { type: "number", min: "0", max: "100", step: "0.5", disabled: !can }); budget.value = s.monthly_budget_usd;
    const rate = h("input", { type: "number", min: "0", max: "1", step: "0.001", disabled: !can }); rate.value = s.render_cost_usd_per_min;
    const pauseBox = h("section", { class: `box stack ${s.paused ? "paused" : ""}` }, h("div", { class: "row" }, h("h2", {}, s.paused ? "Contentkantoor staat op pauze" : "Contentkantoor loopt"), h("span", { class: "spacer" }),
        can ? h("button", { class: `btn big ${s.paused ? "btn-gold" : "btn-bad"}`, type: "button", onclick: () => save("studio/settings", { paused: !s.paused }, s.paused ? "Hervat" : "Gepauzeerd") }, s.paused ? "Hervatten" : "Pauzeren") : null),
      h("p", { class: "muted" }, `Contentkosten deze maand: ${fmt.usd(au.spent_month_usd)} van ${fmt.usd(s.monthly_budget_usd)}.`),
      h("div", { class: "fgrid" }, field("Kostenplafond content per maand ($)", budget), field("Rendertarief ($ per minuut)", rate, { help: "0 bij gratis GitHub Actions of je eigen computer." })),
      can ? h("button", { class: "btn btn-sm", type: "button", onclick: () => save("studio/settings", { monthly_budget_usd: budget.value, render_cost_usd_per_min: rate.value }) }, "Opslaan") : null,
      h("p", { class: "faint" }, d.renderWorker?.seen ? `Render-machine laatst gezien ${fmt.ago(d.renderWorker.seen)} (${d.renderWorker.host}).` : "Render-machine nog niet gezien.", d.waitingRender?.n ? ` ${d.waitingRender.n} render(s) wachten.` : ""));
    return h("div", { class: "stack" }, planBox, budBox, brandBox, pauseBox);
  }

  await refresh();
  if (params.get("piece")) openPiece(params.get("piece"));
  return { refresh, poll: 15_000 };
}
