-- Home splits were showing generic 1500m/40km/10km defaults for brand
-- new accounts instead of staying empty. Drop the defaults/not-null so
-- future signups get a genuinely blank goals row.
alter table plan_race_goals alter column swim_distance_m drop default;
alter table plan_race_goals alter column swim_distance_m drop not null;
alter table plan_race_goals alter column swim_duration_sec drop default;
alter table plan_race_goals alter column swim_duration_sec drop not null;
alter table plan_race_goals alter column t1_duration_sec drop default;
alter table plan_race_goals alter column t1_duration_sec drop not null;
alter table plan_race_goals alter column bike_distance_km drop default;
alter table plan_race_goals alter column bike_distance_km drop not null;
alter table plan_race_goals alter column bike_duration_sec drop default;
alter table plan_race_goals alter column bike_duration_sec drop not null;
alter table plan_race_goals alter column t2_duration_sec drop default;
alter table plan_race_goals alter column t2_duration_sec drop not null;
alter table plan_race_goals alter column run_distance_km drop default;
alter table plan_race_goals alter column run_distance_km drop not null;
alter table plan_race_goals alter column run_duration_sec drop default;
alter table plan_race_goals alter column run_duration_sec drop not null;

-- Existing rows (Elise's) are untouched — this only changes future inserts.
