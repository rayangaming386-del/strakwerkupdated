// Runtime-laag: dezelfde servercode draait in Node (lokaal, tests, render-worker) en in
// Cloudflare Workers (productie). Verschillen die hier worden opgevangen:
// - Workers mag geen netwerkverbindingen (databasepool) delen tussen verzoeken: per verzoek
//   (of per cron-run) een eigen pool, die na afloop netjes wordt gesloten.
// - Werk na het antwoord (waitUntil) loopt via de context van Cloudflare.
// - Bindingen zoals Hyperdrive of de eigen service-binding staan niet in process.env.
import { AsyncLocalStorage } from "node:async_hooks";

export const isWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
/** Serverloos (geen lokale schijf, geen langlopende processen): Cloudflare of Vercel. */
export const isServerless = () => isWorkers || Boolean(process.env.VERCEL);

const als = new AsyncLocalStorage();
export const store = () => als.getStore() || null;
export const bindings = () => store()?.env || {};

/** Maximale looptijd van één taak in deze runtime (Workers: werk na het antwoord max. 30 s). */
export const maxTaskMs = () => (isWorkers ? 24_000 : Infinity); // net onder het budget van 25 s per aanroep

/**
 * Voert fn uit binnen een eigen verzoekcontext. Na afloop (ook van alle waitUntil-werk)
 * wordt de databasepool van dit verzoek gesloten.
 */
export async function runRequest({ env = {}, ctx = null } = {}, fn) {
  const s = { env, ctx, pool: null, pending: [] };
  let out;
  try {
    out = await als.run(s, fn);
  } finally {
    const done = drain(s);
    if (ctx?.waitUntil) ctx.waitUntil(done); else await done;
  }
  return out;
}

async function drain(s) {
  while (s.pending.length) await Promise.allSettled(s.pending.splice(0));
  if (s.pool) { const p = s.pool; s.pool = null; await p.end().catch(() => {}); }
}

/** Werk na het antwoord. In Node wordt het gewoon gestart (de functie blijft leven). */
export function waitUntil(promise) {
  const p = Promise.resolve(promise).catch((e) => console.error(`[achtergrond] ${e?.message || e}`));
  const s = store();
  if (s) { s.pending.push(p); s.ctx?.waitUntil?.(p); }
  return p;
}
