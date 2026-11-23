-- Undo for 2026-11-23-traffic-links.sql: removes the scoreboard function. The Traffic page then says the
-- scoreboard could not load; everything else keeps working. Tags already saved in event_metadata stay.
drop function if exists public.traffic_links(integer);
