#!/usr/bin/env node
// Maakt docs/hq/livegang/migraties.sql: alle migraties in één bestand voor de SQL-editor van
// Supabase (als er geen terminal is). Slaat migraties over die al zijn uitgevoerd (dezelfde
// administratie als npm run migrate: public.hq_schema_migrations), dus veilig om te herhalen.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "db", "migrations");
const files = readdirSync(dir).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();
let out = `-- StrakWerk HQ: alle databasemigraties (${files.join(", ")}).
-- Plak dit volledige bestand in Supabase › SQL Editor en klik Run. Veilig om opnieuw te draaien:
-- uitgevoerde migraties worden overgeslagen. Gemaakt door scripts/sql-bundle.mjs; niet met de hand aanpassen.
create table if not exists public.hq_schema_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.hq_schema_migrations enable row level security;
`;
for (const f of files) {
  const sql = readFileSync(path.join(dir, f), "utf8");
  if (sql.includes("$hqmig$")) throw new Error(`${f} bevat $hqmig$`);
  out += `\n-- ── ${f} ──\ndo $hqdo$ begin\n  if not exists (select 1 from public.hq_schema_migrations where name = '${f}') then\n    execute $hqmig$\n${sql}\n$hqmig$;\n    insert into public.hq_schema_migrations (name) values ('${f}');\n    raise notice 'Uitgevoerd: ${f}';\n  else\n    raise notice 'Al gedaan: ${f}';\n  end if;\nend $hqdo$;\n`;
}
out += `\nselect name, applied_at from public.hq_schema_migrations order by name;\n`;
writeFileSync(path.join(root, "docs", "hq", "livegang", "migraties.sql"), out);
console.log(`docs/hq/livegang/migraties.sql: ${files.length} migraties`);
