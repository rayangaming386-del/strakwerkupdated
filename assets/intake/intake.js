// Intake-pagina: leest de persoonlijke link (?t=…), toont wat nog nodig is en slaat op.
(() => {
  const t = new URLSearchParams(location.search).get("t") || "";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const api = (opts = {}) => fetch(`/api/public/intake?t=${encodeURIComponent(t)}`, { ...opts, headers: { "content-type": "application/json" } }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "Er ging iets mis."); return j; });
  const readFile = (f) => new Promise((ok, no) => { if (f.size > 3 * 1024 * 1024) return no(new Error(`${f.name} is groter dan 3 MB.`)); const r = new FileReader(); r.onload = () => ok({ name: f.name, data: r.result }); r.onerror = () => no(new Error("Bestand niet te lezen.")); r.readAsDataURL(f); });

  function render(d) {
    $("state").hidden = true; $("form").hidden = false;
    $("title").textContent = `Je materiaal voor ${d.project.name}`;
    $("intro").textContent = `${d.contact_name ? `Hoi ${d.contact_name}! ` : ""}Vul hieronder in wat je hebt. Je kunt tussendoor opslaan en later verder.${d.project.test ? " (TESTPROJECT)" : ""}`;
    const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
    $("bar").querySelector("i").style.width = `${pct}%`; $("bar").setAttribute("aria-valuenow", d.done); $("bar").setAttribute("aria-valuemax", d.total);
    $("progress").textContent = d.complete ? "Alles wat nodig is staat erin. Rayan gaat aan de slag." : `${d.done} van ${d.total} verplichte onderdelen ingevuld.`;
    $("form").classList.toggle("done", d.complete);
    $("fields").innerHTML = d.fields.map(f => {
      const tag = f.nodig ? '<span class="req">nodig</span>' : "";
      const ok = f.filled ? '<span class="ok">✓</span>' : "";
      const lab = `<label for="f-${f.key}">${esc(f.label)}${tag}${ok}</label>`;
      if (f.type === "textarea") return `<div class="f">${lab}<textarea id="f-${f.key}" name="${f.key}">${esc(f.value)}</textarea></div>`;
      if (f.type === "text") return `<div class="f">${lab}<input type="text" id="f-${f.key}" name="${f.key}" value="${esc(f.value)}"></div>`;
      return `<div class="f">${lab}<input type="file" id="f-${f.key}" name="${f.key}" accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf" ${f.type === "files" ? "multiple" : ""}>${f.files.length ? `<div class="files">Aangeleverd: ${f.files.map(esc).join(", ")}</div>` : ""}</div>`;
    }).join("");
  }

  async function load() {
    if (!/^[a-f0-9]{48}$/.test(t)) { $("state").innerHTML = '<p class="err">Deze link is ongeldig. Vraag Rayan om een nieuwe link.</p>'; return; }
    try { render(await api()); } catch (e) { $("state").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  $("form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter || $("form").querySelector("button"); btn.disabled = true; $("msg").textContent = "Opslaan…"; $("msg").className = "small";
    try {
      const body = {};
      for (const el of $("form").querySelectorAll("input[type=text],textarea")) body[el.name] = el.value;
      let last = await api({ method: "POST", body: JSON.stringify(body) });
      // Bestanden één voor één (limiet per verzoek).
      for (const el of $("form").querySelectorAll("input[type=file]")) {
        for (const f of el.files) { const file = await readFile(f); last = await api({ method: "POST", body: JSON.stringify({ [el.name]: el.multiple ? [file] : file }) }); }
      }
      $("msg").textContent = last.complete ? "Opgeslagen. Alles is compleet, dank je wel!" : "Opgeslagen.";
      render(await api());
    } catch (e) { $("msg").textContent = e.message; $("msg").className = "small err"; }
    finally { btn.disabled = false; }
  });
  load();
})();
