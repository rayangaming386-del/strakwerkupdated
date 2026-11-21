// Render-worker in GitHub Actions direct starten na een nieuwe render (optioneel).
// Nodig: GITHUB_RENDER_TOKEN (fijnmazig token met alleen "Actions: read and write" op deze
// repository) en GITHUB_RENDER_REPO (eigenaar/naam). Zonder deze variabelen pakt de
// geplande workflow of een lokale render-worker de render op.
const E = (k) => (process.env[k] ?? "").trim();

export const dispatchConfigured = () => Boolean(E("GITHUB_RENDER_TOKEN") && /^[\w.-]+\/[\w.-]+$/.test(E("GITHUB_RENDER_REPO")));

let last = 0;
export async function dispatchRenderWorker() {
  if (!dispatchConfigured() || Date.now() - last < 30_000) return false;
  last = Date.now();
  try {
    const r = await fetch(`https://api.github.com/repos/${E("GITHUB_RENDER_REPO")}/actions/workflows/hq-render.yml/dispatches`, {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${E("GITHUB_RENDER_TOKEN")}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json" },
      body: JSON.stringify({ ref: E("GITHUB_RENDER_REF") || "main" }),
    });
    return r.status === 204;
  } catch { return false; }
}
