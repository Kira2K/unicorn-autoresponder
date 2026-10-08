-- Apply explicitly as the database owner after a verified full backup.
-- Compatible with the previous application; intentionally no inventory changes.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE expected record; actual record;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('current_company', 'text', false, NULL::text),
    ('previous_companies', 'text', false, NULL::text),
    ('middle_name', 'text', false, NULL::text),
    ('no_higher_education', 'boolean', true, 'false')
  ) AS fields(name, sql_type, required, default_expr)
  LOOP
    SELECT a.atttypid::regtype::text AS sql_type, a.attnotnull AS required,
      pg_get_expr(d.adbin, d.adrelid) AS default_expr, a.attgenerated, a.attidentity
      INTO actual
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='noco.clients'::regclass AND a.attname=expected.name AND NOT a.attisdropped;
    IF FOUND AND (actual.sql_type IS DISTINCT FROM expected.sql_type
      OR actual.required IS DISTINCT FROM expected.required
      OR actual.default_expr IS DISTINCT FROM expected.default_expr
      OR actual.attgenerated <> '' OR actual.attidentity <> '') THEN
      RAISE EXCEPTION 'Incompatible existing noco.clients column: %', expected.name;
    END IF;
  END LOOP;
END $$;

ALTER TABLE noco.clients
  ADD COLUMN IF NOT EXISTS current_company text,
  ADD COLUMN IF NOT EXISTS previous_companies text,
  ADD COLUMN IF NOT EXISTS middle_name text,
  ADD COLUMN IF NOT EXISTS no_higher_education boolean NOT NULL DEFAULT false;

-- Serialize the existence check with concurrent platform writes, without blocking reads.
LOCK TABLE noco.platforms IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE matches integer; new_id bigint;
BEGIN
  SELECT count(*) INTO matches FROM noco.platforms
    WHERE lower(trim(name))='phone_ru' OR lower(trim(label))='phone_ru';
  IF matches > 1 THEN RAISE EXCEPTION 'Duplicate phone_ru platforms'; END IF;
  IF matches = 1 AND EXISTS (SELECT 1 FROM noco.platforms
    WHERE (lower(trim(name))='phone_ru' OR lower(trim(label))='phone_ru')
      AND (name IS DISTINCT FROM 'phone_ru' OR label IS DISTINCT FROM 'phone_ru'
        OR market IS DISTINCT FROM 'Ru' OR coalesce(__nc_deleted,false)
        OR _copy_id IS DISTINCT FROM json_build_array(id::text)::text)) THEN
    RAISE EXCEPTION 'Incompatible existing phone_ru platform';
  END IF;
  IF matches = 0 THEN
    new_id := nextval(pg_get_serial_sequence('noco.platforms','id'));
    IF new_id IS NULL THEN RAISE EXCEPTION 'Platform ID sequence is missing'; END IF;
    INSERT INTO noco.platforms (id,name,label,market,created_at,updated_at,_copy_id,_copy_source)
      VALUES (new_id,'phone_ru','phone_ru','Ru',statement_timestamp(),statement_timestamp(),
        json_build_array(new_id::text)::text,
        jsonb_build_object('Id',new_id,'name','phone_ru','label','phone_ru','market','Ru'));
  END IF;
END $$;
COMMIT;
