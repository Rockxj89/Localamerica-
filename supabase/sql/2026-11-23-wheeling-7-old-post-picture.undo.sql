-- Undo for 2026-11-23-wheeling-7-old-post-picture.sql.
-- Puts the old "Flex #7" post picture row back exactly as it was. The file post-images/153.jpg
-- was never removed, so the picture comes back (unless a new one has replaced the file).
insert into public.post_images
  (location_id, object_key, design_urn, approved_at, place_name, look)
values
  (153, '153.jpg', 'urn:aaid:sc:US:aa7fd591-d48b-4008-9b46-4e2b488bebfd',
   '2026-11-20T16:24:41.608+00:00', 'Flex #7',
   'band bottom | deep brown #1f0f08 band, burnt orange #d08a52 accents | Anton title + Aileron | logo right | photo: contrast/vibrance up a little')
on conflict (location_id) do nothing;
