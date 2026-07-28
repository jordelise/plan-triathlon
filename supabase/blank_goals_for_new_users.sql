-- New signups were getting Elise's actual race pre-filled (name + date),
-- because plan_race_goals.name/race_date had defaults matching her race.
-- Drop those defaults so a fresh account starts with no race configured,
-- and the home page prompts to set one up via "Mon triathlon" instead.
alter table plan_race_goals alter column name drop default;
alter table plan_race_goals alter column name drop not null;
alter table plan_race_goals alter column race_date drop default;
alter table plan_race_goals alter column race_date drop not null;

-- Existing rows (i.e. Elise's) are untouched — this only changes what
-- future inserts get by default.
