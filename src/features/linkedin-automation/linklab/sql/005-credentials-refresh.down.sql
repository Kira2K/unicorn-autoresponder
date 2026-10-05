-- Restores the old trigger; does not erase warnings, accounts or history.
BEGIN;
SET LOCAL lock_timeout = '3s';
DROP FUNCTION noco.linklab_refresh_credentials();
CREATE TRIGGER linklab_credentials_changed AFTER UPDATE OF login,password,__nc_deleted
  ON noco.platform_accounts FOR EACH ROW EXECUTE FUNCTION noco.linklab_credentials_check();
COMMIT;
