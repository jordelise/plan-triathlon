-- Estimated total session duration (minutes), shown as a badge next to the
-- distance tag. Run/bike durations come from an explicit total time, or
-- distance × midpoint pace/speed when only those are given (now includes
-- the warm-up/cool-down segments added separately). Swim durations are the
-- roughest: most sets have no total time and no pace on their warm-up/
-- cool-down/drill portions, so those are assumed at an easy 2'15/100m; the
-- swim numbers are therefore much softer estimates than run/bike.
alter table plan_session_completions add column if not exists duration_min numeric;

-- Run
update plan_session_completions set duration_min = 51 where session_key in ('s1-3', 's3-3', 's5-3');
update plan_session_completions set duration_min = 65 where session_key in ('s6-1', 's7-1', 's8-1');
update plan_session_completions set duration_min = 57 where session_key in ('s6-2', 's7-2', 's8-2');
update plan_session_completions set duration_min = 75 where session_key in ('s6-3', 's7-3', 's8-3', 's2-3', 's4-3');
update plan_session_completions set duration_min = 40 where session_key in ('s6-4', 's7-4', 's8-4');
update plan_session_completions set duration_min = 79 where session_key in ('s9-3', 's10-3');
update plan_session_completions set duration_min = 49 where session_key = 's11-3';
update plan_session_completions set duration_min = 55 where session_key = 's12-3';

-- Bike
update plan_session_completions set duration_min = 79 where session_key in ('s1-2', 's2-2', 's3-2', 's4-2', 's5-2');
update plan_session_completions set duration_min = 153 where session_key in ('s1-4', 's3-4', 's5-4');
update plan_session_completions set duration_min = 143 where session_key in ('s2-4', 's4-4');
update plan_session_completions set duration_min = 87 where session_key in ('s9-2', 's10-2', 's11-2');
update plan_session_completions set duration_min = 60 where session_key = 's12-2';

-- Swim (roughest estimates — see note above)
update plan_session_completions set duration_min = 47 where session_key = 's1-1';
update plan_session_completions set duration_min = 55 where session_key = 's2-1';
update plan_session_completions set duration_min = 42 where session_key in ('s3-1', 's5-1');
update plan_session_completions set duration_min = 43 where session_key in ('s4-1', 's10-1');
update plan_session_completions set duration_min = 52 where session_key = 's9-1';
update plan_session_completions set duration_min = 32 where session_key = 's11-1';
update plan_session_completions set duration_min = 24 where session_key = 's12-1';
