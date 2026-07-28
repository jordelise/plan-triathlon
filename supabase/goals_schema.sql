create table if not exists plan_race_goals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Triathlon de la Baie',
  race_date date not null default '2026-10-11',
  size text not null default 'M',
  swim_distance_m int not null default 1500,
  swim_duration_sec int not null default 1920,
  t1_duration_sec int not null default 240,
  bike_distance_km numeric not null default 40,
  bike_duration_sec int not null default 5100,
  t2_duration_sec int not null default 180,
  run_distance_km numeric not null default 10,
  run_duration_sec int not null default 3300,
  updated_at timestamptz not null default now(),
  constraint plan_race_goals_size_check check (size in ('S', 'M', 'L', 'IRONMAN'))
);

alter table plan_race_goals enable row level security;

create policy "Owner read/write access"
  on plan_race_goals for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Every new signup gets a default goals row automatically, so the home
-- page has something sane to show before they ever open the editor.
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
