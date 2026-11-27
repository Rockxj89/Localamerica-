-- Undo 2026-11-27-trail-trips.sql: removes saved routes, your own pins and their photo bucket.
-- This deletes every saved route and pin. Empty the trail-pin-photos bucket first
-- (Supabase dashboard, Storage), or the last line fails and the bucket stays.
drop policy if exists "trail pin photos: read own" on storage.objects;
drop policy if exists "trail pin photos: add own" on storage.objects;
drop policy if exists "trail pin photos: delete own" on storage.objects;
drop table if exists public.trail_routes;
drop table if exists public.trail_pins;
drop function if exists public.trail_touch_updated_at();
delete from storage.buckets where id = 'trail-pin-photos';
