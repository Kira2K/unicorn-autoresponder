-- Explicit migration only. Existing students must be linked with their real CRM status
-- before enabling LINKLAB_ENABLED in the console.
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE noco.linklab_changes ADD COLUMN handoff boolean NOT NULL DEFAULT false;
ALTER TABLE noco.linklab_changes DROP CONSTRAINT linklab_changes_source_check;
ALTER TABLE noco.linklab_changes ADD CONSTRAINT linklab_changes_source_check
  CHECK (source IN ('noco','crm','cabinet'));

CREATE TABLE noco.linklab_cv_approvals (
  workflow_id bigint PRIMARY KEY,
  client_id bigint NOT NULL REFERENCES noco.clients(id),
  en_version_url text NOT NULL CHECK (length(btrim(en_version_url)) > 0),
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE noco.linklab ADD COLUMN en_approved_at timestamptz;
ALTER TABLE noco.linklab ADD COLUMN credentials_issue text;

CREATE FUNCTION noco.linklab_credentials_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE issue text;
BEGIN
  IF TG_TABLE_NAME = 'linklab' THEN
    SELECT CASE WHEN COALESCE(a.__nc_deleted,false) THEN 'linkedin_account_missing'
      WHEN NOT COALESCE(a.login ~ '[^[:space:]]' AND a.password ~ '[^[:space:]]',false)
      THEN 'linkedin_credentials_incomplete' END INTO issue
      FROM noco.platform_accounts a WHERE a.id=NEW.platform_account_id;
    NEW.credentials_issue := issue;
    RETURN NEW;
  END IF;
  issue := CASE WHEN COALESCE(NEW.__nc_deleted,false) THEN 'linkedin_account_missing'
    WHEN NOT COALESCE(NEW.login ~ '[^[:space:]]' AND NEW.password ~ '[^[:space:]]',false)
    THEN 'linkedin_credentials_incomplete' END;
  UPDATE noco.linklab SET credentials_issue=issue
    WHERE platform_account_id=NEW.id AND credentials_issue IS DISTINCT FROM issue;
  RETURN NULL;
END $$;
CREATE TRIGGER linklab_credentials_initial BEFORE INSERT ON noco.linklab
  FOR EACH ROW EXECUTE FUNCTION noco.linklab_credentials_check();
CREATE TRIGGER linklab_credentials_changed AFTER UPDATE OF login,password,__nc_deleted ON noco.platform_accounts
  FOR EACH ROW EXECUTE FUNCTION noco.linklab_credentials_check();

CREATE FUNCTION noco.linklab_cv_date() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME = 'linklab' THEN
    NEW.en_approved_at := (SELECT max(approved_at) FROM noco.linklab_cv_approvals WHERE client_id=NEW.client_id);
    RETURN NEW;
  END IF;
  UPDATE noco.linklab SET en_approved_at=(
    SELECT max(approved_at) FROM noco.linklab_cv_approvals WHERE client_id=NEW.client_id
  ) WHERE client_id=NEW.client_id;
  RETURN NULL;
END $$;
CREATE TRIGGER linklab_cv_initial BEFORE INSERT ON noco.linklab
  FOR EACH ROW EXECUTE FUNCTION noco.linklab_cv_date();
CREATE TRIGGER linklab_cv_date AFTER INSERT OR UPDATE ON noco.linklab_cv_approvals
  FOR EACH ROW EXECUTE FUNCTION noco.linklab_cv_date();
REVOKE ALL ON TABLE noco.linklab_cv_approvals FROM PUBLIC;
REVOKE ALL ON FUNCTION noco.linklab_cv_date() FROM PUBLIC;
REVOKE ALL ON FUNCTION noco.linklab_credentials_check() FROM PUBLIC;
COMMIT;
