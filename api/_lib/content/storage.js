// Duurzame opslag van video's en covers.
// - Productie: Supabase Storage, privé-bucket "hq-media" (SUPABASE_URL + SUPABASE_SECRET_KEY).
//   Afspelen/downloaden via kortlevende ondertekende links die alleen HQ maakt.
// - Lokaal/tests: map op schijf (HQ_MEDIA_DIR, standaard .data/media), via HQ gestreamd.
// Kies expliciet met HQ_STORAGE=local of HQ_STORAGE=supabase.
import { createReadStream } from "node:fs";
import { mkdir, writeFile, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../env.js";
import { isServerless } from "../runtime.js";

// Alleen lokaal gebruikt; in Workers bestaat er geen schijf (en geen bestandspad van deze module).
const root = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const BUCKET = "hq-media";
const KEY_RE = /^[a-z0-9][a-z0-9/_.-]{3,200}$/;

export function driver() {
  const pick = (process.env.HQ_STORAGE || "").trim();
  const hasSb = Boolean(env.supabaseUrl && env.supabaseSecretKey);
  if (pick === "local") return isServerless() ? "niet_gekoppeld" : "local";
  if (pick === "supabase") return hasSb ? "supabase" : "niet_gekoppeld";
  if (hasSb) return "supabase";
  return isServerless() ? "niet_gekoppeld" : "local"; // serverloos: geen lokale schijf
}
export const localDir = () => path.resolve(process.env.HQ_MEDIA_DIR || path.join(root(), ".data", "media"));

function assertKey(key) {
  if (!KEY_RE.test(key) || key.includes("..")) throw new Error("Ongeldige opslagsleutel.");
}

async function sb(pathname, init = {}) {
  const res = await fetch(`${env.supabaseUrl}/storage/v1/${pathname}`, {
    ...init, headers: { authorization: `Bearer ${env.supabaseSecretKey}`, apikey: env.supabaseSecretKey, ...(init.headers || {}) },
    signal: AbortSignal.timeout(120_000),
  });
  return res;
}

export async function ensureBucket() {
  if (driver() !== "supabase") return;
  const r = await sb("bucket", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });
  if (!r.ok && r.status !== 409 && r.status !== 400) throw new Error(`Opslag niet bereikbaar (${r.status}).`);
}

export async function put(key, buf, contentType) {
  assertKey(key);
  const d = driver();
  if (d === "local") {
    const f = path.join(localDir(), key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, buf);
    return { key, bytes: buf.length };
  }
  if (d === "supabase") {
    const r = await sb(`object/${BUCKET}/${key}`, { method: "POST", headers: { "content-type": contentType, "x-upsert": "true", "cache-control": "31536000" }, body: buf });
    if (!r.ok) throw Object.assign(new Error(`Uploaden naar opslag mislukt (${r.status}).`), { retryable: true });
    return { key, bytes: buf.length };
  }
  throw Object.assign(new Error("Opslag niet gekoppeld (SUPABASE_URL en SUPABASE_SECRET_KEY nodig)."), { retryable: false });
}

/** Kortlevende link voor afspelen/downloaden of voor Instagram (moet publiek bereikbaar zijn). */
export async function signedUrl(key, { expiresIn = 3600, download = null } = {}) {
  assertKey(key);
  if (driver() !== "supabase") return null;
  const r = await sb(`object/sign/${BUCKET}/${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expiresIn }) });
  if (!r.ok) throw new Error(`Link maken mislukt (${r.status}).`);
  const j = await r.json();
  const u = new URL(`${env.supabaseUrl}/storage/v1${j.signedURL || j.signedUrl}`);
  if (download) u.searchParams.set("download", download);
  return u.toString();
}

/** Lokaal bestand openen met ondersteuning voor HTTP Range (nodig voor video op iOS). */
export async function localResponse(key, request, { contentType, download = null } = {}) {
  assertKey(key);
  const f = path.join(localDir(), key);
  let st;
  try { st = await stat(f); } catch { return new Response("Niet gevonden", { status: 404 }); }
  const headers = { "content-type": contentType, "accept-ranges": "bytes", "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" };
  if (download) headers["content-disposition"] = `attachment; filename="${download.replace(/[^a-z0-9._-]/gi, "_")}"`;
  const range = request.headers.get("range");
  const m = range && range.match(/^bytes=(\d*)-(\d*)$/);
  if (m) {
    let start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
    if (!m[1]) end = st.size - 1;
    if (start < 0 || start >= st.size || end < start) return new Response(null, { status: 416, headers: { "content-range": `bytes */${st.size}` } });
    end = Math.min(end, st.size - 1);
    return new Response(streamOf(f, start, end), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${st.size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(streamOf(f), { status: 200, headers: { ...headers, "content-length": String(st.size) } });
}

function streamOf(file, start, end) {
  const s = createReadStream(file, start != null ? { start, end } : {});
  return new ReadableStream({
    start(c) { s.on("data", d => c.enqueue(new Uint8Array(d))); s.on("end", () => c.close()); s.on("error", e => c.error(e)); },
    cancel() { s.destroy(); },
  });
}

export async function readLocal(key) {
  assertKey(key);
  return readFile(path.join(localDir(), key));
}
