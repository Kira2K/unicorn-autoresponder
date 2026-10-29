-- Explicit owner migration before deploying the existing-LinkedIn guided flow.
-- No historical handoffs, notifications, or account data are replayed.
ALTER TABLE noco.platform_accounts
 ADD COLUMN IF NOT EXISTS linkedin_octo_connection_pending boolean NOT NULL DEFAULT false;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='noco' AND table_name='platform_accounts'
  AND column_name='linkedin_octo_connection_pending' AND data_type='boolean' AND is_nullable='NO') THEN
  RAISE EXCEPTION 'linkedin_octo_connection_pending must be a nonnullable boolean';
 END IF;
END $$;
