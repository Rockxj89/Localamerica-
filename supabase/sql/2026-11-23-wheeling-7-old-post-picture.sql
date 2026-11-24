-- Wheeling #7 (place 153, renamed from Flex #7 on Nov 22, 2026) has a saved Adobe post
-- picture whose words still say "Flex #7". It posts months from now. The owner OK'd removing
-- it in chat on Nov 23, 2026, so the weekly Adobe task makes a new one that says Wheeling #7.
-- This removes the post_images row for place 153. The file post-images/153.jpg stays in
-- storage (a new picture saved for this place replaces it). The Adobe design itself is not
-- touched. The place's own photos in the app are not touched.
-- Undo: 2026-11-23-wheeling-7-old-post-picture.undo.sql
do $$
declare
  n int;
begin
  delete from public.post_images
  where location_id = 153
    and object_key = '153.jpg'
    and place_name = 'Flex #7';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'expected to remove 1 post_images row, removed %', n;
  end if;
end $$;
