-- Phase 1: "Course qualité" -> split by semaine A/B
update plan_session_completions set title = 'Fractionné'
  where session_key in ('s1-3', 's3-3', 's5-3');
update plan_session_completions set title = 'Sortie longue'
  where session_key in ('s2-3', 's4-3');

-- Phase 2: Endurance -> Sortie longue ; Footing + Course EF -> Course tranquille
update plan_session_completions set title = 'Sortie longue'
  where session_key in ('s6-3', 's7-3', 's8-3');
update plan_session_completions set title = 'Course tranquille'
  where session_key in ('s6-1', 's7-1', 's8-1', 's6-4', 's7-4', 's8-4');

-- Phase 3: Course -> Allure spécifique
update plan_session_completions set title = 'Allure spécifique'
  where session_key in ('s9-3', 's10-3');
