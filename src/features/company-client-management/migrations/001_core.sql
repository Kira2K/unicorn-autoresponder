-- Rendered by schema.mts using the existing clients table's catalog mapping.
-- All DDL and the migration receipt run in one transaction. Existing tables are not altered.
CREATE SCHEMA company_management;

CREATE TABLE company_management.schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Immutable import evidence. Unresolved links stay here for review, never become global rules.
CREATE TABLE company_management.legacy_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_table_id text NOT NULL CHECK (btrim(source_table_id) <> ''),
  source_key text NOT NULL CHECK (btrim(source_key) <> ''),
  kind text NOT NULL CHECK (kind IN ('company','restriction','application','student_stop_list')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  review_status text NOT NULL DEFAULT 'needs_review' CHECK (review_status IN ('needs_review','imported','resolved')),
  issues jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(issues) = 'array'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table_id, source_key)
);

CREATE TABLE company_management.companies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  website text,
  parent_company_id bigint REFERENCES company_management.companies(id) ON DELETE RESTRICT,
  merged_into_id bigint REFERENCES company_management.companies(id) ON DELETE RESTRICT,
  legacy_record_id bigint UNIQUE REFERENCES company_management.legacy_records(id) ON DELETE RESTRICT,
  source jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(source) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_company_id IS NULL OR parent_company_id <> id),
  CHECK (merged_into_id IS NULL OR merged_into_id <> id)
);
CREATE INDEX companies_parent_idx ON company_management.companies(parent_company_id);
CREATE INDEX companies_merged_idx ON company_management.companies(merged_into_id);

CREATE TABLE company_management.company_identifiers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES company_management.companies(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('alias','domain','external_id')),
  namespace text NOT NULL CHECK (btrim(namespace) <> ''),
  value text NOT NULL CHECK (btrim(value) <> ''),
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified','rejected')),
  source jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(source) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id,type,namespace,value)
);
-- Aliases and shared domains are not globally unique. No normalization/matching is implemented.
CREATE UNIQUE INDEX verified_external_identity_idx ON company_management.company_identifiers(namespace,value)
  WHERE type='external_id' AND verification_status='verified';

CREATE TABLE company_management.company_restrictions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id bigint REFERENCES {{CLIENTS_TABLE}}({{CLIENTS_PK}}) ON DELETE RESTRICT,
  company_id bigint NOT NULL REFERENCES company_management.companies(id) ON DELETE RESTRICT,
  is_global boolean NOT NULL DEFAULT false,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  action text NOT NULL DEFAULT 'block_application' CHECK (action IN ('block_application','hold_application')),
  channels text[] NOT NULL DEFAULT ARRAY['all'],
  market text NOT NULL DEFAULT 'all' CHECK (market IN ('all','ru','en')),
  include_subsidiaries boolean NOT NULL DEFAULT false,
  active_from timestamptz NOT NULL DEFAULT now(),
  active_until timestamptz,
  revoked_at timestamptz,
  revoked_by text,
  revocation_reason text,
  review_status text NOT NULL DEFAULT 'needs_review' CHECK (review_status IN ('needs_review','verified')),
  review_due_at timestamptz,
  legacy_record_id bigint REFERENCES company_management.legacy_records(id) ON DELETE RESTRICT,
  source jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(source) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((is_global AND client_id IS NULL) OR (NOT is_global AND client_id IS NOT NULL)),
  CHECK (cardinality(channels)>0 AND array_position(channels,NULL) IS NULL AND array_position(channels,'') IS NULL),
  CHECK (NOT ('all'=ANY(channels)) OR channels=ARRAY['all']),
  CHECK (active_until IS NULL OR active_until>active_from),
  CHECK (revoked_at IS NULL OR (revoked_by IS NOT NULL AND btrim(revoked_by)<>'' AND revocation_reason IS NOT NULL AND btrim(revocation_reason)<>'')),
  UNIQUE (legacy_record_id,company_id,reason,market)
);
CREATE INDEX restrictions_client_company_idx ON company_management.company_restrictions(client_id,company_id) WHERE revoked_at IS NULL;
CREATE INDEX restrictions_company_idx ON company_management.company_restrictions(company_id);
CREATE VIEW company_management.active_restrictions AS
  SELECT * FROM company_management.company_restrictions
  WHERE revoked_at IS NULL AND active_from<=now() AND (active_until IS NULL OR active_until>now());

