-- Explicit migration only. Execute inside the existing checked writeTransaction.
-- Source table metadata remains unchanged; register through the SQL-only extension.
SELECT pg_advisory_xact_lock(1789941002, 1);
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM copy_meta.inventory
    WHERE definition->>'id' = 'msr3ihfj0kjue1t'
      AND definition->>'sqlTable' = 'noco.stacks'
      AND definition->'mapping' @> '[{"title":"Id","sqlName":"id","sqlType":"bigint"},{"title":"name","sqlName":"name","sqlType":"text"}]'::jsonb
  ) THEN RAISE EXCEPTION 'stack_table_mapping_mismatch'; END IF;
  IF (SELECT count(*) FROM noco.stacks WHERE lower(btrim(name)) = 'java') <> 1
     OR NOT EXISTS (SELECT 1 FROM noco.stacks WHERE id = 5 AND lower(btrim(name)) = 'java')
  THEN RAISE EXCEPTION 'java_stack_identity_mismatch'; END IF;
END $$;

ALTER TABLE noco.stacks ADD COLUMN IF NOT EXISTS stack_description text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'noco' AND table_name = 'stacks'
      AND column_name = 'stack_description' AND data_type = 'text' AND is_nullable = 'YES'
  ) THEN RAISE EXCEPTION 'stack_description_type_mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM noco.stacks WHERE id = 5 AND stack_description IS NOT NULL
      AND stack_description <> 'Middle/senior backend positions using Java and the Spring framework.'
  ) THEN RAISE EXCEPTION 'java_description_already_configured'; END IF;
END $$;

INSERT INTO copy_meta.inventory (id, definition)
VALUES ('external-responses:stack-description:v1',
  '{"sqlOnlyFor":"msr3ihfj0kjue1t","columns":[{"name":"stack_description","sqlType":"text"}]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM copy_meta.inventory WHERE id = 'external-responses:stack-description:v1'
      AND definition = '{"sqlOnlyFor":"msr3ihfj0kjue1t","columns":[{"name":"stack_description","sqlType":"text"}]}'::jsonb
  ) THEN RAISE EXCEPTION 'stack_description_metadata_conflict'; END IF;
END $$;

COMMENT ON COLUMN noco.stacks.stack_description IS
  'Vacancy search criteria for this existing student stack: role, seniority, required technologies and exclusions. NULL means unconfigured. Campaigns only use stacks with linked students.';

UPDATE noco.stacks
SET stack_description = 'Middle/senior backend positions using Java and the Spring framework.',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 5 AND stack_description IS NULL;
