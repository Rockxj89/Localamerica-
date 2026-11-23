-- Undo for 2026-11-23-delete-old-visits.sql: stop deleting old visit records.
-- After this, the Privacy page's "deleted automatically after 2 years" is no longer true, so change
-- that sentence back too (index.html, Privacy, "How long things are kept").
--
-- backup_structure() can stay as it is: with poi_delete_old_traffic() gone it writes no job block,
-- and leaving pg_cron out of its extension list is harmless. To put the exact old version back as
-- well, run supabase/sql/2026-11-23-backup-structure.sql again.

select cron.unschedule('delete-old-visits')
 where exists (select 1 from cron.job where jobname = 'delete-old-visits');

drop function if exists public.poi_delete_old_traffic();

-- Turn Supabase Cron off again only if no other job uses it by then (this also removes its run history):
do $$
begin
  if to_regclass('cron.job') is not null then
    if not exists (select 1 from cron.job) then
      drop extension pg_cron;
    end if;
  end if;
end
$$;
