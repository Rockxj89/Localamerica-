-- P1 fix (security audit, Nov 22, 2026): paid places are measured from a hidden point.
--
-- Before: the public poi_distances(user_lat, user_lng) function gave whole miles from any point the
-- caller chose to the REAL spot of every live place, paid ones included. Moving the point and watching
-- where 3 miles flips to 4 pins a paid place down exactly, without paying.
--
-- After: every place has its own fixed, secret offset of 1 to 2 miles in a random direction.
-- Free places are still measured to the real spot. Paid places (anything not Free) are measured to the
-- hidden point (real spot + offset). Someone can still work out the hidden point, but that only tells
-- them the real spot is somewhere in a 1-to-2-mile ring around it (about 9 square miles).
-- Near me and the town pages keep working; miles shown for paid places can be off by up to 2.
--
-- The offsets live in poi_locations next to the real GPS, so they get exactly the same protection
-- (the public can't read that table) and go into the same backup. They are as secret as the GPS.
-- Never reset them: a second hidden point for the same place would narrow down the real spot.
-- If a place's GPS is corrected, its offset stays the same and the hidden point moves with it.
-- Places within about 100 ft of each other share one offset (several pairs share a GPS), because two
-- different hidden points for one spot would let someone overlap the two rings. For the same reason:
-- archive places instead of deleting and re-adding them, and only restore poi_locations from a backup
-- made after this change (older backups have no offsets, so every place would get a second one).
--
-- Applied to the live database with the Supabase connector on Nov 22, 2026
-- (migration "paid_distance_hidden_points").

-- 1) Two new secret columns.
alter table public.poi_locations
  add column distance_offset_north_miles double precision,
  add column distance_offset_east_miles double precision;

comment on column public.poi_locations.distance_offset_north_miles is
  'SECRET, as secret as the GPS. Paid places are measured (Near me, town pages) from a hidden point this many miles north of the real spot (negative = south). Never reset.';
comment on column public.poi_locations.distance_offset_east_miles is
  'SECRET, as secret as the GPS. Paid places are measured (Near me, town pages) from a hidden point this many miles east of the real spot (negative = west). Never reset.';

-- 2) Every new place gets an offset automatically. If another place is within about 100 ft, it copies
--    that place's offset (same spot, same hidden point). Otherwise it draws a random one: 1 to 2 miles,
--    any direction, spread evenly over the ring, from a strong random source (gen_random_uuid).
create or replace function public.poi_fill_distance_offset()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  h text;
  r double precision;
  t double precision;
  near_n double precision;
  near_e double precision;
begin
  if new.distance_offset_north_miles is null or new.distance_offset_east_miles is null then
    select o.distance_offset_north_miles, o.distance_offset_east_miles
      into near_n, near_e
      from public.poi_locations o
      where o.id is distinct from new.id
        and o.distance_offset_north_miles is not null
        and o.distance_offset_east_miles is not null
        and abs(o.latitude - new.latitude) < 0.0003      -- about 110 ft north-south
        and abs(o.longitude - new.longitude) < 0.0004    -- about 115 ft east-west here
      order by (o.latitude - new.latitude) ^ 2 + ((o.longitude - new.longitude) * cos(radians(new.latitude))) ^ 2, o.id
      limit 1;
    if found then
      new.distance_offset_north_miles := near_n;
      new.distance_offset_east_miles := near_e;
      return new;
    end if;
    h := replace(gen_random_uuid()::text, '-', '');
    -- two independent random numbers between 0 and 1 (48 random bits each; the uuid's fixed digits are skipped)
    r := sqrt(1 + 3 * (('x' || substr(h, 1, 12))::bit(48)::bigint::double precision / 281474976710656));
    t := 2 * pi() * (('x' || substr(h, 20, 12))::bit(48)::bigint::double precision / 281474976710656);
    new.distance_offset_north_miles := r * cos(t);
    new.distance_offset_east_miles := r * sin(t);
  end if;
  return new;
end
$$;

revoke execute on function public.poi_fill_distance_offset() from public, anon, authenticated;

create trigger poi_fill_distance_offset
  before insert or update on public.poi_locations
  for each row execute function public.poi_fill_distance_offset();

-- 3) Give every existing place an offset (the trigger fills each row separately, and later rows in this
--    same update can see the earlier ones, so places at the same spot end up sharing one).
--    No trigger touches updated_at, so place pages and the sitemap don't change.
update public.poi_locations
  set distance_offset_north_miles = null
  where distance_offset_north_miles is null or distance_offset_east_miles is null;

-- 4) From now on every place must have an offset of 1 to 2 miles.
alter table public.poi_locations
  alter column distance_offset_north_miles set not null,
  alter column distance_offset_east_miles set not null,
  add constraint poi_locations_distance_offset_ring
    check (sqrt(distance_offset_north_miles ^ 2 + distance_offset_east_miles ^ 2) between 0.999 and 2.001);

-- 5) The distance function: same name, inputs and output as before (Near me and town pages unchanged).
--    CREATE OR REPLACE keeps who may run it (anon and signed-in, as before).
create or replace function public.poi_distances(user_lat double precision, user_lng double precision)
returns table(id bigint, miles integer)
language sql
stable security definer
set search_path to 'public'
as $function$
  -- Straight-line miles from the caller to each live place, rounded to whole miles.
  -- Free places: measured to the real spot. Paid places (anything not Free): measured to the place's
  -- hidden point, 1 to 2 miles from the real spot, so these miles can't be used to find a paid place.
  -- A paid place without an offset is left out; it is never measured to its real spot.
  select l.id,
         round(3958.8 * 2 * asin(sqrt(
           power(sin(radians(p.lat - user_lat) / 2), 2) +
           cos(radians(user_lat)) * cos(radians(p.lat)) *
           power(sin(radians(p.lng - user_lng) / 2), 2))))::integer
  from public.poi_locations l
  cross join lateral (
    select
      case when lower(l.access) = 'free' then l.latitude
           else l.latitude + degrees(l.distance_offset_north_miles / 3958.8) end as lat,
      case when lower(l.access) = 'free' then l.longitude
           else l.longitude + degrees(l.distance_offset_east_miles / (3958.8 * cos(radians(l.latitude)))) end as lng
  ) p
  where lower(l.status) <> 'archived'
    and (lower(l.access) = 'free'
         or (l.distance_offset_north_miles is not null and l.distance_offset_east_miles is not null));
$function$;
