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
