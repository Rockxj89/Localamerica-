-- Mud Hole #8 (place 129) showed the same picture twice: photo rows 168 and 206 are two
-- copies of one file (same name, size and content; 168 came from Google Drive, 206 from the
-- old Glide assets). Found in the data quality pass on Nov 23, 2026.
-- This removes row 206, so the place shows the picture once. Row 168 stays and still leads
-- the page (the app shows photos in row order). The storage file behind row 206 stays in the
-- bucket; nothing points to it.
-- Card Maker cards point at photo rows and are deleted along with them (ON DELETE CASCADE),
-- so this refuses to run if any card uses row 206 (none did on Nov 23), and it locks the row
-- first so no card can be saved on it while this runs.
-- Undo: 2026-11-23-mud-hole-8-duplicate-photo.undo.sql
do $$
declare
  n int;
begin
  perform 1 from public.poi_location_photos where id = 206 for update;

  if exists (select 1 from public.poi_card_maker_cards where photo_id = 206) then
    raise exception 'a Card Maker card uses photo row 206; not removing it';
  end if;

  delete from public.poi_location_photos
  where id = 206
    and location_id = 129
    and object_key = 'assets/d508389a5b4e81df4706929b35e98cd2321e1d2b504c5ef17ca49b68af5ce22c/IMG_20231230_200124_607.jpg';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'expected to remove 1 photo row, removed %', n;
  end if;

  if (select count(*) from public.poi_location_photos where location_id = 129) <> 1 then
    raise exception 'Mud Hole #8 should keep exactly 1 photo row';
  end if;
end $$;
