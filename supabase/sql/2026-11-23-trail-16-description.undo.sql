-- Undo for 2026-11-23-trail-16-description.sql: puts Trail #16's description back to empty.
update public.poi_locations
set description = ''
where id = 200 and name = 'Trail #16' and description = 'Fairly normal trail. Worth a look.';
