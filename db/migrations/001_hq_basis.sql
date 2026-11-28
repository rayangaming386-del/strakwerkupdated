-- StrakWerk HQ: basisschema.
-- Alles staat in het eigen schema "hq" (niet in "public"), zodat de Supabase Data API
-- (PostgREST, met de publieke sleutel) er niet bij kan. Daarnaast staat RLS aan op elke
-- tabel zonder policies: ook als het schema per ongeluk wordt blootgesteld, levert de
-- publieke sleutel niets op. De server praat rechtstreeks met Postgres (DATABASE_URL).

create extension if not exists pgcrypto;
create schema if not exists hq;

-- ── Toegang ──────────────────────────────────────────────────────────────
create table hq.members (
  user_id      uuid primary key,                -- id uit Supabase Auth (auth.users.id)
  email        text not null,
  role         text not null check (role in ('eigenaar','medewerker','alleen_lezen')),
  status       text not null default 'uitgenodigd' check (status in ('uitgenodigd','actief','geblokkeerd')),
  invited_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index members_email_uq on hq.members (lower(email));

create table hq.audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_label text,                               -- e-mail of "systeem"/"agent:scout"
  action      text not null,
  entity      text,
  entity_id   text,
  details     jsonb not null default '{}'::jsonb
);
create index audit_log_at_idx on hq.audit_log (at desc);

create table hq.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ── Bezoekersstatistiek (eigen, privacyvriendelijke bron) ────────────────
-- Dagzout: wordt elke dag nieuw aangemaakt en na 2 dagen verwijderd. Zonder zout is een
-- bezoekershash niet meer te herleiden of over dagen heen te koppelen.
create table hq.analytics_salts (
  day  date primary key,
  salt bytea not null
);

create table hq.analytics_events (
  id            bigserial primary key,
  event_id      uuid not null unique,             -- door de browser gemaakt: voorkomt dubbel tellen bij herhaald versturen
  at            timestamptz not null,             -- servertijd van ontvangst (browserklok wordt niet vertrouwd)
  env           text not null check (env in ('production','preview','test','development')),
  name          text not null,
  path          text not null,                    -- alleen het pad, zonder querystring of fragment
  referrer_host text,                             -- alleen de hostnaam van de verwijzer
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  device        text not null check (device in ('mobiel','tablet','desktop','onbekend')),
  visitor_hash  text,                             -- pseudoniem, per dag wisselend; na 31 dagen leeggemaakt
  props         jsonb not null default '{}'::jsonb -- alleen toegestane velden per event
);
create index analytics_events_env_at_idx on hq.analytics_events (env, at desc);
create index analytics_events_name_at_idx on hq.analytics_events (name, at desc);

-- Dagtotalen, zodat unieke bezoekers per dag behouden blijven nadat de hashes zijn gewist.
create table hq.analytics_daily (
  day       date not null,
  env       text not null,
  visitors  integer not null,
  pageviews integer not null,
  computed_at timestamptz not null default now(),
  primary key (day, env)
);

