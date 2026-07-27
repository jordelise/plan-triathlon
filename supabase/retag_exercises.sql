alter table plan_exercises add column if not exists tags text[];

update plan_exercises set tags = array['Fessiers'] where name = 'Pont fessier';
update plan_exercises set tags = array['Fessiers', 'Quadriceps'] where name = 'Squats';
update plan_exercises set tags = array['Abdos'] where name = 'Gainage ventral (planche)';
update plan_exercises set tags = array['Obliques'] where name = 'Gainage latéral';
update plan_exercises set tags = array['Mollets'] where name = 'Montées sur pointes';
update plan_exercises set tags = array['Tibial antérieur'] where name = 'Flexions de cheville';
update plan_exercises set tags = array['Dos'] where name = 'Extensions dorsales (superman)';
update plan_exercises set tags = array['Dos'] where name = 'Rowing élastique';
update plan_exercises set tags = array['Dos', 'Biceps'] where name = 'Tractions élastique';
update plan_exercises set tags = array['Ischios', 'Fessiers'] where name = 'Soulevé de terre roumain';
update plan_exercises set tags = array['Quadriceps', 'Fessiers'] where name = 'Fentes bulgares';
update plan_exercises set tags = array['Dos'] where name = 'Tractions négatives élastique';

alter table plan_exercises drop column if exists tag;
