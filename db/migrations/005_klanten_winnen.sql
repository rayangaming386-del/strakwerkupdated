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
