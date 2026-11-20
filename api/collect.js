// POST /api/collect — ontvangt meetevents van /assets/sw-metrics.js (zelfde domein, geen cookies).
// Antwoordt altijd 204, zodat de site nooit hapert door de meting.
import { collect } from "./_lib/analytics/collect.js";
import { clientIp } from "./_lib/http.js";

export async function POST(request) {
  const done = (reason) => new Response(null, { status: 204, headers: { "cache-control": "no-store", "x-sw-collect": reason } });
  try {
    const len = Number(request.headers.get("content-length") || 0);
    if (len > 4096) return done("te_groot");
    const text = (await request.text()).slice(0, 4096);
    let body = null; try { body = JSON.parse(text); } catch { return done("ongeldig"); }
    let originHost = null;
    for (const h of ["origin", "referer"]) {
      const v = request.headers.get(h);
      if (v) { try { originHost = new URL(v).host; break; } catch {} }
    }
    const reason = await collect({
      body, originHost,
      ua: request.headers.get("user-agent") || "",
      ip: clientIp(request),
      gpc: request.headers.get("sec-gpc") === "1",
    });
    return done(reason);
  } catch (e) {
    console.error(`[collect] ${e.code || e.name}`); // geen inhoud of IP loggen
    return done("fout");
  }
}
