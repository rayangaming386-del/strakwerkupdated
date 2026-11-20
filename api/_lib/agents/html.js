// Eenvoudige, deterministische extractie uit HTML. Geen browser, geen scripts uitvoeren.
const decode = (s) => String(s || "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/\s+/g, " ").trim();

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : null;
};

export function extract(html, baseUrl) {
  const h = String(html || "");
  const head = h.slice(0, 200_000);
  const title = decode((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "") || null;
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map(m => m[0]);
  const meta = (n) => { const t = metas.find(x => (attr(x, "name") || attr(x, "property") || "").toLowerCase() === n); return t ? attr(t, "content") : null; };
  const links = [...h.matchAll(/<a\b[^>]*>/gi)].map(m => attr(m[0], "href")).filter(Boolean);
  const imgs = [...h.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const scripts = [...h.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)].map(m => m[1]);
  const styles = [...h.matchAll(/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/gi)].length;
  const h1 = [...h.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => decode(m[1].replace(/<[^>]+>/g, " "))).filter(Boolean);
  const text = decode(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " "));
  const jsonld = [...h.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const ldTypes = [];
  for (const j of jsonld) { try { const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o["@type"]) ldTypes.push([].concat(o["@type"]).join(",")); if (o["@graph"]) walk(o["@graph"]); } }; walk(JSON.parse(j)); } catch {} }

  const tel = [...new Set(links.filter(l => /^tel:/i.test(l)).map(l => l.replace(/^tel:/i, "").trim()))].slice(0, 3);
  const mail = [...new Set(links.filter(l => /^mailto:/i.test(l)).map(l => l.replace(/^mailto:/i, "").split("?")[0].trim()))].slice(0, 3);
  const wa = links.some(l => /wa\.me\/|api\.whatsapp\.com/i.test(l));
  const host = (() => { try { return new URL(baseUrl).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const internal = links.filter(l => { try { const u = new URL(l, baseUrl); return u.hostname.replace(/^www\./, "") === host; } catch { return false; } });
  const social = [...new Set(links.filter(l => /facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|youtube\.com/i.test(l)))].slice(0, 6);
  const years = [...text.matchAll(/(?:©|&copy;|copyright)\s*(\d{4})(?:\s*[-–]\s*(\d{4}))?/gi)].map(m => Number(m[2] || m[1])).filter(y => y > 1995 && y < 2100);
  const kvk = (text.match(/\bKvK(?:-nummer|\s*nr\.?|:)?\s*:?\s*(\d{8})\b/i) || [])[1] || null;
  const generator = meta("generator");

  return {
    title, description: meta("description"), ogTitle: meta("og:title"), lang: attr((h.match(/<html\b[^>]*>/i) || [""])[0], "lang"),
    viewport: meta("viewport"), robotsMeta: meta("robots"), canonical: (() => { const t = (head.match(/<link\b[^>]*rel\s*=\s*["']?canonical[^>]*>/i) || [])[0]; return t ? attr(t, "href") : null; })(),
    generator, h1, h1Count: h1.length,
    imgCount: imgs.length, imgNoAlt: imgs.filter(t => attr(t, "alt") == null).length,
    scriptCount: scripts.length, stylesheetCount: styles, ldTypes: [...new Set(ldTypes)].slice(0, 10),
    tel, mail, whatsapp: wa, social, internalLinks: [...new Set(internal)].length,
    copyrightYear: years.length ? Math.max(...years) : null, kvk,
    words: text ? text.split(" ").length : 0,
    textSample: text.slice(0, 2500),
  };
}
