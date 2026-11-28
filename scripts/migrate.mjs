#!/usr/bin/env node
// Voert de SQL-migraties in db/migrations uit, elk precies één keer, in een transactie.
// Gebruik: DATABASE_URL=postgres://... npm run migrate
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { sslFor } from "../api/_lib/db.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

export async function migrate(connectionString, { log = console.log } = {}) {
  const client = new pg.Client({ connectionString, ssl: sslFor(connectionString) });
  await client.connect();
  try {
    await client.query("create table if not exists public.hq_schema_migrations (name text primary key, applied_at timestamptz not null default now())");
    await client.query("alter table public.hq_schema_migrations enable row level security");
    const done = new Set((await client.query("select name from public.hq_schema_migrations")).rows.map(r => r.name));
    const files = (await readdir(dir)).filter(f => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into public.hq_schema_migrations (name) values ($1)", [f]);
        await client.query("commit");
        log(`✓ ${f}`);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`Migratie ${f} mislukt: ${e.message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cs = process.env.DATABASE_URL;
  if (!cs) { console.error("DATABASE_URL ontbreekt."); process.exit(1); }
  migrate(cs).then(() => console.log("Migraties bijgewerkt."), e => { console.error(e.message); process.exit(1); });
}
