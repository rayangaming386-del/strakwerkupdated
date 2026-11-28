/* Voorbeeldsite: telt één echte bezoeker nadat de pagina een paar seconden zichtbaar was.
   Linkvoorbeelden (WhatsApp, Gmail) voeren geen scripts uit en tellen dus niet mee. Geen cookies. */
(function () {
  "use strict";
  var m = location.pathname.match(/^\/voorbeeld\/([a-z0-9-]{3,60})$/);
  if (!m) return;
  var done = false;
  function seen() {
    if (done || document.visibilityState !== "visible") return;
    done = true;
    try { fetch("/api/public/voorbeeld/" + m[1] + "/gezien", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: "{}" }); } catch (e) {}
  }
  setTimeout(seen, 4000);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") setTimeout(seen, 4000); });
})();
