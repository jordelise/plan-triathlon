-- Replaces the wide-open "anyone with the anon key can read/write" RLS
-- policies with ones that require a real logged-in Supabase Auth session.
-- Run this only after creating your user (Authentication > Users > Add
-- user in the Supabase dashboard) — otherwise the app will show empty
-- data until you log in.
drop policy if exists "Public read/write access" on plan_session_completions;
create policy "Authenticated read/write access"
  on plan_session_completions for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "Public read/write access" on plan_race_goals;
create policy "Authenticated read/write access"
  on plan_race_goals for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "Public read/write access" on plan_exercises;
create policy "Authenticated read/write access"
  on plan_exercises for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
