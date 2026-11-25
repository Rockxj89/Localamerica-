-- Undo 2026-11-25-place-descriptions.sql: put every description back the way it was.
update public.poi_locations set description = description_original, updated_at = now()
where description_original is not null and description is distinct from description_original;
