-- Explicit owner migration only. The operator command writes a verified backup first.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $$
BEGIN
  IF current_database() NOT IN ('unicorn_noco_copy','unicorn_noco_copy_restore') OR
    (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())
    IS DISTINCT FROM 'unicorn-noco-copy:pqe5susktrsa9z3:20260911:v1' THEN
    RAISE EXCEPTION 'Copy database required';
  END IF;
  IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='noco.octo_profiles'::regclass)
    IS DISTINCT FROM current_user THEN RAISE EXCEPTION 'Run as the Octo table owner'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='unicorn_sql_app') THEN
    RAISE EXCEPTION 'unicorn_sql_app role required';
  END IF;
END $$;
LOCK TABLE noco.octo_profiles IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  -- The FK is the atomic completion marker. Reruns allow operations started afterwards.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='noco.octo_profiles'::regclass
    AND conname='octo_profiles_client_password_fk') THEN
    IF EXISTS (SELECT client_id FROM noco.octo_profiles GROUP BY client_id
      HAVING count(DISTINCT state->>'password')>1) THEN
      RAISE EXCEPTION 'Existing client profiles have different passwords; manual reconciliation required';
    END IF;
    IF EXISTS (SELECT 1 FROM noco.octo_profiles WHERE
      state ? 'pending' OR state->>'phase' IN ('queued','creating') OR
      state->'grant'->>'phase' IS NOT NULL AND state->'grant'->>'phase'<>'complete' OR
      state->'grant' ? 'pending' OR state->'proxyChange' ? 'pending' OR
      state->'proxyChange'->>'phase' IS NOT NULL AND state->'proxyChange'->>'phase'<>'complete') THEN
      RAISE EXCEPTION 'Pending Octo operations must finish before first onboarding migration';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM copy_meta.inventory WHERE
    definition->>'sqlTable'='noco.octo_clients' OR definition->>'table_name'='octo_clients') THEN
    RAISE EXCEPTION 'Private client state cannot be exposed in common inventory';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS noco.octo_clients (
  client_id bigint PRIMARY KEY REFERENCES noco.clients(id),
  password text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  state jsonb NOT NULL,
  CONSTRAINT octo_clients_password_check CHECK (password ~ '^[0-9]{5}$'),
  CONSTRAINT octo_clients_revision_check CHECK (revision>0),
  CONSTRAINT octo_clients_password_unique UNIQUE(password),
  CONSTRAINT octo_clients_client_password_unique UNIQUE(client_id,password),
  CONSTRAINT octo_clients_state_check CHECK (
    jsonb_typeof(state)='object' AND state ?& ARRAY['clientId','revision','password']
    AND jsonb_typeof(state->'password')='string' AND state->>'password'=password
    AND (state->>'clientId')::bigint=client_id AND (state->>'revision')::bigint=revision)
);
DO $$
DECLARE expected record; actual record;
BEGIN
  IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='noco.octo_clients'::regclass)
    IS DISTINCT FROM current_user THEN RAISE EXCEPTION 'Incompatible client table owner'; END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('client_id','bigint',NULL::text),('password','text',NULL::text),
    ('revision','bigint','1'),('state','jsonb',NULL::text)
  ) AS fields(name,sql_type,default_expr) LOOP
    SELECT a.atttypid::regtype::text AS sql_type,a.attnotnull,a.attgenerated,a.attidentity,
      pg_get_expr(d.adbin,d.adrelid) AS default_expr INTO actual
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='noco.octo_clients'::regclass AND a.attname=expected.name AND NOT a.attisdropped;
    IF NOT FOUND OR actual.sql_type IS DISTINCT FROM expected.sql_type OR NOT actual.attnotnull OR
      actual.attgenerated<>'' OR actual.attidentity<>'' OR actual.default_expr IS DISTINCT FROM expected.default_expr THEN
      RAISE EXCEPTION 'Incompatible client column: %',expected.name;
    END IF;
  END LOOP;
