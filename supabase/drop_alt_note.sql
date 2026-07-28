-- Unused since the schema was first created: no session ever set it, and
-- the app never rendered anything from it in practice (the alt_note note
-- feature was speculative, never adopted).
alter table plan_session_completions drop column if exists alt_note;
