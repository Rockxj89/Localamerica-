-- Mud Hole #11 (place 208): the owner chose this wording in chat on Nov 24, 2026.
-- It replaces "If you want mud, this trail is for you."
-- Undo: 2026-11-24-mud-hole-11-description.undo.sql
do $$
declare
  n int;
begin
  update public.poi_locations
  set description = 'A couple of fairly deep mud holes. Winch recommended.'
  where id = 208 and name = 'Mud Hole #11' and description = 'If you want mud, this trail is for you.';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'expected to update 1 place, updated %', n;
  end if;
end $$;
