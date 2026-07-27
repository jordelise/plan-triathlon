update plan_session_completions
set tag = '≈' || tag
where tag is not null and tag not like '≈%';
