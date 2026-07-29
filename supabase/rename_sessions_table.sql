-- plan_session_completions no longer just tracks completion state — it
-- holds the full content of each session (dates, segments, tags,
-- discipline...). Renaming it to plan_sessions to match. This is a plain
-- rename: data, indexes, and RLS policies all carry over automatically.
alter table plan_session_completions rename to plan_sessions;
