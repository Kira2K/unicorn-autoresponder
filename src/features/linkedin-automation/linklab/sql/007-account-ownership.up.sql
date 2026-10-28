-- Explicit owner migration. Does not repair or rewrite any student/account mapping.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM noco.linklab l JOIN noco.platform_accounts a ON a.id=l.platform_account_id
   WHERE a.clients_id IS DISTINCT FROM l.client_id OR a.platforms_id IS DISTINCT FROM 16::bigint) THEN
  RAISE EXCEPTION 'linklab_existing_account_ownership_requires_review';
 END IF;
END $$;
CREATE FUNCTION noco.linkedin_account_ownership_check() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF ROW(NEW.clients_id,NEW.platforms_id) IS DISTINCT FROM ROW(OLD.clients_id,OLD.platforms_id)
  AND (EXISTS(SELECT 1 FROM noco.linklab WHERE platform_account_id=OLD.id)
    OR EXISTS(SELECT 1 FROM noco.linkedin_creation_task WHERE linkedin_account_id=OLD.id OR outlook_account_id=OLD.id)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='linkedin_account_binding_immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER linkedin_account_ownership_check BEFORE UPDATE OF clients_id,platforms_id ON noco.platform_accounts
 FOR EACH ROW EXECUTE FUNCTION noco.linkedin_account_ownership_check();
REVOKE ALL ON FUNCTION noco.linkedin_account_ownership_check() FROM PUBLIC;
COMMIT;
