-- Trail #16 (place 200) had no description. The owner picked this wording in chat on Nov 23, 2026.
-- Undo: 2026-11-23-trail-16-description.undo.sql
do $$
declare
  n int;
begin
  update public.poi_locations
  set description = 'Fairly normal trail. Worth a look.'
  where id = 200 and name = 'Trail #16' and coalesce(description, '') = '';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'expected to update 1 place, updated %', n;
  end if;
end $$;
