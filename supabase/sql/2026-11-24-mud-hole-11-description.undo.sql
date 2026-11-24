-- Undo for 2026-11-24-mud-hole-11-description.sql: puts Mud Hole #11's old description back.
update public.poi_locations
set description = 'If you want mud, this trail is for you.'
where id = 208 and name = 'Mud Hole #11' and description = 'A couple of fairly deep mud holes. Winch recommended.';