END $$;
-- Never rewrite profile JSON or common profile rows: preserve all existing credentials.
INSERT INTO noco.octo_clients(client_id,password,revision,state)
  SELECT client_id,min(state->>'password'),1,
    jsonb_build_object('clientId',client_id,'password',min(state->>'password'),'revision',1)
  FROM noco.octo_profiles GROUP BY client_id ON CONFLICT(client_id) DO NOTHING;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM noco.octo_profiles p JOIN noco.octo_clients c USING(client_id)
    WHERE p.state->>'password' IS DISTINCT FROM c.password) THEN
    RAISE EXCEPTION 'Existing client password conflicts with profile';
  END IF;
END $$;
ALTER TABLE noco.octo_profiles ADD COLUMN IF NOT EXISTS password text
  GENERATED ALWAYS AS (state->>'password') STORED NOT NULL;
DO $$
DECLARE actual record;
BEGIN
  SELECT a.atttypid::regtype::text AS sql_type,a.attnotnull,a.attgenerated,a.attidentity,
    pg_get_expr(d.adbin,d.adrelid) AS expr INTO actual
    FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='noco.octo_profiles'::regclass AND a.attname='password' AND NOT a.attisdropped;
  IF NOT FOUND OR actual.sql_type<>'text' OR NOT actual.attnotnull OR actual.attgenerated<>'s' OR
    actual.attidentity<>'' OR actual.expr IS DISTINCT FROM '(state ->> ''password''::text)' THEN
    RAISE EXCEPTION 'Incompatible generated profile password';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='noco.octo_profiles'::regclass
    AND conname='octo_profiles_client_password_fk') THEN
    ALTER TABLE noco.octo_profiles ADD CONSTRAINT octo_profiles_client_password_fk
      FOREIGN KEY(client_id,password) REFERENCES noco.octo_clients(client_id,password);
  END IF;
END $$;
DO $$
DECLARE expected record; actual text;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('octo_clients','octo_clients_pkey','PRIMARY KEY (client_id)'),
    ('octo_clients','octo_clients_client_id_fkey','FOREIGN KEY (client_id) REFERENCES noco.clients(id)'),
    ('octo_clients','octo_clients_password_check','CHECK (password ~ ''^[0-9]{5}$'')'),
    ('octo_clients','octo_clients_revision_check','CHECK (revision > 0)'),
    ('octo_clients','octo_clients_password_unique','UNIQUE (password)'),
    ('octo_clients','octo_clients_client_password_unique','UNIQUE (client_id,password)'),
    ('octo_clients','octo_clients_state_check','CHECK (jsonb_typeof(state)=''object'' AND state ?& ARRAY[''clientId'',''revision'',''password''] AND jsonb_typeof(state->''password'')=''string'' AND state->>''password''=password AND (state->>''clientId'')::bigint=client_id AND (state->>''revision'')::bigint=revision)'),
    ('octo_profiles','octo_profiles_client_password_fk','FOREIGN KEY (client_id,password) REFERENCES noco.octo_clients(client_id,password)')
  ) AS constraints(table_name,name,definition) LOOP
    SELECT pg_get_constraintdef(oid) INTO actual FROM pg_constraint
      WHERE conrelid=('noco.'||expected.table_name)::regclass AND conname=expected.name AND convalidated;
    IF actual IS NULL OR regexp_replace(replace(actual,'::text',''),'[[:space:]()]','','g')
      IS DISTINCT FROM regexp_replace(expected.definition,'[[:space:]()]','','g') THEN
      RAISE EXCEPTION 'Incompatible onboarding constraint: %',expected.name;
    END IF;
  END LOOP;
END $$;
DROP INDEX IF EXISTS noco.octo_profiles_password_unique;
REVOKE ALL ON noco.octo_clients FROM PUBLIC,unicorn_sql_app;
GRANT SELECT,INSERT,UPDATE ON noco.octo_clients TO unicorn_sql_app;
COMMIT;
