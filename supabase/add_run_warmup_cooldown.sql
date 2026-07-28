-- Every running session ends with a 5-min cool-down. Sessions under 1h
-- also get a 15-min warm-up jog at the start; only the Sortie longue
-- sessions (45+25 min or 1h10, no pace change partway through) clear
-- 1h and skip the warm-up — the 10 km Allure spécifique sessions run
-- their last 5 km at race pace, which brings the real total under 1h.
-- Safe to re-run: strips any previously-added warm-up/cool-down
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
  and session_key not in ('s2-3', 's4-3', 's6-3', 's7-3', 's8-3');

update plan_session_completions
set segments = segments || '[{"label":"Retour au calme","text":"5 min de footing souple."}]'::jsonb
where discipline = 'run';
