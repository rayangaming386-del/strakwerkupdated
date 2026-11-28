/* StrakWerk eigen meting (privacyvriendelijk, zonder cookies).
   - Stuurt alleen: eventnaam, pad (zonder querystring), hostnaam van de verwijzer,
     utm_source/medium/campaign, schermbreedte-categorie en een paar vaste eventvelden.
   - Geen formulierinhoud, geen WhatsApp-tekst, geen e-mailadressen, geen volledige URL's.
   - Respecteert Global Privacy Control, Do Not Track en de keuze op /privacy ("sw-meten").
   - Een WhatsApp- of mailklik betekent alleen dat WhatsApp/mail openging, niet dat er een
     bericht is verstuurd. Bevestigde aanvragen komen uitsluitend uit het CRM in HQ. */
(function () {
  "use strict";
  if (window.__swMetrics) return; // nooit dubbel laden of dubbel tellen
  var KEY = "sw-meten", TKEY = "sw-test";
  var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } };
  var ss = function (k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } };

  var requireConsent = document.documentElement.getAttribute("data-sw-consent") === "required";
  function allowed() {
    if (navigator.globalPrivacyControl === true) return false;
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return false;
    var c = ls(KEY);
    if (c === "uit") return false;
    if (requireConsent && c !== "aan") return false;
    return true;
  }

  // Testverkeer: ?sw_test=1 markeert dit tabblad; "sw-intern" markeert een apparaat (instelbaar in HQ).
  try { if (/[?&]sw_test=1\b/.test(location.search)) ss(TKEY, "1"); } catch (e) {}
  var isTest = ss(TKEY) === "1" || ls("sw-intern") === "1";

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach(function (_, i) { b[i] = Math.random() * 256 | 0; });
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  var utm = {};
  try {
    var sp = new URLSearchParams(location.search);
    ["utm_source", "utm_medium", "utm_campaign"].forEach(function (k) { var v = sp.get(k); if (v) utm[k.slice(4)] = v.slice(0, 80); });
  } catch (e) {}
  var refHost = "";
  try { if (document.referrer) { var rh = new URL(document.referrer).hostname; if (rh && rh !== location.hostname) refHost = rh; } } catch (e) {}

  var sent = {};
  function send(name, props, once) {
    if (!allowed()) return;
    if (once) { if (sent[name]) return; sent[name] = 1; }
    var body = JSON.stringify({
      id: uuid(), n: name, p: location.pathname, r: refHost, u: utm,
      w: Math.round(window.innerWidth || 0), t: isTest ? 1 : 0, d: props || {}
    });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/api/collect", new Blob([body], { type: "text/plain" }))) return;
    } catch (e) {}
    try { fetch("/api/collect", { method: "POST", body: body, keepalive: true, headers: { "content-type": "text/plain" } }); } catch (e) {}
  }

  function plek(el) {
    if (el.id === "f-send" || el.id === "f-mail") return "formulier";
    var s = el.closest && el.closest("section[id], footer, header, nav, .mbar, .mnav, .smenu");
    var id = s ? (s.id || s.tagName.toLowerCase()) : (location.pathname.split("/")[1] || "home");
    return String(id).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30) || "pagina";
  }
  function pakket() {
    var b = document.querySelector('.base-switch.pk [aria-checked="true"]');
    return b ? b.getAttribute("data-base") : "";
  }

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var base = t.closest("[data-base], [data-pick-base]");
    if (base && (base.closest(".base-switch.pk") || base.hasAttribute("data-pick-base"))) {
      send("package_select", { pakket: base.getAttribute("data-base") || base.getAttribute("data-pick-base") });
    }
    var a = t.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (/wa\.me\//.test(href)) {
      if (a.id === "qwa") send("quote_whatsapp_click", { pakket: pakket() });
      else send("contact_whatsapp_click", { plek: a.id === "qintake" ? "intake" : plek(a) });
    } else if (/^mailto:/i.test(href)) send("email_click", { plek: plek(a) });
    else if (/^tel:/i.test(href)) send("phone_click", { plek: plek(a) });
    else {
      var m = href.match(/(?:^|\/)werk\/(glow|vagpro|detak|cartronic)(?:$|[?#])/);
      if (m) send("portfolio_open", { project: m[1] });
      else if (/(?:^|\/)demo$/.test(href.split(/[?#]/)[0])) send("demo_open", { plek: plek(a) });
    }
  }, true);

  // Eerste echte interactie met de offertecalculator (één keer per paginaweergave).
  ["pointerdown", "keydown", "change"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var t = e.target;
      if (t && t.closest && t.closest("#prijzen .base-switch, #prijzen [data-opt], #prijzen .cfg, #kh")) send("calculator_start", {}, true);
    }, true);
  });

  window.__swMetrics = {
    status: function () { return allowed() ? "aan" : "uit"; },
    optOut: function () { ls(KEY, "uit"); },
    optIn: function () { ls(KEY, requireConsent ? "aan" : null); },
  };

  // Paginaweergave pas wanneer de pagina zichtbaar is (prerender/achtergrondtabs tellen niet).
  function pv() { send("page_view", {}, true); }
  if (document.visibilityState === "prerender" || document.prerendering) {
    document.addEventListener("prerenderingchange", pv, { once: true });
  } else if (document.visibilityState === "hidden") {
    document.addEventListener("visibilitychange", function f() { if (document.visibilityState === "visible") { document.removeEventListener("visibilitychange", f); pv(); } });
  } else pv();
})();
