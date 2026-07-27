alter table plan_exercises add column if not exists tag text;

update plan_exercises set tag = 'Fessiers' where name = 'Pont fessier';
update plan_exercises set tag = 'Fessiers / Quadriceps' where name = 'Squats';
update plan_exercises set tag = 'Gainage' where name = 'Gainage ventral (planche)';
update plan_exercises set tag = 'Obliques' where name = 'Gainage latéral';
update plan_exercises set tag = 'Mollets' where name = 'Montées sur pointes';
update plan_exercises set tag = 'Tibial antérieur' where name = 'Flexions de cheville';
update plan_exercises set tag = 'Dos' where name = 'Extensions dorsales (superman)';
update plan_exercises set tag = 'Dos' where name = 'Rowing élastique';
update plan_exercises set tag = 'Dos / Biceps' where name = 'Tractions élastique';
update plan_exercises set tag = 'Ischios / Fessiers' where name = 'Soulevé de terre roumain';
update plan_exercises set tag = 'Quadriceps / Fessiers' where name = 'Fentes bulgares';
update plan_exercises set tag = 'Dos' where name = 'Tractions négatives élastique';
