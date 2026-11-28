import pg from "pg";
import { env } from "./env.js";

// Eén kleine pool per functie-instantie. Gebruik op Supabase de "transaction pooler"
// (poort 6543) als DATABASE_URL: serverless functies openen anders te veel verbindingen.
let pool = null;

export function sslFor(cs) {
  if (/localhost|127\.0\.0\.1|sslmode=disable/.test(cs || "")) return false;
  if (env.databaseCa) return { ca: env.databaseCa.replace(/\\n/g, "\n"), rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

export function getPool() {
  if (!env.databaseUrl) {
    const err = new Error("Database niet gekoppeld: DATABASE_URL ontbreekt.");
    err.status = 503; err.code = "niet_gekoppeld"; err.missing = ["DATABASE_URL"];
    throw err;
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: env.databaseUrl,
      ssl: sslFor(env.databaseUrl),
      max: Number(process.env.HQ_DB_POOL_MAX || 3),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      statement_timeout: 15_000,
    });
    pool.on("error", () => {}); // losse verbindingsfouten niet laten crashen; de volgende query meldt het
  }
  return pool;
}

export async function q(text, params = []) {
  return getPool().query(text, params);
}

export async function one(text, params = []) {
  return (await q(text, params)).rows[0] ?? null;
}

export async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    try { await client.query("rollback"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) { const p = pool; pool = null; await p.end(); }
}

export async function audit(db, { actor = null, label = null, action, entity = null, entityId = null, details = {} }) {
  await (db || getPool()).query(
    "insert into hq.audit_log (actor, actor_label, action, entity, entity_id, details) values ($1,$2,$3,$4,$5,$6)",
    [actor, label, action, entity, entityId == null ? null : String(entityId), details]
  );
}
