create table if not exists plan_exercises (
  id bigint generated always as identity primary key,
  category text not null,
  order_index int not null,
  name text not null,
  description text not null,
  tags text[]
);

alter table plan_exercises enable row level security;

create policy "Authenticated read/write access"
  on plan_exercises for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
