-- Apply explicitly as the database owner; never during application startup.
-- Supports a fresh database, the earlier yes/no pilot and the deployed checkbox.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE kind text;
BEGIN
  IF current_database() NOT IN ('unicorn_noco_copy', 'unicorn_noco_copy_restore') THEN
    RAISE EXCEPTION 'Unexpected database';
  END IF;
  SELECT data_type INTO kind FROM information_schema.columns
    WHERE table_schema='noco' AND table_name='platform_accounts' AND column_name='github_empty';
  IF kind IS NULL THEN
    ALTER TABLE noco.platform_accounts ADD COLUMN github_empty boolean NOT NULL DEFAULT false;
  ELSIF kind='text' THEN
    LOCK TABLE noco.platform_accounts IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM noco.platform_accounts WHERE github_empty IS NULL OR github_empty NOT IN ('yes', 'no')) THEN
      RAISE EXCEPTION 'Unexpected github_empty values';
    END IF;
    ALTER TABLE noco.platform_accounts DROP CONSTRAINT IF EXISTS platform_accounts_github_empty_yes_no;
    ALTER TABLE noco.platform_accounts ALTER COLUMN github_empty DROP DEFAULT;
    ALTER TABLE noco.platform_accounts ALTER COLUMN github_empty TYPE boolean USING (github_empty='yes');
  ELSIF kind<>'boolean' THEN
    RAISE EXCEPTION 'Incompatible github_empty type';
  END IF;
  ALTER TABLE noco.platform_accounts ALTER COLUMN github_empty SET DEFAULT false;
  ALTER TABLE noco.platform_accounts ALTER COLUMN github_empty SET NOT NULL;
END $$;

-- Register the PostgreSQL-only checkbox in the SQL adapter's existing catalog.
LOCK TABLE copy_meta.inventory IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
  base jsonb;
  field jsonb := '{"id":"sql-only:m8zej2vsv4iypl8:github_empty","title":"github_empty","uidt":"Checkbox","sqlOnly":true}'::jsonb;
  mapping jsonb := '{"id":"sql-only:m8zej2vsv4iypl8:github_empty","title":"github_empty","sqlName":"github_empty","sqlType":"boolean"}'::jsonb;
  matches integer;
BEGIN
  SELECT definition INTO STRICT base FROM copy_meta.inventory WHERE definition->>'id'='m8zej2vsv4iypl8';
  IF base->>'sqlTable' IS DISTINCT FROM 'noco.platform_accounts'
    OR jsonb_typeof(base->'columns') IS DISTINCT FROM 'array'
    OR jsonb_typeof(base->'mapping') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Unexpected account mapping';
  END IF;
  SELECT count(*) INTO matches FROM jsonb_array_elements(base->'columns') c
    WHERE c->>'id'=field->>'id' OR c->>'title'='github_empty';
  IF matches=0 THEN
    base:=jsonb_set(base,'{columns}',(base->'columns')||jsonb_build_array(field));
  ELSIF matches<>1 OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(base->'columns') c
    WHERE c->>'id'=field->>'id' AND c->>'title'='github_empty' AND c->'sqlOnly'='true'::jsonb
      AND c->>'uidt' IN ('SingleSelect','Checkbox')) THEN
    RAISE EXCEPTION 'Conflicting github_empty field';
  ELSE
    base:=jsonb_set(base,'{columns}',(SELECT jsonb_agg(
      CASE WHEN c->>'id'=field->>'id' THEN (c-'colOptions')||field ELSE c END ORDER BY ord)
      FROM jsonb_array_elements(base->'columns') WITH ORDINALITY AS items(c,ord)));
  END IF;
  SELECT count(*) INTO matches FROM jsonb_array_elements(base->'mapping') c
    WHERE c->>'id'=mapping->>'id' OR c->>'sqlName'='github_empty' OR c->>'title'='github_empty';
  IF matches=0 THEN
    base:=jsonb_set(base,'{mapping}',(base->'mapping')||jsonb_build_array(mapping));
  ELSIF matches<>1 OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(base->'mapping') c
    WHERE c->>'id'=mapping->>'id' AND c->>'title'='github_empty' AND c->>'sqlName'='github_empty'
      AND c->>'sqlType' IN ('text','boolean')) THEN
    RAISE EXCEPTION 'Conflicting github_empty mapping';
  ELSE
    base:=jsonb_set(base,'{mapping}',(SELECT jsonb_agg(
      CASE WHEN c->>'id'=mapping->>'id' THEN c||mapping ELSE c END ORDER BY ord)
      FROM jsonb_array_elements(base->'mapping') WITH ORDINALITY AS items(c,ord)));
  END IF;
  UPDATE copy_meta.inventory SET definition=base
    WHERE definition->>'id'='m8zej2vsv4iypl8' AND definition IS DISTINCT FROM base;
END $$;
COMMIT;
