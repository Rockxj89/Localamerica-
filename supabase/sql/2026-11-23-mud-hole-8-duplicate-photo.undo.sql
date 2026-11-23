-- Undo for 2026-11-23-mud-hole-8-duplicate-photo.sql.
-- Puts Mud Hole #8's second photo row (206) back exactly as it was. Its storage file was never
-- removed, so the picture shows twice again.
insert into public.poi_location_photos
  (id, location_id, drive_file_id, object_key, filename, content_type, byte_size, created_at)
values
  (206, 129,
   'asset:d508389a5b4e81df4706929b35e98cd2321e1d2b504c5ef17ca49b68af5ce22c',
   'assets/d508389a5b4e81df4706929b35e98cd2321e1d2b504c5ef17ca49b68af5ce22c/IMG_20231230_200124_607.jpg',
   'IMG_20231230_200124_607.jpg', 'image/jpeg', 480012, '2026-09-24T15:59:43.138+00:00')
on conflict (id) do nothing;
