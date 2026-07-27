-- Estimated distances (midpoint pace × planned time) for sessions that
-- only stated time + pace, not a direct total. Marked with ≈ since they're
-- derived, unlike the exact tags (6 km, 10 km, 40 km, 45-60 km).
update plan_session_completions set tag = '≈12 km' where session_key in ('s2-3', 's4-3');
update plan_session_completions set tag = '≈11 km' where session_key in ('s6-3', 's7-3', 's8-3');
update plan_session_completions set tag = '≈7 km' where session_key in ('s6-1', 's7-1', 's8-1');
update plan_session_completions set tag = '≈3 km' where session_key in ('s6-4', 's7-4', 's8-4');
update plan_session_completions set tag = '≈6 km' where session_key = 's11-3';
update plan_session_completions set tag = '≈28 km' where session_key in ('s1-2', 's2-2', 's3-2', 's4-2', 's5-2');
update plan_session_completions set tag = '≈29 km' where session_key = 's11-2';
