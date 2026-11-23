-- Undo for 2026-11-23-backup-structure.sql.
-- Removes public.backup_structure(). Nothing else uses it except the backup-export
-- edge function, which then still saves every row and file but writes
-- "Database structure NOT saved" in the backup README (and the backup run turns red).
drop function if exists public.backup_structure();