-- ── CRM ──────────────────────────────────────────────────────────────────
-- Pakketprijzen: alleen een eigenaar past ze aan, nooit een agent.
create table hq.packages (
  key         text primary key,
  name        text not null,
  price_cents integer not null check (price_cents >= 0),
  pitch       text not null default '',
  terms       text not null default '',
  active      boolean not null default true,
  sort        integer not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create table hq.leads (
  id             uuid primary key default gen_random_uuid(),
  company        text not null,
  company_key    text not null,                   -- genormaliseerde naam (dubbele leads voorkomen)
  website        text,
  domain         text,                            -- genormaliseerde host zonder www (dubbele leads voorkomen)
  source         text not null default 'handmatig',
  source_url     text,
  city           text,
  contact_name   text,
  contact_email  text,
  contact_phone  text,
  owner_user_id  uuid,
  status         text not null default 'nieuw' check (status in
                   ('nieuw','onderzocht','goedgekeurd','benaderd','gesprek','offerte','gewonnen','verloren')),
  next_action_at date,
  notes          text not null default '',
  lost_reason    text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index leads_domain_uq on hq.leads (domain) where domain is not null;
create unique index leads_company_uq on hq.leads (company_key) where domain is null;
create index leads_status_idx on hq.leads (status);

create table hq.lead_history (
  id          bigserial primary key,
  lead_id     uuid not null references hq.leads(id) on delete cascade,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_label text,
  from_status text,
  to_status   text,
  note        text
);

create table hq.quotes (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references hq.leads(id) on delete cascade,
  package_key text not null references hq.packages(key),
  price_cents integer not null,                   -- vastgelegd uit hq.packages op het moment van aanmaken
  terms       text not null,
  status      text not null default 'concept' check (status in ('concept','verstuurd','geaccepteerd','afgewezen','vervallen')),
  note        text not null default '',
  created_by  uuid,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  decided_at  timestamptz
);

-- Daadwerkelijk ontvangen omzet: alleen handmatig geregistreerd.
create table hq.payments (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references hq.leads(id) on delete cascade,
  quote_id     uuid references hq.quotes(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  received_on  date not null,
  note         text not null default '',
  created_by   uuid,
  created_at   timestamptz not null default now()
);

-- ── Agents en taken ──────────────────────────────────────────────────────
create table hq.agents (
  key        text primary key,
  name       text not null,
  title      text not null,
  zone       text not null check (zone in ('acquisitie','sales','content','ontwikkeling','analyse')),
  mission    text not null,
  sort       integer not null default 0
);

create table hq.tasks (
  id              uuid primary key default gen_random_uuid(),
  agent_key       text not null references hq.agents(key),
  kind            text not null,
  lead_id         uuid references hq.leads(id) on delete set null,
  chain_id        uuid not null,
  parent_task_id  uuid references hq.tasks(id) on delete set null,
  status          text not null default 'in_wachtrij' check (status in
                    ('in_wachtrij','bezig','wacht_op_goedkeuring','afgerond','gepauzeerd','mislukt','geannuleerd')),
  control         text check (control in ('pauze_gevraagd','annulering_gevraagd')),
  title           text not null,
  input           jsonb not null default '{}'::jsonb,
  result          jsonb,
  error           text,
  attempts        integer not null default 0,
  max_attempts    integer not null default 2,
  timeout_s       integer not null default 45,
  run_after       timestamptz not null default now(),
  lease_owner     text,
  lease_until     timestamptz,
  idempotency_key text unique,
  cost_usd        numeric(12,6) not null default 0,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  steps           integer not null default 0,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
create index tasks_status_idx on hq.tasks (status, run_after);
create index tasks_agent_idx on hq.tasks (agent_key, updated_at desc);
create index tasks_chain_idx on hq.tasks (chain_id);

-- Elke uitvoeringspoging krijgt een eigen id.
create table hq.task_runs (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references hq.tasks(id) on delete cascade,
  attempt     integer not null,
  worker_id   text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  outcome     text check (outcome in ('afgerond','wacht_op_goedkeuring','mislukt','time_out','geannuleerd','gepauzeerd','opnieuw')),
  error       text,
  cost_usd    numeric(12,6) not null default 0,
  unique (task_id, attempt)
);

create table hq.task_events (
  id          bigserial primary key,
  task_id     uuid not null references hq.tasks(id) on delete cascade,
  at          timestamptz not null default now(),
  type        text not null check (type in ('status','overdracht','stap','fout','kosten','besturing')),
  from_status text,
  to_status   text,
  from_agent  text,
  to_agent    text,
  message     text not null default '',
  data        jsonb not null default '{}'::jsonb
);
create index task_events_at_idx on hq.task_events (at desc);
create index task_events_task_idx on hq.task_events (task_id, at);

create table hq.approvals (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('onderzoek','bericht','offerte')),
  task_id        uuid references hq.tasks(id) on delete set null,
  lead_id        uuid references hq.leads(id) on delete cascade,
  status         text not null default 'open' check (status in ('open','goedgekeurd','afgewezen','vervallen')),
  title          text not null,
  proposal       jsonb not null,                  -- het exacte voorstel zoals de agent het maakte
  proposal_hash  text not null,
  rationale      jsonb not null default '{}'::jsonb,
  final_proposal jsonb,                           -- wat werkelijk is goedgekeurd (eventueel aangepast)
  final_hash     text,
  edited         boolean not null default false,
  requested_at   timestamptz not null default now(),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  used_at        timestamptz                      -- een goedkeuring geldt één keer, voor deze exacte actie
);
create index approvals_status_idx on hq.approvals (status, requested_at desc);

-- Ervaringspunten: alleen voor afgeronde taken waarvan het resultaat is goedgekeurd.
create table hq.xp_ledger (
  id          bigserial primary key,
  agent_key   text not null references hq.agents(key),
  task_id     uuid not null references hq.tasks(id) on delete cascade,
  approval_id uuid not null references hq.approvals(id) on delete cascade,
  points      integer not null check (points > 0),
  reason      text not null,
  at          timestamptz not null default now(),
  unique (agent_key, task_id)
);

-- ── Afscherming ──────────────────────────────────────────────────────────
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'hq' loop
    execute format('alter table hq.%I enable row level security', t.tablename);
  end loop;
  -- Supabase-rollen (bestaan alleen op Supabase) krijgen geen toegang tot het schema.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema hq from anon';
    execute 'revoke all on all tables in schema hq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema hq from authenticated';
    execute 'revoke all on all tables in schema hq from authenticated';
  end if;
end $$;
