-- Moves from "one shared account for everybody" to real per-user data:
-- plan_session_completions and plan_race_goals get a user_id column and
-- are now scoped to their owner. plan_exercises stays shared (it is just
-- a reference library of drills, not personal data).
--
-- All of Elise's existing rows are backfilled to her account before the
-- column is made mandatory, so nothing disappears from under her.

-- 1. plan_session_completions
alter table plan_session_completions add column if not exists user_id uuid references auth.users(id) on delete cascade;
update plan_session_completions set user_id = '068470d1-35b3-41e8-a4d6-32c8879de7fe' where user_id is null;
alter table plan_session_completions alter column user_id set not null;
alter table plan_session_completions drop constraint if exists plan_session_completions_pkey;
alter table plan_session_completions add primary key (user_id, session_key);

drop policy if exists "Authenticated read/write access" on plan_session_completions;
drop policy if exists "Public read/write access" on plan_session_completions;
create policy "Owner read/write access"
  on plan_session_completions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 2. plan_race_goals: from a single id=1 row to one row per user
alter table plan_race_goals add column if not exists user_id uuid references auth.users(id) on delete cascade;
update plan_race_goals set user_id = '068470d1-35b3-41e8-a4d6-32c8879de7fe' where user_id is null;
alter table plan_race_goals alter column user_id set not null;
alter table plan_race_goals drop constraint if exists plan_race_goals_pkey;
alter table plan_race_goals drop constraint if exists plan_race_goals_single_row;
alter table plan_race_goals drop column if exists id;
alter table plan_race_goals add primary key (user_id);

drop policy if exists "Authenticated read/write access" on plan_race_goals;
drop policy if exists "Public read/write access" on plan_race_goals;
create policy "Owner read/write access"
  on plan_race_goals for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 3. Auto-create a default goals row for every future signup.
create or replace function public.handle_new_user_goals()
returns trigger as $$
begin
  insert into public.plan_race_goals (user_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created_goals on auth.users;
create trigger on_auth_user_created_goals
  after insert on auth.users
  for each row execute function public.handle_new_user_goals();

-- plan_exercises is untouched: still shared/global, "Authenticated read/write access".
