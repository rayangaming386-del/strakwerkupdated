-- StrakWerk HQ: alle databasemigraties (001_hq_basis.sql, 002_hq_startgegevens.sql, 003_contentstudio.sql, 004_kantoor_zelfstandig.sql, 005_klanten_winnen.sql).
-- Plak dit volledige bestand in Supabase › SQL Editor en klik Run. Veilig om opnieuw te draaien:
-- uitgevoerde migraties worden overgeslagen. Gemaakt door scripts/sql-bundle.mjs; niet met de hand aanpassen.
create table if not exists public.hq_schema_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.hq_schema_migrations enable row level security;

-- ── 001_hq_basis.sql ──
do $hqdo$ begin
  if not exists (select 1 from public.hq_schema_migrations where name = '001_hq_basis.sql') then
    execute $hqmig$
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

$hqmig$;
    insert into public.hq_schema_migrations (name) values ('001_hq_basis.sql');
    raise notice 'Uitgevoerd: 001_hq_basis.sql';
  else
    raise notice 'Al gedaan: 001_hq_basis.sql';
  end if;
end $hqdo$;

-- ── 002_hq_startgegevens.sql ──
do $hqdo$ begin
  if not exists (select 1 from public.hq_schema_migrations where name = '002_hq_startgegevens.sql') then
    execute $hqmig$
-- Startgegevens. Pakketprijzen komen uit CONFIG.bases in index.html (stand november 2026).
-- Voorwaarden blijven leeg tot de eigenaar ze invult: zonder voorwaarden kan geen offerte worden gemaakt.
insert into hq.packages (key, name, price_cents, pitch, terms, sort) values
  ('nieuw',    'Starter',  20000, 'Complete website tot 3 pagina''s', '', 1),
  ('premium',  'Premium',  35000, 'Zelf aanpassen, aanvragen via WhatsApp en vindbaar in Google', '', 2),
  ('pro',      'Pro',      50000, 'Geavanceerd beheer, extra taal, blog, logo en regiopagina''s', '', 3),
  ('redesign', 'Redesign', 17500, 'Je bestaande site strak vernieuwd', '', 4)
on conflict (key) do nothing;

insert into hq.agents (key, name, title, zone, mission, sort) values
  ('scout',    'Scout',    'Leadonderzoek',      'acquisitie',   'Controleert ingevoerde bedrijven via hun eigen openbare website en legt bronlinks, controleerbare bedrijfsinformatie en de reden van relevantie vast.', 1),
  ('auditor',  'Auditor',  'Website-analyse',    'analyse',      'Meet publieke websites op concrete verbeterpunten. Scheidt gemeten feiten van interpretaties. Geen indringende beveiligingsscans.', 2),
  ('sales',    'Sales',    'Berichtconcepten',   'sales',        'Schrijft persoonlijke berichtconcepten op basis van goedgekeurde bedrijfsinformatie. Verzint geen prijzen, afspraken of klantbehoeften.', 3),
  ('rank',     'Rank',     'SEO-kansen',         'content',      'Onderzoekt SEO-kansen en bereidt inhoudelijk nuttige verbeteringen voor. Geen bulkproductie van regiopagina''s.', 4),
  ('content',  'Content',  'Content en cases',   'content',      'Maakt content en cases uit goedgekeurde input. Geen verzonnen reviews, resultaten of claims.', 5),
  ('insights', 'Insights', 'Data-analyse',       'analyse',      'Analyseert echte bezoekers- en CRM-data en benoemt onzekerheid.', 6),
  ('builder',  'Builder',  'Codewijzigingen',    'ontwikkeling', 'Bereidt codewijzigingen voor op een aparte branch, met tests en een wijzigingsoverzicht.', 7),
  ('care',     'Care',     'Klantzorg',          'sales',        'Bewaakt klantvragen, onderhoud en vervolgacties. Legt commerciële voorstellen eerst ter beoordeling voor.', 8)
on conflict (key) do nothing;

