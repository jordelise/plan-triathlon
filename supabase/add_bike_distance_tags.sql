-- Bike sessions with a clean, explicit distance get a distance tag too
-- (quality/interval bike sessions stay untagged since they're time-based only).
update plan_session_completions set tag = '45-60 km'
  where session_key in ('s1-4', 's2-4', 's3-4', 's4-4', 's5-4');

update plan_session_completions set tag = '40 km'
  where session_key in ('s9-2', 's10-2');
