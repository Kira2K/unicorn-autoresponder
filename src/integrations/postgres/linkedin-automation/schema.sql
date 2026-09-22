-- Apply explicitly with migration credentials, never from application startup.
CREATE SCHEMA IF NOT EXISTS linkedin_automation;
CREATE TABLE IF NOT EXISTS linkedin_automation.schema_version (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), version integer NOT NULL,
  withdrawals_imported boolean NOT NULL DEFAULT false
);
INSERT INTO linkedin_automation.schema_version(singleton,version) VALUES(true,1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS linkedin_automation.settings (
  account_id bigint PRIMARY KEY CHECK(account_id>0), revision integer NOT NULL CHECK(revision>0),
  data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')
);
CREATE TABLE IF NOT EXISTS linkedin_automation.runs (
  run_key text PRIMARY KEY, account_id bigint NOT NULL CHECK(account_id>0),
  updated_at bigint NOT NULL, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')
);
CREATE INDEX IF NOT EXISTS automation_runs_account_updated ON linkedin_automation.runs(account_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS linkedin_automation.withdrawals (
  account_id bigint PRIMARY KEY CHECK(account_id>0), data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')
);
CREATE TABLE IF NOT EXISTS linkedin_automation.events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at bigint NOT NULL,
  account_id bigint, run_key text, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')
);
CREATE INDEX IF NOT EXISTS automation_events_run ON linkedin_automation.events(run_key,id DESC);
CREATE INDEX IF NOT EXISTS automation_events_account ON linkedin_automation.events(account_id,id DESC);
CREATE TABLE IF NOT EXISTS linkedin_automation.worker (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), data jsonb NOT NULL
);
