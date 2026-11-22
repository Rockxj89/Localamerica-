-- T1 fix (security audit, Nov 22, 2026): limits on what the public can write to the traffic table.
--
-- Before: the public could set every column of poi_traffic_events, including id and created_at, and the
-- hourly limit only counted per visitor ID. A script could make up a new visitor ID for every row (or a
-- past time), skip the limit, and fill the free plan's 500 MB database; Supabase then makes the database
-- read-only, which would stop checkouts and pin approvals. Ids set ahead of the counter could also make
-- real tracking fail for a while.
--
-- After (all limits apply only to rows sent by the public, anon and signed-in; rows added by the server,
-- service role or SQL, aren't limited, so a backup restore isn't blocked):
-- 1. The public may only fill in the 7 columns the app and the place pages send.
--    The database always sets id and created_at itself.
-- 2. At most 25 rows per request (the app sends about 12 at most, when it flushes events queued at start-up).
-- 3. At most 3,000 rows per clock hour across the whole site (real visitors so far peak around 30 an hour;
--    a crawler once made 435).
-- 4. None at all once this table passes 200 MB (about 2 MB in Nov 2026), so even a long flood can't fill
--    the database. If that ever happens, delete the junk rows and run VACUUM FULL on poi_traffic_events
--    to turn tracking back on (deleting alone doesn't shrink the table).
-- Rows over a limit are dropped quietly, the same way as the existing per-visitor limits, so visitors never
-- see an error. The size limits in the "pwa can log events" policy and the per-visitor limits are unchanged.
--
-- Applied to the live database with the Supabase connector on Nov 22, 2026
-- (migration "tracker_insert_limits").

-- 1) Only the columns the app sends.
revoke insert on table public.poi_traffic_events from anon, authenticated;
grant insert (event_type, location_id, visitor_session_hash, browser_type, referrer_host, automation_signal, event_metadata)
  on table public.poi_traffic_events to anon, authenticated;

-- 2) to 4) Request, hourly and size limits, plus the per-visitor limits (unchanged).
create or replace function public.poi_limit_traffic_inserts()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  recent_count integer;
  site_count integer;
  req_rows integer;
  from_public boolean := current_setting('role', true) in ('anon', 'authenticated');
begin
  -- At most 25 rows per request from the public. Counted in a setting that lasts only for this request.
  if from_public then
    req_rows := coalesce(nullif(current_setting('la.traffic_req_rows', true), '')::integer, 0) + 1;
    perform set_config('la.traffic_req_rows', req_rows::text, true);
    if req_rows > 25 then
      return null;
    end if;
  end if;

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

  -- Site-wide: 3,000 rows from the public per clock hour, and none once this table passes 200 MB.
  -- Looked up once per request, then carried in a setting that lasts only for that request
  -- (saved before a row is dropped too, so a request that arrives when the hour is full stays cheap).
  if from_public then
    site_count := nullif(current_setting('la.traffic_hour_rows', true), '')::integer;
    if site_count is null then
      if pg_total_relation_size('public.poi_traffic_events') > 200 * 1024 * 1024 then
        site_count := 3000;
      else
        select count(*) into site_count from (
          select 1 from public.poi_traffic_events
          where created_at >= date_trunc('hour', now())
          limit 3000
        ) s;
      end if;
    end if;
    perform set_config('la.traffic_hour_rows', least(site_count + 1, 3000)::text, true);
    if site_count >= 3000 then
      return null;
    end if;
  end if;

  return new;
end;
$function$;