insert into hq.settings (key, value) values
  ('limits', '{"max_concurrent": 2, "task_timeout_s": 45, "max_steps": 8, "max_attempts": 2, "max_cost_usd_per_task": 0.25, "daily_budget_usd": 2.0}'::jsonb),
  ('recurring', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;

$hqmig$;
    insert into public.hq_schema_migrations (name) values ('002_hq_startgegevens.sql');
    raise notice 'Uitgevoerd: 002_hq_startgegevens.sql';
  else
    raise notice 'Al gedaan: 002_hq_startgegevens.sql';
  end if;
end $hqdo$;

-- ── 003_contentstudio.sql ──
do $hqdo$ begin
  if not exists (select 1 from public.hq_schema_migrations where name = '003_contentstudio.sql') then
    execute $hqmig$
-- StrakWerk HQ: klantprojecten, contentstudio, renders, publicaties, automatisering en
-- campagneherkomst. Bouwt voort op 001/002 (leads, offertes, takenwachtrij, agents).

-- ── Klantprojecten (traject: aanvraag → offerte → akkoord → intake → websitecontrole →
--    oplevering → contentcampagne → nazorg). Een project hoort bij één lead/klant.
create table hq.projects (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  lead_id       uuid references hq.leads(id) on delete set null,
  status        text not null default 'intake' check (status in ('akkoord','intake','in_aanbouw','websitecontrole','opgeleverd','nazorg','gestopt')),
  sector        text,
  city          text,
  live_url      text,
  summary       text not null default '',          -- echte projectinformatie (geen resultaten of claims)
  features      jsonb not null default '[]'::jsonb, -- wat er echt gebouwd is
  source        text not null default 'handmatig' check (source in ('handmatig','portfolio','offerte')),
  delivered_at  timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index projects_lead_uq on hq.projects (lead_id) where lead_id is not null;

create table hq.project_history (
  id          bigserial primary key,
  project_id  uuid not null references hq.projects(id) on delete cascade,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_label text,
  from_status text,
  to_status   text,
  note        text
);

-- Beeldmateriaal per project. Alleen social_ok = true mag in content voor social media.
create table hq.project_assets (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references hq.projects(id) on delete cascade,
  path         text not null,                      -- bv. /assets/work/glow.webp
  kind         text not null check (kind in ('desktop','mobiel','foto','logo')),
  label        text not null default '',
  alt          text not null default '',
  width        integer,
  height       integer,
  social_ok    boolean not null default false,
  released_by  uuid,
  released_at  timestamptz,
  notes        text not null default '',           -- bv. "toont een actie van de klant t/m 1 januari"
  valid_until  timestamptz,                        -- na deze datum niet meer publiceren
  created_at   timestamptz not null default now(),
  unique (project_id, path)
);

-- ── Formats en contentstukken ──────────────────────────────────────────────
create table hq.content_formats (
  key          text primary key,
  name         text not null,
  description  text not null default '',
  released     boolean not null default false,    -- vrijgegeven voor automatisch maken
  released_by  uuid,
  released_at  timestamptz,
  sort         integer not null default 0
);

create table hq.content_pieces (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references hq.projects(id) on delete cascade,
  format_key      text not null references hq.content_formats(key),
  audience        text not null,
  goal            text not null check (goal in ('aanvragen','bekendheid','portfolio')),
  asset_ids       uuid[] not null default '{}',
  origin          text not null default 'handmatig' check (origin in ('handmatig','oplevering','automatisering')),
  origin_key      text unique,                     -- voorkomt dubbele opdrachten bij herhaalde triggers
  status          text not null default 'plannen' check (status in ('plannen','kiezen','concept','goedgekeurd','gearchiveerd')),
  plan_task_id    uuid references hq.tasks(id) on delete set null,
  angles          jsonb,                           -- drie voorstellen van de planner
  angle_index     integer,
  script          jsonb,                           -- gekozen script (scènes, captions, cta)
  script_original jsonb,                           -- om één scène terug te zetten
  script_version  integer not null default 0,
  approved_render_id uuid,
  approved_by     uuid,
  approved_at     timestamptz,
  campaign_code   text not null unique,            -- utm_campaign en herkenning
  keyword         text,                            -- WhatsApp-zoekwoord (bv. SALON)
  automation_id   uuid,
  title           text not null default '',
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index content_pieces_status_idx on hq.content_pieces (status, updated_at desc);

create table hq.renders (
  id           uuid primary key default gen_random_uuid(),
  piece_id     uuid not null references hq.content_pieces(id) on delete cascade,
  version      integer not null,
  status       text not null default 'in_wachtrij' check (status in ('in_wachtrij','bezig','klaar','mislukt','geannuleerd')),
  script       jsonb not null,                     -- exacte snapshot die gerenderd is
  script_hash  text not null,
  task_id      uuid references hq.tasks(id) on delete set null,
  video_key    text,
  cover_key    text,
  duration_s   numeric(6,2),
  width        integer,
  height       integer,
  bytes        bigint,
  render_ms    integer,
  error        text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  unique (piece_id, version)
);

-- Publicatie per kanaal, los van de renderstatus.
create table hq.publications (
  id                   uuid primary key default gen_random_uuid(),
  piece_id             uuid not null references hq.content_pieces(id) on delete cascade,
  render_id            uuid not null references hq.renders(id) on delete restrict,
  channel              text not null check (channel in ('instagram','tiktok')),
  method               text not null check (method in ('api','export')),
  status               text not null default 'ingepland' check (status in ('ingepland','bezig','gepubliceerd','mislukt','onzeker','export_klaar','handmatig_geplaatst','geannuleerd')),
  scheduled_at         timestamptz,
  caption              text not null,
  caption_hash         text not null,
  task_id              uuid references hq.tasks(id) on delete set null,
  external_container_id text,
  external_id          text,                       -- bevestigd post-ID van de provider
  permalink            text,
  attempts             integer not null default 0,
  last_error           text,
  last_checked_at      timestamptz,
  published_at         timestamptz,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- Eén actieve publicatie per stuk per kanaal: voorkomt dubbel inplannen.
create unique index publications_active_uq on hq.publications (piece_id, channel) where status <> 'geannuleerd';
create unique index publications_external_uq on hq.publications (channel, external_id) where external_id is not null;

-- Gemeten of handmatig ingevoerde resultaten per publicatie. Ontbreekt een rij: onbekend.
create table hq.content_metrics (
  id             bigserial primary key,
  publication_id uuid not null references hq.publications(id) on delete cascade,
  metric         text not null check (metric in ('views','reach','likes','comments','shares','saves')),
  value          integer not null check (value >= 0),
  source         text not null check (source in ('instagram_api','handmatig')),
  measured_at    timestamptz not null default now(),
  unique (publication_id, metric, source)
);

-- Automatisering per kanaal en format.
create table hq.content_automations (
  id           uuid primary key default gen_random_uuid(),
  channel      text not null check (channel in ('instagram','tiktok')),
  format_key   text not null references hq.content_formats(key),
  enabled      boolean not null default false,
  weekly_limit integer not null default 1 check (weekly_limit between 0 and 7),
  weekdays     integer[] not null default '{2,4}',  -- 1 = maandag … 7 = zondag (Europe/Amsterdam)
  post_time    text not null default '18:30' check (post_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  audience     text not null default 'ondernemers',
  goal         text not null default 'aanvragen',
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  unique (channel, format_key)
);

-- Externe koppelingen (Instagram). Tokens versleuteld (AES-256-GCM met HQ_ENCRYPTION_KEY).
create table hq.integrations (
  key          text primary key,                   -- 'instagram'
  account_id   text,
  account_name text,
  token_enc    text,
  expires_at   timestamptz,
  scopes       text,
  connected_by uuid,
  connected_at timestamptz,
  updated_at   timestamptz not null default now()
);

-- Campagneherkomst op de lead: via campagnelink, WhatsApp-zoekwoord of handmatig.
alter table hq.leads add column campaign_piece_id uuid references hq.content_pieces(id) on delete set null;
alter table hq.leads add column campaign_via text check (campaign_via in ('link','whatsapp_woord','handmatig'));

-- Goedkeuringen: ook voor content.
alter table hq.approvals drop constraint approvals_kind_check;
alter table hq.approvals add constraint approvals_kind_check check (kind in ('onderzoek','bericht','offerte','content'));

-- Takenwachtrij: een taak kan bij een contentstuk horen.
alter table hq.tasks add column piece_id uuid references hq.content_pieces(id) on delete cascade;
create index tasks_piece_idx on hq.tasks (piece_id) where piece_id is not null;

-- ── Startgegevens ─────────────────────────────────────────────────────────
insert into hq.agents (key, name, title, zone, mission, sort) values
  ('video',     'Video',     'Videomaker',  'content', 'Rendert verticale video''s (1080×1920) uit een goedgekeurd script, met alleen vrijgegeven projectbeelden in hun oorspronkelijke verhouding.', 9),
  ('publisher', 'Publisher', 'Publicatie',  'content', 'Plaatst goedgekeurde video''s op het afgesproken moment via officiële koppelingen. Voorkomt dubbele posts en controleert eerst bij twijfel.', 10)
on conflict (key) do nothing;
update hq.agents set mission = 'Stelt per project drie verkoophoeken voor met openingszin, scènes, beelden en één oproep tot actie. Alleen echte projectinformatie; geen verzonnen reviews, resultaten of voor-en-na.' where key = 'content';

insert into hq.content_formats (key, name, description, sort) values
  ('project_reel', 'Projectvideo (Reel/TikTok)', 'Verticale video van 15–25 s over één opgeleverd project, gericht op één doelgroep en één oproep tot actie.', 1)
on conflict (key) do nothing;

insert into hq.settings (key, value) values
  ('content', '{"paused": false, "monthly_budget_usd": 5.0, "max_cost_per_video_usd": 0.5, "render_cost_usd_per_min": 0, "min_hours_ahead": 24}'::jsonb)
on conflict (key) do nothing;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'hq' loop
    execute format('alter table hq.%I enable row level security', t.tablename);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema hq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema hq from authenticated';
  end if;
end $$;

$hqmig$;
    insert into public.hq_schema_migrations (name) values ('003_contentstudio.sql');
    raise notice 'Uitgevoerd: 003_contentstudio.sql';
  else
    raise notice 'Al gedaan: 003_contentstudio.sql';
  end if;
end $hqdo$;

-- ── 004_kantoor_zelfstandig.sql ──
do $hqdo$ begin
  if not exists (select 1 from public.hq_schema_migrations where name = '004_kantoor_zelfstandig.sql') then
    execute $hqmig$
-- StrakWerk HQ: zelfstandig kantoor.
-- 1. StrakWerk is de afzender: contentstukken en beelden kunnen zonder klantproject bestaan
--    (eigen schermopnames en schermafbeeldingen van strakwerkk.nl).
-- 2. Eén centraal AI-budget voor alle afdelingen, met reserveringen vóór elke aanroep.
-- 3. Publicatieroutes per kanaal (Instagram API, Buffer, export) en extra statussen.

-- ── Merk-campagnes zonder klantproject ─────────────────────────────────────
alter table hq.content_pieces alter column project_id drop not null;
alter table hq.content_pieces add column kind text not null default 'portfolio' check (kind in ('merk','portfolio'));
alter table hq.content_pieces add column topic_key text;
alter table hq.content_pieces add column slot_at timestamptz;          -- gepland publicatiemoment (alle kanalen)
create index content_pieces_slot_idx on hq.content_pieces (slot_at) where slot_at is not null;

alter table hq.project_assets alter column project_id drop not null;   -- null = eigen materiaal van StrakWerk
alter table hq.project_assets drop constraint project_assets_kind_check;
alter table hq.project_assets add constraint project_assets_kind_check check (kind in ('desktop','mobiel','foto','logo','video'));
alter table hq.project_assets add column duration_s numeric(6,2);
create unique index project_assets_brand_uq on hq.project_assets (path) where project_id is null;

-- ── Publicatieroutes ─────────────────────────────────────────────────────
alter table hq.publications drop constraint publications_method_check;
alter table hq.publications add constraint publications_method_check check (method in ('api','buffer','export'));
alter table hq.publications drop constraint publications_status_check;
alter table hq.publications add constraint publications_status_check check (status in (
  'ingepland',          -- wacht op het moment van aanleveren
  'bezig',              -- wordt aangeleverd
  'bij_dienst',         -- aangenomen door de publicatiedienst, nog niet bevestigd geplaatst
  'wachtrij_vol',       -- wachtrij van de dienst vol: HQ bewaart de post en probeert later opnieuw
  'gepubliceerd',       -- bevestigd door platform of dienst
  'mislukt', 'onzeker', 'export_klaar', 'handmatig_geplaatst', 'geannuleerd',
  'concept_klaar'));    -- proefrun: alles klaar, niet live geplaatst (live publicatie staat uit)
alter table hq.publications add column live boolean not null default false;

-- ── AI-budget ──────────────────────────────────────────────────────────────
-- Vóór elke taalmodelaanroep wordt de maximale prijs gereserveerd. Na afloop wordt de
-- gemeten prijs vastgelegd. Reserveringen + vastgelegde kosten mogen de HQ-limiet van de
-- tegoedperiode nooit overschrijden, ook niet als meerdere taken tegelijk draaien.
create table hq.ai_reservations (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references hq.tasks(id) on delete set null,
  department  text not null check (department in ('marketing','scout','auditor','sales','overig')),
  max_usd     numeric(12,6) not null check (max_usd >= 0),
  actual_usd  numeric(12,6),
  status      text not null default 'gereserveerd' check (status in ('gereserveerd','verrekend','vrijgegeven')),
  model       text,
  note        text,
  created_at  timestamptz not null default now(),
  settled_at  timestamptz
);
create index ai_reservations_created_idx on hq.ai_reservations (created_at);

alter table hq.tasks add column pause_reason text;
alter table hq.renders add column subtitles_key text;

insert into hq.settings (key, value) values
  ('ai_budget', '{"enabled": false, "confirmed": false, "granted_usd": null, "hq_limit_usd": null, "period_start": null, "period_end": null, "paused_reason": null, "console_used_usd": null}'::jsonb),
  ('marketing', '{"enabled": false, "weekly_limit": 3, "weekdays": [1,3,5], "post_time": "18:30", "audiences": ["ondernemers"], "goals": ["aanvragen"], "portfolio_every": 3, "lead_days": 2, "live_publishing": false,
     "channels": {"instagram": {"enabled": true, "mode": "review", "route": "export"}, "tiktok": {"enabled": true, "mode": "review", "route": "export"}}}'::jsonb),
  ('brand', '{"socials": {"instagram": "", "tiktok": ""}, "buffer_channels": {"instagram": "", "tiktok": ""}}'::jsonb)
on conflict (key) do nothing;

insert into hq.content_formats (key, name, description, sort) values
  ('merk_reel', 'StrakWerk-video', 'Verticale video van 15–25 s over het aanbod van StrakWerk zelf (prijzen, configurator, pakketten), met eigen beelden.', 0)
on conflict (key) do nothing;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'hq' loop
    execute format('alter table hq.%I enable row level security', t.tablename);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on all tables in schema hq from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on all tables in schema hq from authenticated'; end if;
end $$;

$hqmig$;
    insert into public.hq_schema_migrations (name) values ('004_kantoor_zelfstandig.sql');
    raise notice 'Uitgevoerd: 004_kantoor_zelfstandig.sql';
  else
    raise notice 'Al gedaan: 004_kantoor_zelfstandig.sql';
  end if;
end $hqdo$;

-- ── 005_klanten_winnen.sql ──
do $hqdo$ begin
  if not exists (select 1 from public.hq_schema_migrations where name = '005_klanten_winnen.sql') then
    execute $hqmig$
-- StrakWerk HQ: klanten winnen. Eén klantkaart (hq.leads) met gedeelde geschiedenis voor
-- alle afdelingen: gesprekken, contactgronden, afmeldingen, berichten, kansen, offertes,
-- afspraken, projecten, betalingen en resultaten. Commerciële status (leads.status) en
-- projectvoortgang (projects.status) blijven gescheiden.

-- ── Klantkaart ─────────────────────────────────────────────────────────────
alter table hq.leads drop constraint leads_status_check;
alter table hq.leads add constraint leads_status_check check (status in
  ('nieuw','onderzocht','goedgekeurd','benaderd','aanvraag','gekwalificeerd','gesprek','afspraak','offerte','gewonnen','verloren','afgemeld'));
alter table hq.leads add column segment text;                     -- bv. salons, autobedrijven, dienstverleners
alter table hq.leads add column website_status text check (website_status in ('gevonden','alleen_sociaal','onzeker','geen_gevonden'));
alter table hq.leads add column website_checks jsonb not null default '[]'::jsonb;   -- welke controles, met uitkomst
alter table hq.leads add column social_url text;
alter table hq.leads add column active_status text check (active_status in ('actief','onzeker','gesloten'));
alter table hq.leads add column fit_score integer;                 -- 0–100, gewone code (zie scout-regels)
alter table hq.leads add column priority text check (priority in ('hoog','middel','laag'));
alter table hq.leads add column priority_reason text;
alter table hq.leads add column need_summary text;                 -- behoefte in eigen woorden (Sales)
alter table hq.leads add column missing_info jsonb not null default '[]'::jsonb;
alter table hq.leads add column qualified_at timestamptz;
alter table hq.leads add column qualification jsonb;               -- waarom wel/niet gekwalificeerd
alter table hq.leads add column awaiting_reply_since timestamptz;  -- klant wacht op ons
alter table hq.leads add column last_inbound_at timestamptz;
alter table hq.leads add column last_outbound_at timestamptz;
alter table hq.leads add column referral_lead_id uuid references hq.leads(id) on delete set null;
alter table hq.leads add column referral_partner_id uuid;
alter table hq.leads add column source_detail jsonb not null default '{}'::jsonb;   -- utm, pagina, verwijzer, hoe vastgesteld
alter table hq.leads add column osm_id text;                       -- bron OpenStreetMap (bij ontdekken)
alter table hq.leads add column is_test boolean not null default false;
create unique index leads_osm_uq on hq.leads (osm_id) where osm_id is not null;
create index leads_email_idx on hq.leads (lower(contact_email)) where contact_email is not null;

-- Elk contactmoment (in en uit) op één tijdlijn.
create table hq.interactions (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references hq.leads(id) on delete cascade,
  at             timestamptz not null default now(),
  direction      text not null check (direction in ('in','uit','intern')),
  channel        text not null check (channel in ('formulier','email','whatsapp','telefoon','gesprek','notitie','systeem')),
  kind           text not null check (kind in ('aanvraag','bericht','antwoord','afmelding','bezwaar','bounce','afspraak','probleem','wens','notitie','review')),
  classification text check (classification in ('interesse','vraag','later','afwijzing','afmelding','onbekend')),
  subject        text,
  body           text not null default '',
  summary        text,
  external_id    text,                       -- message-id of formulier-id: voorkomt dubbele verwerking
  outreach_id    uuid,
  quote_id       uuid,
  is_test        boolean not null default false,
  created_by     uuid,
  created_label  text
);
create unique index interactions_external_uq on hq.interactions (external_id) where external_id is not null;
create index interactions_lead_idx on hq.interactions (lead_id, at desc);

-- Contactgrond per kanaal: zonder geldige grond geen automatisch contact.
create table hq.consents (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references hq.leads(id) on delete cascade,
  channel     text not null check (channel in ('email','whatsapp','telefoon')),
  basis       text not null check (basis in ('toestemming','zelf_contact_gezocht','bestaande_klant','gerechtvaardigd_belang_zakelijk')),
  source      text not null,            -- waar vandaan (bv. formulier op strakwerkk.nl, mail van 12-11)
  scope       text not null,            -- waarvoor (bv. reactie op aanvraag, informatie over websites)
  evidence    text not null,            -- onderbouwing
  recorded_at timestamptz not null default now(),
  recorded_by uuid,
  revoked_at  timestamptz,
  revoke_reason text
);
create index consents_lead_idx on hq.consents (lead_id, channel);

-- Afmeldingen, bezwaren en onbestelbare adressen: gelden voor álle afdelingen.
create table hq.suppressions (
  id        uuid primary key default gen_random_uuid(),
  value     text not null,               -- e-mailadres, telefoon of domein (genormaliseerd)
  kind      text not null check (kind in ('email','telefoon','domein','lead')),
  reason    text not null check (reason in ('afmelding','bezwaar','bounce','handmatig')),
  lead_id   uuid references hq.leads(id) on delete set null,
  at        timestamptz not null default now(),
  note      text,
  unique (kind, value)
);

-- Berichten (acquisitie, opvolging, reviewverzoek, intakeherinnering, nazorg).
create table hq.outreach (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references hq.leads(id) on delete cascade,
  quote_id        uuid references hq.quotes(id) on delete set null,
  project_id      uuid references hq.projects(id) on delete set null,
  channel         text not null check (channel in ('email','whatsapp','telefoon')),
  kind            text not null check (kind in ('eerste_contact','opvolging','offerte_opvolging','antwoord','review_verzoek','intake_herinnering','nazorg','afspraak_bevestiging')),
  sequence        integer not null default 0,
  status          text not null default 'concept' check (status in ('concept','gepland','verzenden','verzonden','test_verzonden','klaar_handmatig','handmatig_verzonden','onzeker','geannuleerd','mislukt')),
  subject         text,
  body            text not null,
  to_address      text,
  scheduled_at    timestamptz,
  sent_at         timestamptz,
  provider_id     text,                 -- message-id van de verzending
  idempotency_key text unique,          -- één bericht per aanleiding
  cancel_reason   text,
  last_error      text,
  prompt_version  text,
  approved_by     uuid,
  approved_at     timestamptz,
  is_test         boolean not null default false,
  task_id         uuid references hq.tasks(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index outreach_due_idx on hq.outreach (status, scheduled_at);
create index outreach_lead_idx on hq.outreach (lead_id, created_at desc);

-- Concrete kansen (Auditor): exacte pagina, observatie, bewijs, sterkte, controle.
create table hq.opportunities (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references hq.leads(id) on delete cascade,
  task_id      uuid references hq.tasks(id) on delete set null,
  page_url     text,
  goal         text,                   -- wat de klant wil doen: diensten, afspraak, prijs, contact
  observation  text not null,
  evidence     jsonb not null default '{}'::jsonb,
  strength     text not null check (strength in ('concreet','zwak')),
  service_key  text,                   -- passende dienst van StrakWerk
  service_text text,
  verified     text not null default 'automatisch' check (verified in ('automatisch','klopt','klopt_niet')),
  verified_by  uuid,
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index opportunities_lead_idx on hq.opportunities (lead_id);

-- Offertes: omschrijving, onderdelen, benodigde informatie, vervolgstap, belangstelling.
alter table hq.quotes add column description text not null default '';
alter table hq.quotes add column items jsonb not null default '[]'::jsonb;        -- pakket + opties uit CONFIG
alter table hq.quotes add column extras jsonb not null default '[]'::jsonb;       -- buiten de prijslijst: vraagt goedkeuring
alter table hq.quotes add column info_needed jsonb not null default '[]'::jsonb;
alter table hq.quotes add column next_step text not null default '';
alter table hq.quotes add column interest boolean not null default false;         -- klant toonde belangstelling
alter table hq.quotes add column earliest_start date;                              -- op basis van capaciteit
alter table hq.quotes add column accepted_at timestamptz;
alter table hq.quotes add column is_test boolean not null default false;
alter table hq.quotes add column origin_key text;
create unique index quotes_origin_uq on hq.quotes (origin_key) where origin_key is not null;

alter table hq.payments add column is_test boolean not null default false;
alter table hq.payments add column method text not null default 'handmatig' check (method in ('handmatig','simulatie','bank'));

-- Afspraken; dubbele boekingen op hetzelfde moment zijn onmogelijk.
create table hq.appointments (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references hq.leads(id) on delete cascade,
  quote_id   uuid references hq.quotes(id) on delete set null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  kind       text not null default 'kennismaking' check (kind in ('kennismaking','intake','oplevering','nazorg')),
  status     text not null default 'gepland' check (status in ('gepland','gehouden','geannuleerd')),
  note       text not null default '',
  is_test    boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index appointments_slot_uq on hq.appointments (starts_at) where status = 'gepland';

-- Projectbeheer: afspraken uit de offerte, intake, briefing, feedback, oplevercontrole.
alter table hq.projects add column quote_id uuid references hq.quotes(id) on delete set null;
alter table hq.projects add column price_cents integer;
alter table hq.projects add column scope jsonb not null default '{}'::jsonb;
alter table hq.projects add column intake_token_hash text unique;
alter table hq.projects add column intake jsonb not null default '{}'::jsonb;
alter table hq.projects add column intake_complete_at timestamptz;
alter table hq.projects add column briefing jsonb;
alter table hq.projects add column briefing_at timestamptz;
alter table hq.projects add column check_task_id uuid references hq.tasks(id) on delete set null;
alter table hq.projects add column is_test boolean not null default false;

create table hq.project_feedback (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references hq.projects(id) on delete cascade,
  round       integer not null,
  at          timestamptz not null default now(),
  text        text not null,
  in_scope    boolean,                  -- null = nog niet beoordeeld
  scope_note  text,
  proposal    jsonb,                    -- voorstel voor Rayan als het buiten de afspraken valt
  status      text not null default 'open' check (status in ('open','verwerkt','voorstel','afgewezen')),
  created_by  uuid
);

-- Samenwerkingen en doorverwijzingen.
create table hq.partners (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          text not null check (kind in ('fotograaf','drukkerij','vormgever','ondernemer','klant','anders')),
  contact_name  text,
  contact_email text,
  contact_phone text,
  website       text,
  we_offer      text not null default '',
  they_offer    text not null default '',
  agreement     text not null default '',
  reward_rule   text,                   -- alleen een door Rayan ingestelde regeling
  ref_code      text not null unique,
  status        text not null default 'idee' check (status in ('idee','benaderd','actief','gestopt')),
  is_test       boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Echte bewijzen: reviews, uitspraken, resultaten, met bron en toegestaan gebruik.
create table hq.evidence (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid references hq.leads(id) on delete set null,
  project_id   uuid references hq.projects(id) on delete set null,
  kind         text not null check (kind in ('review','uitspraak','resultaat')),
  text         text not null,
  source       text not null,            -- waar het vandaan komt (link, mail, Google)
  permission   text not null,            -- waarvoor het mag worden gebruikt
  received_at  date not null,
  is_test      boolean not null default false,
  created_by   uuid,
  created_at   timestamptz not null default now()
);

-- ── Teamleider, planning, scorekaarten, fouten, experimenten ────────────────
create table hq.briefings (
  id          uuid primary key default gen_random_uuid(),
  day         date not null,
  env         text not null default 'productie' check (env in ('productie','test')),
  at          timestamptz not null default now(),
  facts       jsonb not null,
  summary     text not null,
  summary_by  text not null default 'code',   -- 'code' of 'Claude'
  previous    jsonb not null default '[]'::jsonb,
  unique (day, env)
);

create table hq.actions (
  id          uuid primary key default gen_random_uuid(),
  briefing_id uuid references hq.briefings(id) on delete set null,
  day         date not null,
  rank        integer not null,
  department  text not null,
  title       text not null,
  reason      text not null,             -- aanleiding
  expected    text not null,             -- verwachte bijdrage
  next_step   text not null,
  lead_id     uuid references hq.leads(id) on delete cascade,
  quote_id    uuid references hq.quotes(id) on delete set null,
  status      text not null default 'open' check (status in ('open','opgepakt','klaar','vervallen')),
  due_at      timestamptz,
  source_key  text not null,
  result      text,
  picked_at   timestamptz,
  done_at     timestamptz,
  is_test     boolean not null default false,
  unique (day, source_key)
);

create table hq.agent_errors (
  id            uuid primary key default gen_random_uuid(),
  department    text not null,
  kind          text not null,           -- bv. dubbele_verzending, afmelding_genegeerd, observatie_onjuist
  description   text not null,
  route         text,                    -- gepauzeerde verzendroute (bv. email)
  lead_id       uuid references hq.leads(id) on delete set null,
  correction_action_id uuid references hq.actions(id) on delete set null,
  at            timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_note text,
  is_test       boolean not null default false
);

create table hq.prompt_versions (
  id         uuid primary key default gen_random_uuid(),
  key        text not null,              -- bv. acquisitie_eerste_mail
  version    integer not null,
  body       text not null,
  active     boolean not null default false,
  note       text not null default '',
  created_at timestamptz not null default now(),
  unique (key, version)
);

create table hq.experiments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  department  text not null,
  change      text not null,             -- precies één wijziging
  variant_a   text not null,
  variant_b   text not null,
  metric      text not null,             -- welk resultaat verbetering betekent
  min_samples integer not null default 20,
  status      text not null default 'loopt' check (status in ('concept','loopt','afgerond','teruggedraaid')),
  decision    text,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  is_test     boolean not null default false
);
alter table hq.outreach add column experiment_id uuid references hq.experiments(id) on delete set null;
alter table hq.outreach add column variant text;

create table hq.segments (
  key        text primary key,
  name       text not null,
  hypothesis text not null,
  cities     text[] not null default '{Den Haag,Zoetermeer}',
  osm_tags   jsonb not null,             -- bv. [{"shop":"hairdresser"},{"shop":"beauty"}]
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Vindbaarheid & conversie: voorstellen met gebruikte gegevens en meetmoment; vorige versie bewaard.
create table hq.proposals (
  id           uuid primary key default gen_random_uuid(),
  department   text not null check (department in ('seo','conversie')),
  title        text not null,
  problem      text not null,
  evidence     jsonb not null,           -- gebruikte gegevens
  measured_at  timestamptz not null,
  sample_size  integer,
  confidence   text not null,            -- 'onvoldoende bewijs', 'voorzichtig', 'redelijk'
  change       jsonb,                    -- voorgestelde wijziging (pagina, tekst) voor de preview
  previous     jsonb,                    -- vorige versie (terugdraaien)
  status       text not null default 'voorstel' check (status in ('voorstel','goedgekeurd','gepubliceerd','teruggedraaid','afgewezen')),
  source_key   text unique,
  decided_by   uuid,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);

insert into hq.agents (key, name, title, zone, mission, sort) values
  ('teamleider', 'Teamleider', 'Ochtendoverleg',        'analyse',   'Houdt elke ochtend het overleg: feiten van alle afdelingen, de drie belangrijkste acties, opvolging van gisteren.', 0),
  ('groei',      'Groei',      'Groei & Planning',      'sales',     'Kiest dagelijks maximaal vijf acties die het meest bijdragen aan nieuwe betalende klanten, binnen de capaciteit.', 11),
  ('acquisitie', 'Acquisitie', 'Acquisitie & Samenwerkingen', 'acquisitie', 'Bereidt persoonlijke benaderingen voor op controleerbare observaties, alleen met een geldige contactgrond.', 12),
  ('conversie',  'Conversie',  'Conversieverbetering',  'analyse',   'Maakt van bezoekers aanvragen: begrijpelijkheid, vertrouwen, pakketten, contactgemak, mobiel.', 13),
  ('project',    'Project',    'Projectbeheer & Klantbegeleiding', 'ontwikkeling', 'Maakt bij akkoord het project, verzamelt materiaal via de intake en schrijft de bouwbriefing.', 14),
  ('vertrouwen', 'Vertrouwen', 'Vertrouwen & Aanbevelingen', 'content', 'Verzamelt echte bewijzen met bron en toegestaan gebruik; reviewverzoeken en doorverwijzingen.', 15)
on conflict (key) do nothing;
update hq.agents set title='Vindbaarheid & SEO' where key='rank';
update hq.agents set title='Resultaten & Experimenten' where key='insights';
update hq.agents set title='Nazorg & Vervolgopdrachten' where key='care';

insert into hq.segments (key, name, hypothesis, cities, osm_tags) values
  ('salons', 'Kappers en salons', 'Salons hebben baat bij online afspraken en zichtbare prijzen.', '{Den Haag,Zoetermeer}', '[{"shop":"hairdresser"},{"shop":"beauty"}]'),
  ('autobedrijven', 'Autobedrijven', 'Garages krijgen vaak dezelfde vragen; een kentekencheck en aanvraagformulier helpen.', '{Den Haag,Zoetermeer}', '[{"shop":"car_repair"},{"shop":"car"},{"shop":"tyres"}]'),
  ('dienstverleners', 'Lokale dienstverleners', 'Lokale vakmensen worden vaak via telefoon gevonden; duidelijke contactroute en diensten.', '{Den Haag,Zoetermeer}', '[{"craft":"electrician"},{"craft":"plumber"},{"craft":"painter"},{"craft":"carpenter"}]')
on conflict (key) do nothing;

insert into hq.settings (key, value) values
  ('sales', '{"followup": {"enabled": true, "max": 2, "days": [3, 7], "only_with_interest": true}, "reply_style": "kort, persoonlijk, je-vorm, ondertekend met Rayan", "capacity": {"max_projects": 3, "days_per_project": 14}}'::jsonb),
  ('availability', '{"weekdays": [1,2,3,4,5], "from": "09:00", "to": "17:00", "slot_min": 30, "quiet_from": "21:00", "quiet_to": "08:00"}'::jsonb),
  ('kantoor', '{"paused": false, "meeting_time": "08:30", "max_actions": 5}'::jsonb),
  ('routes', '{"email": {"auto": false, "paused": false, "pause_reason": null, "live": false, "max_per_day": 10, "min_days_between": 7}, "whatsapp": {"auto": false, "paused": false}, "telefoon": {"auto": false, "paused": false}}'::jsonb),
  ('scout', '{"segments": ["salons","autobedrijven","dienstverleners"], "cities": ["Den Haag","Zoetermeer"], "max_per_run": 20, "enabled": false}'::jsonb)
on conflict (key) do nothing;

insert into hq.prompt_versions (key, version, body, active, note) values
  ('acquisitie_eerste_mail', 1, 'Eén echte observatie, één bruikbare suggestie, één eenvoudige vraag. Afzender en afmelden duidelijk. Geen prijzen, geen beloftes.', true, 'Startversie'),
  ('sales_antwoord', 1, 'Kort, persoonlijk, je-vorm. Herhaal de behoefte in één zin, noem het passende pakket met de actuele prijs, vraag naar ontbrekende informatie, één vervolgstap. Groet: Rayan.', true, 'Startversie')
on conflict (key, version) do nothing;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'hq' loop
    execute format('alter table hq.%I enable row level security', t.tablename);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on all tables in schema hq from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on all tables in schema hq from authenticated'; end if;
end $$;

$hqmig$;
    insert into public.hq_schema_migrations (name) values ('005_klanten_winnen.sql');
    raise notice 'Uitgevoerd: 005_klanten_winnen.sql';
  else
    raise notice 'Al gedaan: 005_klanten_winnen.sql';
  end if;
end $hqdo$;

select name, applied_at from public.hq_schema_migrations order by name;
