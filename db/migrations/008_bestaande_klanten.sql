-- 008: bestaande klanten. Eigen soorten berichten voor verwijzen en onderhoud (naast
-- review_verzoek en nazorg). De oude controle wordt op inhoud gevonden, zodat de naam niet uitmaakt.
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'hq.outreach'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%review_verzoek%' loop
    execute format('alter table hq.outreach drop constraint %I', c.conname);
  end loop;
end $$;
alter table hq.outreach add constraint outreach_kind_check check (kind in ('eerste_contact','opvolging','offerte_opvolging','antwoord','review_verzoek','intake_herinnering','nazorg','afspraak_bevestiging','verwijzing','onderhoud'));