CREATE TABLE company_management.vacancies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES company_management.companies(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (btrim(title)<>''),
  canonical_url text NOT NULL UNIQUE CHECK (btrim(canonical_url)<>''),
  apply_url text,
  platform text,
  external_namespace text,
  external_id text,
  description text,
  location text,
  availability text NOT NULL DEFAULT 'unknown' CHECK (availability IN ('open','closed','unknown')),
  last_checked_at timestamptz,
  sources jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(sources)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((external_namespace IS NULL AND external_id IS NULL) OR
    (external_namespace IS NOT NULL AND btrim(external_namespace)<>'' AND external_id IS NOT NULL AND btrim(external_id)<>'')),
  UNIQUE (id,company_id)
);
CREATE INDEX vacancies_company_idx ON company_management.vacancies(company_id);
CREATE UNIQUE INDEX vacancies_external_identity_idx ON company_management.vacancies(external_namespace,external_id) WHERE external_id IS NOT NULL;

CREATE TABLE company_management.applications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id bigint NOT NULL REFERENCES {{CLIENTS_TABLE}}({{CLIENTS_PK}}) ON DELETE RESTRICT,
  company_id bigint NOT NULL REFERENCES company_management.companies(id) ON DELETE RESTRICT,
  vacancy_id bigint,
  channel text NOT NULL CHECK (btrim(channel)<>''),
  submission_status text NOT NULL DEFAULT 'queued' CHECK (submission_status IN
    ('queued','preparing','needs_action','submitting','submitted','failed','unknown','skipped')),
  recruitment_stage text NOT NULL DEFAULT 'unknown' CHECK (recruitment_stage IN
    ('unknown','not_started','screening','interviewing','offer','hired','rejected','withdrawn','closed')),
  reason_code text,
  confirmation_kind text NOT NULL DEFAULT 'none' CHECK (confirmation_kind IN ('none','captured','candidate_reported')),
  confirmed_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(evidence)='object'),
  legacy_record_id bigint UNIQUE REFERENCES company_management.legacy_records(id) ON DELETE RESTRICT,
  source jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(source)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (vacancy_id,company_id) REFERENCES company_management.vacancies(id,company_id) ON DELETE RESTRICT,
  CHECK ((confirmation_kind='none' AND confirmed_at IS NULL AND submission_status<>'submitted') OR
    (confirmation_kind<>'none' AND confirmed_at IS NOT NULL AND submission_status='submitted' AND evidence<>'{}'::jsonb)),
  UNIQUE (id,client_id,company_id)
);
CREATE UNIQUE INDEX applications_student_vacancy_idx ON company_management.applications(client_id,vacancy_id) WHERE vacancy_id IS NOT NULL;
CREATE INDEX applications_client_company_idx ON company_management.applications(client_id,company_id);
CREATE INDEX applications_company_idx ON company_management.applications(company_id);
CREATE INDEX applications_vacancy_company_idx ON company_management.applications(vacancy_id,company_id);

CREATE TABLE company_management.client_company_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id bigint NOT NULL REFERENCES {{CLIENTS_TABLE}}({{CLIENTS_PK}}) ON DELETE RESTRICT,
  company_id bigint NOT NULL REFERENCES company_management.companies(id) ON DELETE RESTRICT,
  application_id bigint,
  event_type text NOT NULL CHECK (btrim(event_type)<>''),
  occurred_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  assertion_status text NOT NULL DEFAULT 'reported' CHECK (assertion_status IN ('verified','reported','legacy_unverified')),
  source jsonb NOT NULL CHECK (jsonb_typeof(source)='object'),
  evidence jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(evidence)='object'),
  legacy_record_id bigint REFERENCES company_management.legacy_records(id) ON DELETE RESTRICT,
  supersedes_event_id bigint,
  FOREIGN KEY (application_id,client_id,company_id) REFERENCES company_management.applications(id,client_id,company_id) ON DELETE RESTRICT,
  UNIQUE (id,client_id,company_id),
  FOREIGN KEY (supersedes_event_id,client_id,company_id) REFERENCES company_management.client_company_events(id,client_id,company_id) ON DELETE RESTRICT,
  CHECK (supersedes_event_id IS NULL OR supersedes_event_id<>id),
  UNIQUE (legacy_record_id,event_type)
);
CREATE INDEX events_client_company_idx ON company_management.client_company_events(client_id,company_id,recorded_at DESC);
CREATE INDEX events_company_idx ON company_management.client_company_events(company_id);
CREATE INDEX events_application_idx ON company_management.client_company_events(application_id,client_id,company_id);
CREATE INDEX events_supersedes_idx ON company_management.client_company_events(supersedes_event_id);

