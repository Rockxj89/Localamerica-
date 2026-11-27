-- Trails map trip tools (Nov 27, 2026): saved routes and your own pins with a photo and a note.
-- Each row belongs to the account that made it (user_id = auth.uid()); nobody else can read or change it.
-- While the trails map is owner only, adding or changing rows and photos also needs the owner account
-- (public.is_traffic_admin()). When the map goes public, drop that part of the insert/update checks.
-- Photos go in a private bucket, one folder per account: trail-pin-photos/<user id>/<random id>.jpg

create table public.trail_routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  mode text not null check (mode in ('drive', 'hike', 'bike', 'line')),
  stops jsonb not null check (jsonb_typeof(stops) = 'array' and jsonb_array_length(stops) between 2 and 50),
  line jsonb not null check (jsonb_typeof(line) = 'array' and jsonb_array_length(line) between 2 and 20000 and pg_column_size(line) < 600000),
  miles numeric(7, 2) not null check (miles >= 0 and miles < 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trail_routes_user_idx on public.trail_routes (user_id, created_at desc);

create table public.trail_pins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  note text not null default '' check (char_length(note) <= 1000),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  photo text check (photo is null or (photo ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' and split_part(photo, '/', 1) = user_id::text)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trail_pins_user_idx on public.trail_pins (user_id, created_at desc);

create function public.trail_touch_updated_at() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  new.updated_at := now();
  new.user_id := old.user_id; -- a row can't be moved to another account
  return new;
end $$;
revoke execute on function public.trail_touch_updated_at() from public, anon, authenticated;
create trigger trail_routes_touch before update on public.trail_routes for each row execute function public.trail_touch_updated_at();
create trigger trail_pins_touch before update on public.trail_pins for each row execute function public.trail_touch_updated_at();

alter table public.trail_routes enable row level security;
alter table public.trail_pins enable row level security;
revoke all on public.trail_routes, public.trail_pins from public, anon, authenticated;
grant select, insert, update, delete on public.trail_routes, public.trail_pins to authenticated;

create policy "own routes: read" on public.trail_routes for select to authenticated using (user_id = (select auth.uid()));
create policy "own routes: add" on public.trail_routes for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_traffic_admin()));
create policy "own routes: change" on public.trail_routes for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and (select public.is_traffic_admin()));
create policy "own routes: delete" on public.trail_routes for delete to authenticated using (user_id = (select auth.uid()));
create policy "own pins: read" on public.trail_pins for select to authenticated using (user_id = (select auth.uid()));
create policy "own pins: add" on public.trail_pins for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_traffic_admin()));
create policy "own pins: change" on public.trail_pins for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and (select public.is_traffic_admin()));
create policy "own pins: delete" on public.trail_pins for delete to authenticated using (user_id = (select auth.uid()));

-- Private photo bucket: JPEG only, 3 MB each (the map shrinks photos to about 300 KB before sending)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trail-pin-photos', 'trail-pin-photos', false, 3145728, array['image/jpeg']);

create policy "trail pin photos: read own" on storage.objects for select to authenticated
  using (bucket_id = 'trail-pin-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "trail pin photos: add own" on storage.objects for insert to authenticated
  with check (bucket_id = 'trail-pin-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
              and array_length(storage.foldername(name), 1) = 1 and (select public.is_traffic_admin()));
create policy "trail pin photos: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'trail-pin-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
