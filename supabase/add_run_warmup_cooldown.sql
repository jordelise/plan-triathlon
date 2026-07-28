-- Every running session now starts with a 15-min warm-up jog and ends
-- with a 5-min cool-down, prepended/appended to the existing segments.
update plan_session_completions
set segments = '[{"label":"Échauffement","text":"15 min de footing."}]'::jsonb
  || segments
  || '[{"label":"Retour au calme","text":"5 min de footing souple."}]'::jsonb
where discipline = 'run';
