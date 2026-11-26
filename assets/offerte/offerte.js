// Offertepagina: leest de ondertekende link (?t=…), toont de offerte en verwerkt het akkoord.
(() => {
  const t = new URLSearchParams(location.search).get("t") || "";
  const $ = (id) => document.getElementById(id);
  const eur = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
  const date = (v) => v ? new Date(v).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }) : "";
  const api = (opts = {}) => fetch(`/api/public/offerte?t=${encodeURIComponent(t)}`, { ...opts, headers: { "content-type": "application/json" } })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "Er ging iets mis."); return j; });
  const text = (id, v) => { $(id).textContent = v ?? ""; };

  function render(d) {
    $("state").hidden = true; $("view").hidden = false;
    text("company", d.company + (d.test ? " (TEST)" : ""));
    text("title", d.first_name ? `${d.first_name}, je nieuwe website` : "Je nieuwe website");
    text("description", d.description);
    const rows = [...d.items.map(i => [i.name, i.note, i.per ? `${eur(i.price_eur)} per ${i.per}` : eur(i.price_eur)]),
      ...d.extras.map(e => [e.omschrijving, "Extra wens", eur(e.prijs_eur)])];
    $("lines").replaceChildren(...rows.map(([n, note, p]) => {
      const tr = document.createElement("tr"), a = document.createElement("td"), b = document.createElement("td");
      a.textContent = n; if (note) { const s = document.createElement("span"); s.className = "note"; s.textContent = note; a.append(s); }
      b.textContent = p; tr.append(a, b); return tr;
    }));
    text("total", eur(d.total_eur));
    $("monthly").hidden = !d.monthly_eur; text("monthly", d.monthly_eur ? `Daarnaast ${eur(d.monthly_eur)} per maand voor de gekozen maandelijkse opties.` : "");
    $("deposit").parentElement.hidden = !d.deposit_pct;
    text("depositLabel", `Aanbetaling bij akkoord (${d.deposit_pct}%)`);
    text("deposit", eur(d.deposit_eur));
    text("rest", d.deposit_pct && d.deposit_pct < 100 ? `De rest (${eur(d.rest_eur)}) betaal je bij oplevering.` : "");
    text("start", d.earliest_start ? `Ik kan starten vanaf ${date(d.earliest_start)}.` : "");
    text("valid", d.valid_until && !d.accepted ? `Deze offerte is geldig tot en met ${date(d.valid_until)}.` : "");
    $("infoCard").hidden = !(d.info_needed?.length || d.next_step);
    $("info").replaceChildren(...(d.info_needed || []).map(x => { const li = document.createElement("li"); li.textContent = x; return li; }));
    text("next", d.next_step);
    $("termsCard").hidden = !d.terms; text("terms", d.terms);
    const wa = `https://wa.me/${d.contact.whatsapp}?text=${encodeURIComponent(`Hoi Rayan, een vraag over mijn offerte (${d.company}).`)}`;
    $("wa").href = wa; $("tel").href = `tel:${d.contact.phone}`; text("tel", d.contact.phone.replace(/^\+31/, "0"));
    if (d.accepted) return done(d);
    if (d.expired) { $("accept").hidden = true; $("valid").textContent = "Deze offerte is verlopen. Stuur Rayan een berichtje: hij maakt graag een nieuwe."; $("valid").className = "small err"; return; }
    $("accept").hidden = false;
  }

  function done(d) {
    $("accept").hidden = true; $("done").hidden = false;
    text("doneText", `${d.accepted.name ? `${d.accepted.name}, ` : ""}je akkoord is ontvangen${d.accepted.at ? ` op ${date(d.accepted.at)}` : ""}. Na de aanbetaling ga ik voor je aan de slag.`);
    const p = d.payment;
    $("pay").hidden = !(p && p.iban);
    if (p && p.iban) { text("payAmount", eur(p.amount_eur)); text("payIban", p.iban); text("payName", p.account_name || "StrakWerk"); text("payRef", p.reference); }
    $("payNote").hidden = !(p && p.note); text("payNote", p?.note || "");
    if (d.intake_url) { $("intake").hidden = false; $("intake").href = d.intake_url; }
  }

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button.copy"); if (!b) return;
    try { await navigator.clipboard.writeText($(b.dataset.copy).textContent); b.textContent = "Gekopieerd"; setTimeout(() => (b.textContent = "Kopieer"), 1500); } catch {}
  });

  $("accept").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("accept").querySelector("button"); btn.disabled = true; $("msg").textContent = "Even verwerken…"; $("msg").className = "small";
    try { render(await api({ method: "POST", body: JSON.stringify({ name: $("name").value, agree: $("agree").checked }) })); }
    catch (e) { $("msg").textContent = e.message; $("msg").className = "small err"; }
    finally { btn.disabled = false; }
  });

  if (!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,40}$/.test(t)) { $("state").innerHTML = '<p class="err">Deze offertelink klopt niet. Vraag Rayan om een nieuwe link.</p>'; return; }
  api().then(render, (e) => { $("state").innerHTML = ""; const p = document.createElement("p"); p.className = "err"; p.textContent = e.message; $("state").append(p); });
})();
