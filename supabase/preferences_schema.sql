create table if not exists plan_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  training_days text[] not null default '{}',
  preferred_disciplines text[] not null default '{}',
  plan_start_date date,
  updated_at timestamptz not null default now(),
  constraint plan_preferences_training_days_check check (training_days <@ array['mon','tue','wed','thu','fri','sat','sun']),
  constraint plan_preferences_preferred_disciplines_check check (preferred_disciplines <@ array['swim','bike','run','strength'])
);

alter table plan_preferences add column if not exists preferred_disciplines text[] not null default '{}';
alter table plan_preferences drop constraint if exists plan_preferences_preferred_disciplines_check;
alter table plan_preferences add constraint plan_preferences_preferred_disciplines_check check (preferred_disciplines <@ array['swim','bike','run','strength']);
alter table plan_preferences add column if not exists plan_start_date date;

alter table plan_preferences enable row level security;

drop policy if exists "Owner read/write access" on plan_preferences;
create policy "Owner read/write access"
  on plan_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.handle_new_user_preferences()
returns trigger as $$
begin
  insert into public.plan_preferences (user_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created_preferences on auth.users;
create trigger on_auth_user_created_preferences
  after insert on auth.users
  for each row execute function public.handle_new_user_preferences();

insert into plan_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create table if not exists plan_constraints (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  allowed_disciplines text[] not null,
  title text,
  created_at timestamptz not null default now(),
  constraint plan_constraints_date_check check (end_date >= start_date)
);

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'plan_constraints' and column_name = 'note') then
    alter table plan_constraints rename column note to title;
  end if;
end $$;

alter table plan_constraints enable row level security;

drop policy if exists "Owner read/write access" on plan_constraints;
create policy "Owner read/write access"
  on plan_constraints for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
