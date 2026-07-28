drop table if exists plan_session_completions;

create table plan_session_completions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_key text not null,
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
  updated_at timestamptz not null default now(),
  primary key (user_id, session_key)
);

-- Each account only ever sees and edits its own rows.
alter table plan_session_completions enable row level security;

create policy "Owner read/write access"
  on plan_session_completions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
