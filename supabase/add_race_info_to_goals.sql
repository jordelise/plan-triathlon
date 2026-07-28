-- Race name/date/format live on plan_race_goals now (one row about the
-- race, not two): no need for a separate plan_race_info table.
alter table plan_race_goals add column if not exists name text not null default 'Triathlon de la Baie';
alter table plan_race_goals add column if not exists race_date date not null default '2026-10-11';
alter table plan_race_goals add column if not exists size text not null default 'M';

alter table plan_race_goals drop constraint if exists plan_race_goals_size_check;
alter table plan_race_goals add constraint plan_race_goals_size_check check (size in ('S', 'M', 'L', 'IRONMAN'));