CREATE FUNCTION company_management.reject_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Events are append-only; record a correction event' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON company_management.client_company_events
  FOR EACH STATEMENT EXECUTE FUNCTION company_management.reject_event_mutation();

CREATE FUNCTION company_management.protect_legacy_payload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Legacy evidence is retained' USING ERRCODE='23514'; END IF;
  IF (NEW.source_table_id,NEW.source_key,NEW.kind,NEW.payload,NEW.payload_sha256,NEW.recorded_at)
    IS DISTINCT FROM (OLD.source_table_id,OLD.source_key,OLD.kind,OLD.payload,OLD.payload_sha256,OLD.recorded_at) THEN
    RAISE EXCEPTION 'Legacy evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER legacy_payload_immutable BEFORE UPDATE OR DELETE ON company_management.legacy_records
  FOR EACH ROW EXECUTE FUNCTION company_management.protect_legacy_payload();
CREATE TRIGGER legacy_no_truncate BEFORE TRUNCATE ON company_management.legacy_records
  FOR EACH STATEMENT EXECUTE FUNCTION company_management.reject_event_mutation();

CREATE FUNCTION company_management.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at=now(); RETURN NEW; END;
$$;
CREATE TRIGGER companies_updated BEFORE UPDATE ON company_management.companies FOR EACH ROW EXECUTE FUNCTION company_management.touch_updated_at();
CREATE TRIGGER identifiers_updated BEFORE UPDATE ON company_management.company_identifiers FOR EACH ROW EXECUTE FUNCTION company_management.touch_updated_at();
CREATE TRIGGER restrictions_updated BEFORE UPDATE ON company_management.company_restrictions FOR EACH ROW EXECUTE FUNCTION company_management.touch_updated_at();
CREATE TRIGGER vacancies_updated BEFORE UPDATE ON company_management.vacancies FOR EACH ROW EXECUTE FUNCTION company_management.touch_updated_at();
CREATE TRIGGER applications_updated BEFORE UPDATE ON company_management.applications FOR EACH ROW EXECUTE FUNCTION company_management.touch_updated_at();

-- This reports facts and counts, not an authorization decision. No matcher or policy cutover.
CREATE VIEW company_management.client_company_summary AS
WITH pairs AS (
  SELECT client_id,company_id FROM company_management.applications
  UNION SELECT client_id,company_id FROM company_management.client_company_events
  UNION SELECT client_id,company_id FROM company_management.company_restrictions WHERE client_id IS NOT NULL
  UNION SELECT c.{{CLIENTS_PK}},r.company_id FROM {{CLIENTS_TABLE}} c
    CROSS JOIN company_management.active_restrictions r WHERE r.is_global
)
SELECT p.client_id,p.company_id,c.name,
  (SELECT count(*) FROM company_management.applications a WHERE a.client_id=p.client_id AND a.company_id=p.company_id) AS application_count,
  (SELECT count(*) FROM company_management.applications a WHERE a.client_id=p.client_id AND a.company_id=p.company_id AND a.confirmation_kind='captured') AS captured_count,
  (SELECT count(*) FROM company_management.applications a WHERE a.client_id=p.client_id AND a.company_id=p.company_id AND a.confirmation_kind='candidate_reported') AS candidate_reported_count,
  (SELECT count(*) FROM company_management.active_restrictions r WHERE r.company_id=p.company_id AND (r.client_id=p.client_id OR r.is_global) AND r.action='block_application') AS active_block_count,
  (SELECT count(*) FROM company_management.active_restrictions r WHERE r.company_id=p.company_id AND (r.client_id=p.client_id OR r.is_global) AND r.action='hold_application') AS active_hold_count
FROM pairs p JOIN company_management.companies c ON c.id=p.company_id;

COMMENT ON SCHEMA company_management IS 'Shared company/student model. Existing automation remains on legacy tables until an explicit cutover.';
COMMENT ON VIEW company_management.active_restrictions IS 'Review due dates do not deactivate rules. Consumers still apply channel, market and subsidiary scope.';
COMMENT ON TABLE company_management.company_identifiers IS 'Identifier storage only. Name resolution, normalization and merge rules are outside this migration.';
COMMENT ON TABLE company_management.legacy_records IS 'Review all unresolved rows before cutover; old tables remain authoritative until then.';
