-- Apply explicitly as the owner of noco.dolphin_profiles after a verified backup.
-- No application startup path applies this migration. Existing Dolphin IDs are untouched.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF current_database() NOT IN ('unicorn_noco_copy','unicorn_noco_copy_restore') OR
    (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())
      IS DISTINCT FROM 'unicorn-noco-copy:pqe5susktrsa9z3:20260911:v1' THEN
    RAISE EXCEPTION 'Copy database required';
  END IF;
  IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='noco.dolphin_profiles'::regclass)
    IS DISTINCT FROM current_user THEN RAISE EXCEPTION 'Run as the dolphin_profiles owner'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='unicorn_sql_app') THEN
    RAISE EXCEPTION 'unicorn_sql_app role required';
  END IF;
END $$;

-- Refuse incompatible pre-existing columns rather than silently accepting IF NOT EXISTS.
DO $$
DECLARE expected record; actual record;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('browser','text',true,'''dolphin''::text'),
    ('octo_profile_id','text',false,NULL::text)
  ) AS fields(name,sql_type,required,default_expr)
  LOOP
    SELECT a.atttypid::regtype::text AS sql_type,a.attnotnull AS required,
      pg_get_expr(d.adbin,d.adrelid) AS default_expr,a.attgenerated,a.attidentity INTO actual
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='noco.dolphin_profiles'::regclass AND a.attname=expected.name AND NOT a.attisdropped;
    IF FOUND AND (actual.sql_type IS DISTINCT FROM expected.sql_type OR actual.required IS DISTINCT FROM expected.required
      OR actual.default_expr IS DISTINCT FROM expected.default_expr OR actual.attgenerated<>'' OR actual.attidentity<>'') THEN
      RAISE EXCEPTION 'Incompatible dolphin_profiles column: %',expected.name;
    END IF;
  END LOOP;
END $$;
ALTER TABLE noco.dolphin_profiles
  ADD COLUMN IF NOT EXISTS browser text NOT NULL DEFAULT 'dolphin',
  ADD COLUMN IF NOT EXISTS octo_profile_id text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='noco.dolphin_profiles'::regclass AND conname='octo_browser_check') THEN
    ALTER TABLE noco.dolphin_profiles ADD CONSTRAINT octo_browser_check CHECK (browser IN ('dolphin','octo'));
  ELSIF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='noco.dolphin_profiles'::regclass AND conname='octo_browser_check')
    IS DISTINCT FROM 'CHECK ((browser = ANY (ARRAY[''dolphin''::text, ''octo''::text])))' THEN
    RAISE EXCEPTION 'Incompatible octo_browser_check';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS octo_common_client_locale_unique
  ON noco.dolphin_profiles ("02_clients_id",lower(locale)) WHERE browser='octo';
CREATE UNIQUE INDEX IF NOT EXISTS octo_common_uuid_unique
  ON noco.dolphin_profiles (lower(replace(octo_profile_id,'-',''))) WHERE browser='octo' AND octo_profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS noco.octo_profiles (
  profile_id bigint PRIMARY KEY REFERENCES noco.dolphin_profiles(id),
  client_id bigint NOT NULL REFERENCES noco.clients(id),
  locale text NOT NULL CHECK (locale IN ('ru','en')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
  state jsonb NOT NULL,
  CONSTRAINT octo_profiles_client_locale_unique UNIQUE (client_id,locale),
  CONSTRAINT octo_profiles_state_check CHECK (
    jsonb_typeof(state)='object' AND state ?& ARRAY['id','revision','clientId','locale','password']
    AND jsonb_typeof(state->'password')='string' AND state->>'password' ~ '^[0-9]{5}$'
    AND (state->>'id')::bigint=profile_id AND (state->>'revision')::bigint=revision
    AND (state->>'clientId')::bigint=client_id AND state->>'locale'=locale)
);
-- The private state intentionally stores the profile password as a JSON string.
CREATE UNIQUE INDEX IF NOT EXISTS octo_profiles_password_unique ON noco.octo_profiles ((state->>'password'));
CREATE UNIQUE INDEX IF NOT EXISTS octo_profiles_proxy_unique
  ON noco.octo_profiles (lower(replace(state->'proxy'->>'uuid','-',''))) WHERE state->'proxy'->>'uuid' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS octo_profiles_uuid_unique
  ON noco.octo_profiles (lower(replace(state->>'uuid','-',''))) WHERE state->>'uuid' IS NOT NULL;

CREATE TABLE IF NOT EXISTS noco.octo_event_inbox (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  object_uuid text NOT NULL CHECK (object_uuid=lower(replace(object_uuid,'-','')) AND length(object_uuid)>0),
  action text NOT NULL,
  event_time double precision NOT NULL,
  title text
);
CREATE INDEX IF NOT EXISTS octo_event_profile_seq ON noco.octo_event_inbox (object_uuid,seq);
CREATE TABLE IF NOT EXISTS noco.octo_stream (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  cursor jsonb,
  coverage_since double precision NOT NULL DEFAULT 0 CHECK (coverage_since>=0)
);
INSERT INTO noco.octo_stream(singleton) VALUES(true) ON CONFLICT(singleton) DO NOTHING;

-- Check existing private tables as well: reruns must not accept incompatible schemas.
DO $$
DECLARE expected record; actual record;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('octo_profiles','profile_id','bigint',true,''),('octo_profiles','client_id','bigint',true,''),
    ('octo_profiles','locale','text',true,''),('octo_profiles','revision','bigint',true,''),
    ('octo_profiles','state','jsonb',true,''),('octo_event_inbox','seq','bigint',true,'a'),
    ('octo_event_inbox','event_id','text',true,''),('octo_event_inbox','object_uuid','text',true,''),
    ('octo_event_inbox','action','text',true,''),('octo_event_inbox','event_time','double precision',true,''),
    ('octo_event_inbox','title','text',false,''),('octo_stream','singleton','boolean',true,''),
    ('octo_stream','cursor','jsonb',false,''),('octo_stream','coverage_since','double precision',true,'')
  ) AS fields(table_name,name,sql_type,required,identity_kind)
  LOOP
    SELECT a.atttypid::regtype::text AS sql_type,a.attnotnull AS required,a.attgenerated,a.attidentity INTO actual
      FROM pg_attribute a WHERE a.attrelid=('noco.'||expected.table_name)::regclass
        AND a.attname=expected.name AND NOT a.attisdropped;
    IF NOT FOUND OR actual.sql_type IS DISTINCT FROM expected.sql_type OR actual.required IS DISTINCT FROM expected.required
      OR actual.attgenerated<>'' OR actual.attidentity IS DISTINCT FROM expected.identity_kind THEN
      RAISE EXCEPTION 'Incompatible Octo schema: %.%',expected.table_name,expected.name;
    END IF;
    IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=('noco.'||expected.table_name)::regclass)
      IS DISTINCT FROM current_user THEN RAISE EXCEPTION 'Incompatible Octo table owner'; END IF;
  END LOOP;
END $$;

DO $$
DECLARE expected record; actual text;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('octo_common_client_locale_unique','CREATE UNIQUE INDEX octo_common_client_locale_unique ON noco.dolphin_profiles USING btree ("02_clients_id",lower(locale)) WHERE browser=''octo'''),
    ('octo_common_uuid_unique','CREATE UNIQUE INDEX octo_common_uuid_unique ON noco.dolphin_profiles USING btree (lower(replace(octo_profile_id,''-'',''''))) WHERE browser=''octo'' AND octo_profile_id IS NOT NULL'),
    ('octo_profiles_password_unique','CREATE UNIQUE INDEX octo_profiles_password_unique ON noco.octo_profiles USING btree ((state->>''password''))'),
    ('octo_profiles_proxy_unique','CREATE UNIQUE INDEX octo_profiles_proxy_unique ON noco.octo_profiles USING btree (lower(replace(state->''proxy''->>''uuid'',''-'',''''))) WHERE state->''proxy''->>''uuid'' IS NOT NULL'),
    ('octo_profiles_uuid_unique','CREATE UNIQUE INDEX octo_profiles_uuid_unique ON noco.octo_profiles USING btree (lower(replace(state->>''uuid'',''-'',''''))) WHERE state->>''uuid'' IS NOT NULL'),
    ('octo_event_profile_seq','CREATE INDEX octo_event_profile_seq ON noco.octo_event_inbox USING btree (object_uuid,seq)')
  ) AS indexes(name,definition)
  LOOP
    SELECT pg_get_indexdef(c.oid) INTO actual FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_index i ON i.indexrelid=c.oid WHERE n.nspname='noco' AND c.relname=expected.name AND i.indisvalid;
    IF actual IS NULL OR regexp_replace(replace(actual,'::text',''),'[[:space:]()]','','g')
      IS DISTINCT FROM regexp_replace(expected.definition,'[[:space:]()]','','g') THEN
      RAISE EXCEPTION 'Incompatible Octo index: %',expected.name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='noco.octo_profiles'::regclass
      AND contype='u' AND conkey=ARRAY[2,3]::smallint[]) OR
    NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='noco.octo_profiles'::regclass
      AND contype='p' AND conkey=ARRAY[1]::smallint[]) OR
    NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='noco.octo_profiles'::regclass
      AND contype='f' AND conkey=ARRAY[1]::smallint[] AND confrelid='noco.dolphin_profiles'::regclass) OR
    NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='noco.octo_event_inbox'::regclass
      AND contype='u' AND conkey=ARRAY[2]::smallint[]) OR
    NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='noco.octo_stream'::regclass AND contype='p') THEN
    RAISE EXCEPTION 'Octo key constraints required';
  END IF;
END $$;

-- Local inventory extension exposes only the browser discriminator to legacy consumers.
-- No private table, password, state or Octo UUID is added to the common catalog.
LOCK TABLE copy_meta.inventory IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE base jsonb; extension jsonb;
BEGIN
  SELECT definition INTO STRICT base FROM copy_meta.inventory WHERE definition->>'id'='m4thvbutfyb15qz';
  IF base->>'sqlTable' IS DISTINCT FROM 'noco.dolphin_profiles' THEN RAISE EXCEPTION 'Unexpected profile mapping'; END IF;
  extension := '{"sqlOnlyFor":"m4thvbutfyb15qz","columns":[{"name":"browser","sqlType":"text"}]}'::jsonb;
  IF EXISTS (SELECT 1 FROM copy_meta.inventory WHERE id='octo_browser_local' AND definition IS DISTINCT FROM extension) THEN
    RAISE EXCEPTION 'Incompatible Octo browser inventory extension';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM copy_meta.inventory WHERE id='octo_browser_local') AND (
    EXISTS (SELECT 1 FROM jsonb_array_elements(base->'columns') c WHERE c->>'title'='browser') OR
    EXISTS (SELECT 1 FROM copy_meta.inventory i CROSS JOIN LATERAL jsonb_array_elements(i.definition->'columns') c
      WHERE i.definition->>'sqlOnlyFor'='m4thvbutfyb15qz' AND c->>'name'='browser')
  ) THEN RAISE EXCEPTION 'Conflicting browser inventory extension'; END IF;
  INSERT INTO copy_meta.inventory(id,definition) VALUES('octo_browser_local',extension) ON CONFLICT(id) DO NOTHING;
END $$;

REVOKE ALL ON noco.octo_profiles,noco.octo_event_inbox,noco.octo_stream FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON noco.octo_profiles,noco.octo_event_inbox,noco.octo_stream TO unicorn_sql_app;
GRANT USAGE,SELECT ON SEQUENCE noco.octo_event_inbox_seq_seq TO unicorn_sql_app;
COMMIT;
