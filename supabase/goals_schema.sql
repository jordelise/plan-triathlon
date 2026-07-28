create table if not exists plan_race_goals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text,
  race_date date,
  size text not null default 'M',
  swim_distance_m int,
  swim_duration_sec int,
  t1_duration_sec int,
  bike_distance_km numeric,
  bike_duration_sec int,
  t2_duration_sec int,
  run_distance_km numeric,
  run_duration_sec int,
  updated_at timestamptz not null default now(),
  constraint plan_race_goals_size_check check (size in ('S', 'M', 'L', 'IRONMAN'))
);

alter table plan_race_goals enable row level security;

create policy "Owner read/write access"
  on plan_race_goals for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Every new signup gets an empty goals row automatically (a placeholder
-- to upsert into later) — the home page shows "–" for every split until
-- Mon triathlon / the split editors are filled in.
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
