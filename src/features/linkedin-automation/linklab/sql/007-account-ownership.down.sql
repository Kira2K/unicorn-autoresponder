BEGIN;
SET LOCAL lock_timeout='3s';
DROP TRIGGER linkedin_account_ownership_check ON noco.platform_accounts;
DROP FUNCTION noco.linkedin_account_ownership_check();
COMMIT;
