-- Every running session ends with a 5-min cool-down. Sessions under 1h
-- also get a 15-min warm-up jog at the start; longer runs (Sortie longue,
-- 10 km Allure spécifique) skip the warm-up since they already build up
-- gradually. Safe to re-run: strips any previously-added warm-up/cool-down
-- segments first, then re-applies the rule from scratch.

update plan_session_completions
set segments = (
  select coalesce(jsonb_agg(elem), '[]'::jsonb)
  from jsonb_array_elements(segments) elem
  where elem->>'label' not in ('Échauffement', 'Retour au calme')
)
where discipline = 'run';

update plan_session_completions
set segments = '[{"label":"Échauffement","text":"15 min de footing."}]'::jsonb || segments
where discipline = 'run'
  and session_key not in ('s2-3', 's4-3', 's6-3', 's7-3', 's8-3', 's9-3', 's10-3');

update plan_session_completions
set segments = segments || '[{"label":"Retour au calme","text":"5 min de footing souple."}]'::jsonb
where discipline = 'run';
