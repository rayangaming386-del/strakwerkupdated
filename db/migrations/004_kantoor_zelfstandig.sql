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
