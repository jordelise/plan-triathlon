create table if not exists plan_session_completions (
  user_id uuid not null references auth.users (id) on delete cascade,
  session_key text not null,
  done boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, session_key)
);

alter table plan_session_completions enable row level security;

create policy "Users select own completions"
  on plan_session_completions for select
  using (auth.uid() = user_id);

create policy "Users insert own completions"
  on plan_session_completions for insert
  with check (auth.uid() = user_id);

create policy "Users update own completions"
  on plan_session_completions for update
  using (auth.uid() = user_id);
