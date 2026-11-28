-- Salesmotor: het AI-tegoed gaat zoveel mogelijk naar het binnenhalen en overtuigen van
-- betalende klanten. Per budgetpost (websitecheck, voorbeeldsite, acquisitie, sales, controle,
-- overig) wordt bijgehouden wat het kost, en per klant via welk kanaal hij binnenkwam, zodat
-- het budget de betaalde opdrachten volgt (bij weinig gegevens: "nog onvoldoende bewijs").

-- ── Budget per post ──────────────────────────────────────────────────────────
alter table hq.ai_reservations add column post text not null default 'overig'
  check (post in ('websitecheck','voorbeeldsite','acquisitie','sales','controle','overig'));
create index ai_reservations_post_idx on hq.ai_reservations (post, created_at);

-- ── Verkoopkanaal per klant (eerste herleidbare bron) en adres (bezoekroute) ─
alter table hq.leads add column sales_channel text
  check (sales_channel in ('websitecheck','voorbeeldsite','acquisitie','bellen','bezoek','formulier','video','partner','verwijzing','bestaande_klant','opdracht','onbekend'));
alter table hq.leads add column address text;          -- openbaar bedrijfsadres (OpenStreetMap)

-- ── Gratis websitecheck (leadmagneet op de site) ────────────────────────────
create table hq.site_checks (
  id           uuid primary key default gen_random_uuid(),
  url          text not null,
  domain       text not null,
  token_hash   text not null unique,           -- rapportlink zonder account
  status       text not null default 'bezig' check (status in ('bezig','klaar','mislukt')),
  result       jsonb,                          -- metingen (feiten)
  advice       jsonb,                          -- verbeterpunten + passend pakket
  advice_by    text,                           -- 'Claude' of 'regels'
  error        text,
  task_id      uuid references hq.tasks(id) on delete set null,
  lead_id      uuid references hq.leads(id) on delete set null,
  ip_hash      text,                           -- tegen misbruik (per dag wisselend, geen IP)
  is_test      boolean not null default false,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index site_checks_created_idx on hq.site_checks (created_at desc);
create index site_checks_domain_idx on hq.site_checks (domain, created_at desc);

-- ── Persoonlijke voorbeeldsite per bedrijf ──────────────────────────────────
create table hq.previews (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references hq.leads(id) on delete cascade,
  slug            text not null unique,          -- /voorbeeld/<slug>
  style           text not null default 'strak' check (style in ('strak','licht','warm','fris')),
  content         jsonb not null,                -- teksten en secties (geen verzonnen feiten)
  content_by      text not null default 'regels',
  status          text not null default 'concept' check (status in ('concept','gedeeld','ingetrokken')),
  views           integer not null default 0,
  first_viewed_at timestamptz,
  last_viewed_at  timestamptz,
  expires_at      timestamptz not null default (now() + interval '45 days'),
  task_id         uuid references hq.tasks(id) on delete set null,
  is_test         boolean not null default false,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create unique index previews_lead_active_uq on hq.previews (lead_id) where status <> 'ingetrokken';

-- ── Offertepagina met akkoordknop en aanbetaling ────────────────────────────
alter table hq.quotes add column viewed_at timestamptz;
alter table hq.quotes add column view_count integer not null default 0;
alter table hq.quotes add column valid_until timestamptz;
alter table hq.quotes add column deposit_pct integer check (deposit_pct between 0 and 100);
alter table hq.quotes add column deposit_cents integer check (deposit_cents >= 0);
alter table hq.quotes add column accepted_via text check (accepted_via in ('hq','klant_online'));
alter table hq.quotes add column accepted_name text;
alter table hq.quotes add column accepted_ip_hash text;
alter table hq.payments add column kind text not null default 'overig' check (kind in ('aanbetaling','restbetaling','volledig','overig'));
alter table hq.projects add column deposit_paid_at timestamptz;

-- ── Bel- en bezoeklijst ─────────────────────────────────────────────────────
create table hq.calls (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references hq.leads(id) on delete cascade,
  day          date not null,
  kind         text not null default 'bellen' check (kind in ('bellen','bezoek')),
  briefing     jsonb,                           -- belcoach: opening, probleem, pakket, bezwaren
  briefing_by  text,
  task_id      uuid references hq.tasks(id) on delete set null,
  outcome      text check (outcome in ('geen_gehoor','terugbellen','interesse','afspraak','offerte','geen_interesse','niet_bellen')),
  callback_on  date,
  notes        text,
  done_at      timestamptz,
  is_test      boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (lead_id, day)
);
create index calls_day_idx on hq.calls (day, kind);

-- ── Meldingen aan de eigenaar (in HQ en per e-mail, nooit dubbel) ───────────
create table hq.notifications (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,           -- voorkomt dubbele meldingen
  kind          text not null,
  title         text not null,
  body          text not null default '',
  url           text,
  lead_id       uuid references hq.leads(id) on delete cascade,
  is_test       boolean not null default false,
  deliver_after timestamptz not null default now(),   -- stille uren: later versturen
  sent_at       timestamptz,
  send_error    text,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index notifications_unsent_idx on hq.notifications (deliver_after) where sent_at is null;
create index notifications_created_idx on hq.notifications (created_at desc);

-- ── Instellingen ────────────────────────────────────────────────────────────
insert into hq.settings (key, value) values
  ('sales_ai', '{
     "posts": {"voorbeeldsite": 25, "acquisitie": 20, "websitecheck": 20, "sales": 15, "controle": 5, "overig": 15},
     "models": {"overtuigen": "claude-opus-5-5", "werk": "claude-sonnet-5-5", "snel": "claude-haiku-5-5"},
     "learn_min_paid": 3,
     "checks_per_day": 40,
     "calls_per_day": 5,
     "visits_per_day": 5,
     "notify_email": null
   }'::jsonb),
  ('payment', '{"deposit_pct": 50, "iban": null, "account_name": null, "quote_valid_days": 14}'::jsonb),
  ('links', '{"google_review_url": null, "referral_reward": null}'::jsonb)
on conflict (key) do nothing;

-- Opleveren duurt bij StrakWerk minder dan 4 uur per Starter-site: de standaardcapaciteit
-- (3 projecten van 14 dagen) liet klanten onnodig lang wachten. Alleen aanpassen als de
-- eigenaar de standaard nog niet zelf heeft gewijzigd.
update hq.settings set value = jsonb_set(value, '{capacity}', '{"max_projects": 6, "days_per_project": 3}'::jsonb), updated_at = now()
 where key = 'sales' and value->'capacity' = '{"max_projects": 3, "days_per_project": 14}'::jsonb;

-- Nieuwe tabellen: alleen bereikbaar via de server (zelfde regels als de rest van schema hq).
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'hq' loop
    execute format('alter table hq.%I enable row level security', t.tablename);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on all tables in schema hq from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on all tables in schema hq from authenticated'; end if;
end $$;
