-- Five business tables remain in noco. Execution checkpoints stay private.
ALTER TABLE noco.company_restrictions
  ALTER COLUMN company_id DROP NOT NULL,
  ADD COLUMN scope text NOT NULL DEFAULT 'company' CHECK(scope IN ('company','contextual')),
  ADD COLUMN instruction text NOT NULL DEFAULT '',
  ADD COLUMN context jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(context)='object'),
  ADD COLUMN import_key text UNIQUE,
  ADD COLUMN hh_names text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT restriction_scope_required CHECK(
    (scope='company' AND company_id IS NOT NULL) OR
    (scope='contextual' AND company_id IS NULL AND btrim(instruction)<>''));
CREATE OR REPLACE VIEW noco.active_restrictions AS
  SELECT * FROM noco.company_restrictions
  WHERE revoked_at IS NULL AND active_from<=now() AND (active_until IS NULL OR active_until>now());

CREATE TABLE company_management.collection_runs (
  id text PRIMARY KEY,
  collection json NOT NULL,
  checksum text NOT NULL,
  classification json,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(json_typeof(collection)='object'),
  CHECK(classification IS NULL OR json_typeof(classification)='object')
);
CREATE TABLE company_management.vacancy_stacks (
  run_id text NOT NULL REFERENCES company_management.collection_runs(id) ON DELETE RESTRICT,
  vacancy_id bigint NOT NULL REFERENCES noco.vacancies(id) ON DELETE RESTRICT,
  stack_id bigint NOT NULL REFERENCES {{STACKS_TABLE}}({{STACKS_PK}}) ON DELETE RESTRICT,
  decision text NOT NULL CHECK(decision IN ('matched','review','excluded')),
  evidence jsonb NOT NULL,
  PRIMARY KEY(run_id,vacancy_id,stack_id)
);
CREATE TABLE company_management.application_batches (
  client_id bigint NOT NULL REFERENCES {{CLIENTS_TABLE}}({{CLIENTS_PK}}) ON DELETE RESTRICT,
  id text NOT NULL,
  state json NOT NULL CHECK(json_typeof(state)='object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(client_id,id)
);
COMMENT ON TABLE noco.company_restrictions IS 'Canonical company and contextual student policies. Contextual interpretation is external-only for now. hh_names preserves explicitly imported legacy HH name lists; new contextual rules leave it empty.';
COMMENT ON TABLE company_management.collection_runs IS 'Immutable full-company collection and classification snapshots; not a second vacancy directory.';
COMMENT ON TABLE company_management.application_batches IS 'Durable target limits and resumable submission state. Business outcomes are projected atomically into noco.applications.';
