/* Gratis websitecheck (/websitecheck). Start de check in HQ, toont de uitslag en laat de
   bezoeker (alleen met vinkje) zijn gegevens achterlaten. Geen cookies; de uitslag staat achter
   een persoonlijke link (?t=...). Alle tekst wordt als tekst geplaatst, nooit als HTML. */
(function () {
  "use strict";
  var form = document.getElementById("wcForm");
  if (!form) return;
  var inp = document.getElementById("wcUrl"), msg = document.getElementById("wcMsg");
  var out = document.getElementById("uitslag"), res = document.getElementById("wcRes"), lead = document.getElementById("wcLead");
  var token = null, polling = null, busy = false;
  var waLink = document.querySelector('a[href^="https://wa.me/"]');
  var WA = waLink ? (waLink.getAttribute("href").match(/wa\.me\/(\d+)/) || [])[1] : "";
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var test = false, ref, utm = {};
  try {
    var sp0 = new URLSearchParams(location.search);
    ["source", "medium", "campaign"].forEach(function (k) { var x = sp0.get("utm_" + k); if (x) sessionStorage.setItem("sw-utm-" + k, x.slice(0, 60)); var y = sessionStorage.getItem("sw-utm-" + k); if (y) utm[k] = y; });
    if (sp0.get("ref")) sessionStorage.setItem("sw-ref", sp0.get("ref").slice(0, 40));
    ref = sessionStorage.getItem("sw-ref") || undefined;
    test = sessionStorage.getItem("sw-test") === "1" || sp0.get("sw_test") === "1";
  } catch (e) {}

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function wa(text) { return "https://wa.me/" + WA + "?text=" + encodeURIComponent(text); }
  function say(text, err) { msg.className = "wc-msg" + (err ? " err" : ""); msg.textContent = text || ""; }
  function event(name) { try { window.va && window.va("event", { name: name, data: {} }); } catch (x) {} }
  function show(node) { out.hidden = false; res.textContent = ""; res.appendChild(node); }
  function goTo(node) { var y = node.getBoundingClientRect().top + window.scrollY - 90; window.scrollTo({ top: Math.max(0, y), behavior: reduce ? "auto" : "smooth" }); }
  function api(path, opts) {
    return fetch("/api/public/" + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.message || "Er ging iets mis. Probeer het opnieuw."); e.status = r.status; throw e; } return j; });
    });
  }
  function eur(n) { return "€" + Number(n).toLocaleString("nl-NL"); }
  var OK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

  function waiting(domain) {
    var w = el("div", "wc-wait"); w.appendChild(el("span", "wc-dot"));
    w.appendChild(el("span", null, "Bezig met " + (domain || "je site") + ": homepage laden, knoppen volgen zoals een klant op een telefoon. Dit duurt meestal 10 tot 20 seconden."));
    show(w);
  }

  function failed(text) {
    var box = el("div", "wc-top");
    box.appendChild(el("small", null, "Geen uitslag"));
    box.appendChild(el("p", "wc-sum", text || "De check lukte niet."));
    var acts = el("div", "wc-acts");
    var again = el("button", "btn", "Opnieuw proberen"); again.type = "button"; again.addEventListener("click", function () { inp.focus(); goTo(form); });
    var app = el("a", "btn btn--gold", "Stuur je adres via WhatsApp"); app.href = wa("Hoi Rayan, kun je naar mijn website kijken? " + (inp.value || "")); app.target = "_blank"; app.rel = "noopener";
    acts.appendChild(app); acts.appendChild(again); box.appendChild(acts);
    show(box);
  }

  function render(d) {
    var r = d.result || {}, a = d.advice || {};
    var wrap = el("div", "wc-res");
    var top = el("div", "wc-top");
    top.appendChild(el("small", null, "Uitslag voor " + d.domain));
    var score = el("h2", "wc-score", r.skipped ? "Niet gecontroleerd" : a.total ? a.ok_count + " van de " + a.total + " punten in orde" : "Uitslag");
    score.tabIndex = -1; top.appendChild(score);
    top.appendChild(el("p", "wc-sum", a.summary || r.skipped || ""));
    wrap.appendChild(top);
    if ((r.checks || []).length) {
      var ul = el("ul", "wc-list");
      r.checks.forEach(function (c) {
        var li = el("li", "wc-item" + (c.ok === false ? " bad" : c.ok === null ? " na" : ""));
        var ico = el("span", "wc-ico");
        if (c.ok === true) ico.innerHTML = OK_SVG; else ico.textContent = c.ok === false ? "!" : "–";
        ico.setAttribute("aria-hidden", "true");
        var t = el("div");
        if (c.ok === false) t.appendChild(el("span", "wc-tag", "Verbeterpunt"));
        t.appendChild(el("b", null, c.label + (c.ok === true ? ": in orde" : c.ok === null ? ": niet van toepassing" : "")));
        t.appendChild(el("p", null, c.detail));
        li.appendChild(ico); li.appendChild(t); ul.appendChild(li);
      });
      wrap.appendChild(ul);
    }
    if ((r.tips || []).length) {
      wrap.appendChild(el("h3", "wc-h", "Kansen"));
      var tl = el("ul", "wc-list");
      r.tips.forEach(function (tip) { var li = el("li", "wc-item na"); var ico = el("span", "wc-ico", "+"); ico.setAttribute("aria-hidden", "true"); li.appendChild(ico); li.appendChild(el("p", null, tip)); tl.appendChild(li); });
      wrap.appendChild(tl);
    }
    if (!r.skipped) {
      var adv = el("div", "wc-adv");
      adv.appendChild(el("small", null, "Mijn advies"));
      if (a.package) {
        var o = el("div", "wc-offer"); o.appendChild(el("b", null, "Pakket " + a.package.name)); o.appendChild(el("span", "wc-price", eur(a.package.price_eur) + " eenmalig")); o.appendChild(el("p", null, a.package.why)); adv.appendChild(o);
      }
      (a.options || []).forEach(function (op) {
        var o2 = el("div", "wc-offer"); o2.appendChild(el("b", null, op.name)); o2.appendChild(el("span", "wc-price", "+" + eur(op.price_eur))); o2.appendChild(el("p", null, op.why)); adv.appendChild(o2);
      });
      if (a.note) adv.appendChild(el("p", null, a.note));
      var acts = el("div", "wc-acts");
      var b1 = el("a", "btn btn--gold", "Bespreek de uitslag via WhatsApp"); b1.href = wa("Hoi Rayan, ik heb de websitecheck gedaan voor " + d.domain + ". Kun je meekijken?"); b1.target = "_blank"; b1.rel = "noopener";
      var b2 = el("a", "btn", "Bekijk de prijzen"); b2.href = "/prijzen";
      acts.appendChild(b1); acts.appendChild(b2); adv.appendChild(acts);
      wrap.appendChild(adv);
    }
    show(wrap);
    showLead(d.contact_sent);
    say("Klaar: " + (r.skipped ? "deze site vraagt om niet mee te kijken." : a.total ? a.ok_count + " van de " + a.total + " punten in orde." : "uitslag hieronder."));
    return score;
  }

  function showLead(sent) {
    if (!lead) return;
    if (sent) { lead.hidden = true; var done = el("p", "wc-done", "Je gegevens zijn binnen. Je hoort snel van me. Rayan"); res.appendChild(done); return; }
    lead.hidden = false;
  }

  function poll(first) {
    clearTimeout(polling);
    var tries = 0;
    (function tick() {
      api("websitecheck?t=" + encodeURIComponent(token), { headers: { accept: "application/json" } }).then(function (d) {
        if (d.status === "bezig") { if (first && tries === 0) waiting(d.domain); if (++tries < 90) { polling = setTimeout(tick, 1500); return; } failed("De check duurt te lang. Probeer het later nog eens."); busy = false; return; }
        busy = false;
        if (d.status === "mislukt") { failed(d.error); showLead(d.contact_sent); say(d.error || "De check lukte niet.", true); return; }
        var h = render(d); goTo(out); try { h.focus({ preventScroll: true }); } catch (x) {}
      }).catch(function (e) { busy = false; if (e.status === 404) { say("Deze uitslag bestaat niet (meer). Doe gerust een nieuwe check.", true); return; } if (++tries < 90) { polling = setTimeout(tick, 2500); return; } say(e.message, true); });
    })();
  }

  function start(raw) {
    if (busy) return;
    var v = String(raw || "").trim().replace(/\s+/g, "");
    if (v && !/^https?:\/\//i.test(v)) v = "https://" + v;
    var u = null; try { u = new URL(v); } catch (x) {}
    if (!u || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) { say("Vul een geldig adres in, bijvoorbeeld jouwbedrijf.nl", true); inp.focus(); return; }
    busy = true; say("De check is gestart…");
    waiting(u.hostname.replace(/^www\./, "")); goTo(out);
    var body = { url: u.origin + (u.pathname === "/" ? "" : u.pathname), hp: (document.getElementById("wcHp") || {}).value || "" };
    if (test) body.sw_test = true;
    api("websitecheck", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(function (j) {
      if (!j.token) { busy = false; failed("De check kon niet starten. Probeer het opnieuw."); return; }
      token = j.token; event("Websitecheck");
      try { history.replaceState(null, "", location.pathname + "?t=" + encodeURIComponent(token) + "#uitslag"); } catch (x) {}
      poll(false);
    }).catch(function (e) { busy = false; failed(e.message); say(e.message, true); });
  }

  form.addEventListener("submit", function (e) { e.preventDefault(); start(inp.value); });

  if (lead) lead.addEventListener("submit", function (e) {
    e.preventDefault();
    var st = document.getElementById("wl-status");
    var v = function (id) { var n = document.getElementById(id); return n ? String(n.value || "").trim() : ""; };
    var ok = document.getElementById("wl-ok");
    if (!token) { st.className = "wc-msg err"; st.textContent = "Doe eerst de check."; return; }
    if (!v("wl-tel") && !v("wl-mail")) { st.className = "wc-msg err"; st.textContent = "Vul je telefoonnummer of e-mailadres in."; return; }
    if (!ok || !ok.checked) { st.className = "wc-msg err"; st.textContent = "Zet het vinkje aan als ik contact met je mag opnemen."; return; }
    var btn = lead.querySelector("button[type=submit]"); btn.disabled = true; st.className = "wc-msg"; st.textContent = "Versturen…";
    var body = { t: token, name: v("wl-naam"), company: v("wl-bedrijf"), phone: v("wl-tel"), email: v("wl-mail"), message: v("wl-msg"), consent: true, hp: v("wl-hp"), ref: ref, utm: utm };
    api("websitecheck/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(function () {
      event("Websitecheck contact");
      lead.hidden = true;
      var done = el("p", "wc-done", "Dank je! Je gegevens zijn binnen. Ik neem snel contact met je op. Rayan");
      res.appendChild(done); goTo(done);
    }).catch(function (err) { btn.disabled = false; st.className = "wc-msg err"; st.textContent = err.message; });
  });

  // Vanaf de homepage (?url=...) meteen starten; met ?t=... de eerdere uitslag tonen.
  var sp = new URLSearchParams(location.search);
  if (sp.get("t") && /^[A-Za-z0-9_-]{24,64}$/.test(sp.get("t"))) { token = sp.get("t"); busy = true; out.hidden = false; poll(true); }
  else if (sp.get("url")) { inp.value = sp.get("url").slice(0, 200); start(inp.value); }
})();
