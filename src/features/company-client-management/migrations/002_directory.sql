-- Reviewed source directory. Old identities remain only to preserve restrictions/history.
ALTER TABLE company_management.companies
  ADD COLUMN directory_status text NOT NULL DEFAULT 'legacy_reference' CHECK(directory_status IN ('active','legacy_reference')),
  ADD COLUMN import_key text UNIQUE,
  ADD COLUMN comment text NOT NULL DEFAULT '',
  ADD COLUMN markets text[] NOT NULL DEFAULT '{}',
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN languages text[] NOT NULL DEFAULT '{}',
  ADD COLUMN aliases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN contacts jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(contacts)='array'),
  ADD COLUMN application_route text NOT NULL DEFAULT 'standard_workflow' CHECK(application_route IN ('standard_workflow','notify_only')),
  ADD CONSTRAINT directory_active_source CHECK(directory_status<>'active' OR import_key IS NOT NULL);

CREATE TABLE company_management.sources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_key text NOT NULL UNIQUE,
  company_id bigint REFERENCES company_management.companies(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK(btrim(name)<>''),
  type text NOT NULL CHECK(type IN ('website','aggregator','tg-channel','linkedin')),
  url text NOT NULL CHECK(url ~ '^https?://[^/[:space:]]+'),
  disposition text NOT NULL CHECK(disposition IN ('enabled','blocked_linkedin','superseded')),
  comment text NOT NULL DEFAULT '',
  provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(type<>'linkedin' OR disposition='blocked_linkedin'),
  CHECK(url !~* '^https?://([^/]*\.)?(linkedin\.com|lnkd\.in)([:/]|$)' OR (type='linkedin' AND disposition='blocked_linkedin'))
);
CREATE INDEX sources_company_idx ON company_management.sources(company_id);
CREATE TRIGGER sources_updated BEFORE UPDATE ON company_management.sources FOR EACH ROW EXECUTE FUNCTION company_management.touch_updated_at();

CREATE TABLE company_management.directory_imports (
  checksum text PRIMARY KEY CHECK(checksum ~ '^[a-f0-9]{64}$'),
  plan_checksum text NOT NULL,
  source_file_id text NOT NULL,
  snapshot jsonb NOT NULL,
  before_state jsonb NOT NULL,
  summary jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER directory_imports_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON company_management.directory_imports
  FOR EACH STATEMENT EXECUTE FUNCTION company_management.reject_event_mutation();

CREATE VIEW company_management.company_directory AS
  SELECT c.*,
    ARRAY(SELECT DISTINCT s.type FROM company_management.sources s WHERE s.company_id=c.id AND s.disposition<>'superseded' ORDER BY s.type) AS source_types,
    ARRAY(SELECT DISTINCT p->>'type' FROM jsonb_array_elements(c.contacts) p ORDER BY p->>'type') AS contact_types
  FROM company_management.companies c WHERE c.directory_status='active';
COMMENT ON VIEW company_management.company_directory IS 'Authoritative reviewed source companies only. Historical identity rows remain outside this view to retain restrictions and application links.';
COMMENT ON COLUMN company_management.companies.application_route IS 'Data only. notify_only means list in a report and do not auto-apply. No assignee or notification workflow is required.';
COMMENT ON TABLE company_management.directory_imports IS 'Immutable import receipt and pre-import backup. A lost commit acknowledgment is reconciled by checksum.';
