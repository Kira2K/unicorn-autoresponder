BEGIN;
SET LOCAL lock_timeout = '3s';
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM noco.linklab_cv_approvals)
    OR EXISTS(SELECT 1 FROM noco.linklab_changes WHERE handoff OR source='cabinet') THEN
    RAISE EXCEPTION 'linklab_intake_data_exists';
  END IF;
END $$;
DROP TRIGGER linklab_cv_initial ON noco.linklab;
DROP TRIGGER linklab_cv_date ON noco.linklab_cv_approvals;
DROP FUNCTION noco.linklab_cv_date();
DROP TRIGGER linklab_credentials_changed ON noco.platform_accounts;
DROP TRIGGER linklab_credentials_initial ON noco.linklab;
DROP FUNCTION noco.linklab_credentials_check();
ALTER TABLE noco.linklab DROP COLUMN credentials_issue;
ALTER TABLE noco.linklab DROP COLUMN en_approved_at;
DROP TABLE noco.linklab_cv_approvals;
ALTER TABLE noco.linklab_changes DROP COLUMN handoff;
ALTER TABLE noco.linklab_changes DROP CONSTRAINT linklab_changes_source_check;
ALTER TABLE noco.linklab_changes ADD CONSTRAINT linklab_changes_source_check CHECK (source IN ('noco','crm'));
COMMIT;
