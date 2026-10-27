ALTER TABLE noco.platform_accounts
  ADD COLUMN IF NOT EXISTS outlook_registered_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='noco' AND table_name='platform_accounts'
      AND column_name='outlook_registered_at' AND data_type='timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'outlook_registered_at must have type timestamptz';
  END IF;
END $$;
