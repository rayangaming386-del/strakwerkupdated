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
