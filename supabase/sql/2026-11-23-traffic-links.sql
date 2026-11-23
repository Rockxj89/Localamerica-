-- Scoreboard (Nov 23, 2026): traffic_links() feeds the "Scoreboard" section of the private Traffic page.
--
-- Links made with the Traffic page's link maker end in ?s=<tag> (localamerica.us/r is ?s=r). The app
-- (index.html) and the place pages (place-page.js) save that tag as event_metadata.src on every event of
-- the visit. This function counts visits, people, place views and unlock taps per tag, next to each site's
-- visits without a tag (the same site names as "Where visitors come from" in traffic_summary), for the
-- same period as the page's buttons. Bots are left out the same way as in traffic_summary.
-- Only the owner can run it (is_traffic_admin, like the other Traffic page functions). Tags come from
-- visitors' browsers, so anything that isn't 1-40 lowercase letters, numbers and dashes counts as untagged,
-- and the page escapes everything it shows.
--
-- Applied to the live database with the Supabase connector on Nov 23, 2026 (migration "traffic_links").
-- Undo: 2026-11-23-traffic-links.undo.sql

create or replace function public.traffic_links(p_days integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_since timestamptz;
begin
  if not public.is_traffic_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 3650) then p_days := 30; end if;
  v_since := case when p_days is null then '-infinity'::timestamptz else now() - make_interval(days => p_days) end;

  return (
    with clean as (
      select e.event_type, e.visitor_session_hash, e.referrer_host,
        case when e.event_metadata->>'src' ~ '^[a-z0-9-]{1,40}$' then e.event_metadata->>'src' end as tag,
        coalesce(s.session_class, 'no_details') as session_class
      from poi_traffic_events e
      left join poi_traffic_session_class s on s.visitor_session_hash = e.visitor_session_hash
      where e.created_at >= v_since
        and coalesce(s.session_class, 'none') <> 'automated'
        and not e.automation_signal
        and coalesce(e.browser_type, '') <> 'Bot or automation'
    ),
    labeled as (
      select *, (tag is not null) as tagged, case
        when tag is not null then tag
        when referrer_host is null then 'Direct or unknown'
        when referrer_host ilike '%facebook.com' or referrer_host ilike '%fb.com' or referrer_host ilike '%messenger.com' or referrer_host = 'fb.me' then 'Facebook'
        when referrer_host ilike '%instagram.com' then 'Instagram'
        when referrer_host ilike '%reddit.com' or referrer_host ilike '%redd.it' then 'Reddit'
        when referrer_host ilike '%google%' then 'Google'
        when referrer_host ilike '%glideapps.dev' or referrer_host ilike '%glideapps.com' or referrer_host ilike '%glideos.app' or referrer_host ilike '%vercel.app' then 'Local America own links'
        else 'Other sites' end as link
      from clean
    )
    select coalesce(jsonb_agg(x order by (x->>'people')::int desc, (x->>'opens')::int desc, x->>'link'), '[]'::jsonb)
    from (
      select jsonb_build_object('link', link, 'tagged', tagged,
        'opens', count(*) filter (where event_type = 'app_open'),
        'people', count(distinct visitor_session_hash) filter (where session_class = 'person'),
        'place_views', count(*) filter (where event_type = 'place_view'),
        'unlock_taps', count(*) filter (where event_type = 'unlock_gps_click')) x
      from labeled
      group by link, tagged
    ) t
  );
end
$function$;

revoke execute on function public.traffic_links(integer) from public, anon;
grant execute on function public.traffic_links(integer) to authenticated;
