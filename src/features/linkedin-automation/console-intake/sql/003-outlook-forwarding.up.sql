ALTER TABLE noco.platform_accounts
  ADD COLUMN IF NOT EXISTS outlook_forwarding_confirmed_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='noco' AND table_name='platform_accounts'
    AND column_name='outlook_forwarding_confirmed_at' AND data_type='timestamp with time zone') THEN
    RAISE EXCEPTION 'outlook_forwarding_confirmed_at must have type timestamptz';
  END IF;
END $$;
GRANT SELECT, UPDATE(outlook_forwarding_confirmed_at) ON noco.platform_accounts TO unicorn_sql_app;
CREATE OR REPLACE FUNCTION noco.outlook_forwarding_mailbox_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF lower(btrim(NEW.login)) IS DISTINCT FROM lower(btrim(OLD.login)) THEN
    NEW.outlook_forwarding_confirmed_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS outlook_forwarding_mailbox_guard ON noco.platform_accounts;
CREATE TRIGGER outlook_forwarding_mailbox_guard BEFORE UPDATE OF login ON noco.platform_accounts
  FOR EACH ROW EXECUTE FUNCTION noco.outlook_forwarding_mailbox_guard();
