BEGIN;
SET LOCAL lock_timeout = '3s';
LOCK TABLE noco.linklab IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM noco.linklab WHERE proxy_previous_status IS NOT NULL) THEN
    RAISE EXCEPTION 'linklab_proxy_status_exists_export_before_rollback';
  END IF;
END $$;
DROP TRIGGER linklab_proxy_status_before ON noco.linklab;
DROP TRIGGER linklab_proxy_status_after ON noco.linklab;
DROP FUNCTION noco.linklab_proxy_status_before(),noco.linklab_proxy_status_after();
ALTER TABLE noco.linklab DROP COLUMN proxy_previous_status, DROP COLUMN proxy_status_overridden;
COMMIT;
