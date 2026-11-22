-- T1 fix (security audit, Nov 22, 2026): limits on what the public can write to the traffic table.
--
-- Before: the public could set every column of poi_traffic_events, including id and created_at, and the
-- hourly limit only counted per visitor ID. A script could make up a new visitor ID for every row (or a
-- past time), skip the limit, and fill the free plan's 500 MB database; Supabase then makes the database
-- read-only, which would stop checkouts and pin approvals. Ids set ahead of the counter could also make
-- real tracking fail for a while.
--
-- After:
-- 1. The public (anon and signed-in) may only fill in the 7 columns the app and the place pages send.
--    The database always sets id and created_at itself.
-- 2. At most 3,000 rows from the public per clock hour across the whole site (real visitors so far peak
--    around 30 an hour; a crawler once made 435). Extra rows are dropped quietly, the same way as the
--    existing per-visitor limits, so visitors never see an error. Rows added by the server (service role,
--    SQL) aren't capped, so a backup restore isn't blocked.
-- The size limits in the "pwa can log events" policy and the per-visitor limits stay as they were.
--
-- Applied to the live database with the Supabase connector on Nov 22, 2026
-- (migration "tracker_insert_limits").

-- 1) Only the columns the app sends.
revoke insert on table public.poi_traffic_events from anon, authenticated;
grant insert (event_type, location_id, visitor_session_hash, browser_type, referrer_host, automation_signal, event_metadata)
  on table public.poi_traffic_events to anon, authenticated;

-- 2) Per-visitor limits (unchanged) plus the new site-wide hourly cap.
create or replace function public.poi_limit_traffic_inserts()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  recent_count integer;
  site_count integer;
begin
  if new.visitor_session_hash is null then
    select count(*) into recent_count
      from public.poi_traffic_events
      where visitor_session_hash is null
        and created_at > now() - interval '1 hour';
    if recent_count >= 300 then
      return null;
    end if;
  else
    select count(*) into recent_count
      from public.poi_traffic_events
      where visitor_session_hash = new.visitor_session_hash
        and created_at > now() - interval '1 hour';
    if recent_count >= 150 then
      return null;
    end if;
  end if;

  -- Site-wide cap on rows sent by the public: 3,000 per clock hour. The count is looked up once per
  -- request and then carried in a setting that lasts only for that request, so a big batch stays cheap.
  if current_setting('role', true) in ('anon', 'authenticated') then
    site_count := nullif(current_setting('la.traffic_hour_rows', true), '')::integer;
    if site_count is null then
      select count(*) into site_count from (
        select 1 from public.poi_traffic_events
        where created_at >= date_trunc('hour', now())
        limit 3000
      ) s;
    end if;
    if site_count >= 3000 then
      return null;
    end if;
    perform set_config('la.traffic_hour_rows', (site_count + 1)::text, true);
  end if;

  return new;
end;
$function$;
