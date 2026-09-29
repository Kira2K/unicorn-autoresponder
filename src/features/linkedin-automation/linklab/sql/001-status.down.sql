-- Refuse destructive rollback after any new data. No CASCADE or ID rewinding.
BEGIN;
SET LOCAL lock_timeout = '3s';
LOCK TABLE noco.linklab,noco.linklab_changes,noco.linklab_commands,noco.clients IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM noco.linklab) OR EXISTS(SELECT 1 FROM noco.linklab_changes)
    OR EXISTS(SELECT 1 FROM noco.linklab_commands)
    OR EXISTS(SELECT 1 FROM noco.clients WHERE client_role IS NOT NULL) THEN
    RAISE EXCEPTION 'linklab_data_exists_export_and_reconcile_before_rollback';
  END IF;
END $$;
DROP VIEW noco.linklab_pending_changes;
DROP FUNCTION noco.linklab_request_status(bigint,bigint,uuid,text);
DROP FUNCTION noco.linklab_acknowledge(bigint,uuid,uuid);
DROP FUNCTION noco.linklab_record_failure(bigint,text);
DROP TRIGGER linklab_before_change ON noco.linklab;
DROP TRIGGER linklab_after_change ON noco.linklab;
DROP FUNCTION noco.linklab_before_change();
DROP FUNCTION noco.linklab_after_change();
DROP TABLE noco.linklab_commands;
DROP TABLE noco.linklab_changes;
DROP TABLE noco.linklab;
ALTER TABLE noco.clients DROP COLUMN client_role;
COMMIT;
