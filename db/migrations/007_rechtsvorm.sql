-- 007: rechtsvorm van een bedrijf. Bepaalt of bellen voor verkoop mag: sinds 1 juli 2021
-- (Telecommunicatiewet, art. 11.7) alleen naar een rechtspersoon (bv, nv, stichting, vereniging,
-- coöperatie), of met toestemming, of naar een (oud-)klant. Een eenmanszaak, vof of maatschap
-- niet ongevraagd. Onbekend = niet bellen.

alter table hq.leads add column if not exists legal_form text
  check (legal_form in ('bv','nv','stichting','vereniging','cooperatie','eenmanszaak','vof','maatschap','cv','onbekend'));
alter table hq.leads add column if not exists legal_form_source text
  check (legal_form_source in ('naam','website','kvk','klant'));
alter table hq.leads add column if not exists legal_form_evidence text;
alter table hq.leads add column if not exists legal_form_at timestamptz;

create index if not exists leads_legal_form_idx on hq.leads (legal_form) where legal_form is not null;
