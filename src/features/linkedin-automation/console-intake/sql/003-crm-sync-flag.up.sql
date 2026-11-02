-- Apply explicitly before deploying Console; no CRM calls or historical replay.
ALTER TABLE noco.platform_accounts
 ADD COLUMN IF NOT EXISTS "isUnsyncedWithCRM" boolean NOT NULL DEFAULT false;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='noco' AND table_name='platform_accounts'
  AND column_name='isUnsyncedWithCRM' AND data_type='boolean' AND is_nullable='NO' AND column_default='false') THEN
  RAISE EXCEPTION 'isUnsyncedWithCRM must be boolean NOT NULL DEFAULT false';
 END IF;
END $$;

-- Only Console composition sets this transaction-local marker. Imports keep DEFAULT false.
-- UPDATE is deliberately excluded: edits, ban/archive and task confirmation preserve the flag.
CREATE OR REPLACE FUNCTION noco.linkedin_console_crm_unsynced() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_setting('unicorn.console_account_creation',true)='1' AND EXISTS(
  SELECT 1 FROM noco.platforms p WHERE p.id=NEW.platforms_id AND lower(p.name)='linkedin'
 ) THEN NEW."isUnsyncedWithCRM":=true; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER linkedin_console_crm_unsynced BEFORE INSERT ON noco.platform_accounts
 FOR EACH ROW EXECUTE FUNCTION noco.linkedin_console_crm_unsynced();
