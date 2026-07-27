-- Phase 1: Vélo qualité -> Fractionné
update plan_session_completions set title = 'Fractionné'
  where session_key in ('s1-2', 's2-2', 's3-2', 's4-2', 's5-2');

-- Phase 3: Vélo -> Allure spécifique
update plan_session_completions set title = 'Allure spécifique'
  where session_key in ('s9-2', 's10-2');
