create table if not exists plan_race_goals (
  id int primary key default 1,
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
  constraint plan_race_goals_single_row check (id = 1),
  constraint plan_race_goals_size_check check (size in ('S', 'M', 'L', 'IRONMAN'))
);

alter table plan_race_goals enable row level security;

create policy "Authenticated read/write access"
  on plan_race_goals for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

insert into plan_race_goals (id) values (1) on conflict (id) do nothing;
