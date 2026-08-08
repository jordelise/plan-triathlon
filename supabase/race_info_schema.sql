create table if not exists plan_race_info (
  id int primary key default 1,
  name text not null default 'Triathlon de la Baie',
  race_date date not null default '2026-10-11',
  size text not null default 'M',
  updated_at timestamptz not null default now(),
  constraint plan_race_info_single_row check (id = 1),
  constraint plan_race_info_size_check check (size in ('S', 'M', 'L', 'IRONMAN'))
);

alter table plan_race_info enable row level security;

create policy "Public read/write access"
  on plan_race_info for all
  using (true)
  with check (true);

insert into plan_race_info (id) values (1) on conflict (id) do nothing;
