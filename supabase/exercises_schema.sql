create table if not exists plan_exercises (
  id bigint generated always as identity primary key,
  category text not null,
  order_index int not null,
  name text not null,
  description text not null,
  tag text
);

alter table plan_exercises enable row level security;

create policy "Public read/write access"
  on plan_exercises for all
  using (true)
  with check (true);
