drop table if exists plan_session_completions;

create table plan_session_completions (
  session_key text primary key,
  week_number int not null,
  phase int not null,
  order_index int not null,
  discipline text not null,
  icon text not null,
  title text not null,
  tag text,
  duration_min numeric,
  segments jsonb not null default '[]'::jsonb,
  session_date date,
  done boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Single personal user, but a real Supabase Auth login gates this now:
-- only authenticated requests (a valid session) can read or write.
alter table plan_session_completions enable row level security;

create policy "Authenticated read/write access"
  on plan_session_completions for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
