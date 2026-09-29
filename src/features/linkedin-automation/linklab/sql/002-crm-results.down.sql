BEGIN;
SET LOCAL lock_timeout = '3s';
LOCK TABLE noco.linklab,noco.linklab_changes,noco.linklab_crm_results IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM noco.linklab_crm_results)
    OR EXISTS(SELECT 1 FROM noco.linklab WHERE profile_revision >= 0 OR proxy_cycle_id IS NOT NULL)
    OR EXISTS(SELECT 1 FROM noco.linklab_changes WHERE proxy_cycle_id IS NOT NULL) THEN
    RAISE EXCEPTION 'linklab_results_exist_export_and_reconcile_before_rollback';
  END IF;
END $$;
DROP TRIGGER linklab_workflow_before ON noco.linklab;
DROP TRIGGER linklab_workflow_after ON noco.linklab;
DROP FUNCTION noco.linklab_workflow_before(),noco.linklab_workflow_after();
DROP FUNCTION noco.linklab_apply_crm_result(uuid,bigint,uuid,text,jsonb);
DROP TABLE noco.linklab_crm_results;
ALTER TABLE noco.linklab_changes DROP COLUMN proxy_cycle_id, DROP COLUMN proxy_started_at;
ALTER TABLE noco.linklab DROP COLUMN profile_revision, DROP COLUMN profile_percent,
  DROP COLUMN profile_filled_count, DROP COLUMN profile_first_completed_at,
  DROP COLUMN proxy_state, DROP COLUMN proxy_cycle_id, DROP COLUMN proxy_started_at,
  DROP COLUMN proxy_ends_at, DROP COLUMN proxy_completed_at;
COMMIT;
