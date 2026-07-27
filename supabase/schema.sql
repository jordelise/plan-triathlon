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
  segments jsonb not null default '[]'::jsonb,
  alt_note text,
  done boolean not null default false,
  updated_at timestamptz not null default now()
);

-- No auth in this app (single personal user) — RLS is enabled with a
-- permissive policy purely so the table isn't wide open by default;
-- real protection here is that the publishable key is only used by this app.
alter table plan_session_completions enable row level security;

create policy "Public read/write access"
  on plan_session_completions for all
  using (true)
  with check (true);
