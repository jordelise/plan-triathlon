-- Bike, strength and mix sessions no longer get a tag at all.
update plan_session_completions set tag = null where discipline in ('bike', 'strength', 'mix');

-- Run sessions: clear all tags first, then set distance only where the
-- session has one clean, explicit total distance (not just time-based).
update plan_session_completions set tag = null where discipline = 'run';
update plan_session_completions set tag = '6 km' where session_key in ('s1-3', 's3-3', 's5-3');
update plan_session_completions set tag = '10 km' where session_key in ('s9-3', 's10-3');

-- Swim sessions: tag becomes just the distance (technique/type descriptor dropped).
update plan_session_completions set tag = '2400 m' where session_key = 's1-1';
update plan_session_completions set tag = '2500 m' where session_key = 's2-1';
update plan_session_completions set tag = '2600 m' where session_key = 's3-1';
update plan_session_completions set tag = '2500 m' where session_key = 's4-1';
update plan_session_completions set tag = '2700 m' where session_key = 's5-1';
update plan_session_completions set tag = '2800 m' where session_key = 's9-1';
update plan_session_completions set tag = '2900 m' where session_key = 's10-1';
update plan_session_completions set tag = '1200 m' where session_key = 's11-1';
