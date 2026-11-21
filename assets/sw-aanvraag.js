/* Contactformulier → StrakWerk HQ.
   Wanneer iemand het formulier via WhatsApp of e-mail verstuurt, gaat dezelfde aanvraag
   (naam, bedrijf, soort, bericht, pagina en eventuele campagnecode) ook naar HQ, zodat
   hij niet kwijtraakt en snel beantwoord wordt. Geen cookies; zie /privacy. */
(function () {
  "use strict";
  if (window.__swAanvraag) return; window.__swAanvraag = 1;
  var v = function (id) { var el = document.getElementById(id); return el ? String(el.value || "").trim() : ""; };
  var utm = {};
  try {
    var sp = new URLSearchParams(location.search);
    ["source", "medium", "campaign"].forEach(function (k) { var x = sp.get("utm_" + k); if (x) sessionStorage.setItem("sw-utm-" + k, x.slice(0, 60)); });
    var ref = sp.get("ref"); if (ref) sessionStorage.setItem("sw-ref", ref.slice(0, 40));
    ["source", "medium", "campaign"].forEach(function (k) { var x = sessionStorage.getItem("sw-utm-" + k); if (x) utm[k] = x; });
  } catch (e) {}
  var sent = {};
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("#f-send, #f-mail") : null;
    if (!a) return;
    var body = { name: v("f-naam"), company: v("f-bedrijf"), type: v("f-type"), message: v("f-msg"), page: location.pathname, utm: utm, hp: v("f-hp") };
    if (!body.name && !body.company && !body.message) return;
    try { body.ref = sessionStorage.getItem("sw-ref") || undefined; if (sessionStorage.getItem("sw-test") === "1") body.sw_test = true; } catch (x) {}
    var key = JSON.stringify([body.name, body.company, body.message]);
    if (sent[key]) return; sent[key] = 1; // WhatsApp én mail klikken = één aanvraag
    try { fetch("/api/public/aanvraag", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); } catch (x) {}
  }, true);
})();
