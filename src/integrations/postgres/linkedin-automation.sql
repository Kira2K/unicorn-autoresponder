-- Apply explicitly with migration credentials. Backend never runs DDL.
BEGIN;
CREATE SCHEMA IF NOT EXISTS linkedin_automation;
CREATE TABLE IF NOT EXISTS linkedin_automation.control (
  id boolean PRIMARY KEY DEFAULT true CHECK (id), schema_version integer NOT NULL,
  owner text, epoch bigint NOT NULL DEFAULT 0, lease_until timestamptz,
  heartbeat_at timestamptz
);
INSERT INTO linkedin_automation.control(id, schema_version) VALUES(true, 1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS linkedin_automation.schedules (
  account_id bigint PRIMARY KEY, account_key text NOT NULL UNIQUE, version integer NOT NULL,
  state jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS linkedin_automation.tasks (
  id text PRIMARY KEY, account_key text NOT NULL, feature text NOT NULL,
  version integer NOT NULL, state jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS linkedin_automation_tasks_account ON linkedin_automation.tasks(account_key);
CREATE INDEX IF NOT EXISTS linkedin_automation_tasks_updated ON linkedin_automation.tasks(((state->>'updatedAt')::numeric));
CREATE INDEX IF NOT EXISTS linkedin_automation_tasks_pending ON linkedin_automation.tasks((state->>'state'))
  WHERE state->>'state' NOT IN ('completed','stopped');
CREATE INDEX IF NOT EXISTS linkedin_automation_last_post ON linkedin_automation.tasks(account_key,((state->>'publishedAt')::numeric) DESC)
  WHERE state->>'publishedAt' IS NOT NULL;
CREATE TABLE IF NOT EXISTS linkedin_automation.events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz NOT NULL,
  account_id bigint, task_id text, state jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS linkedin_automation_events_at ON linkedin_automation.events(at);
CREATE TABLE IF NOT EXISTS linkedin_automation.cooldowns (
  account_key text NOT NULL, method text NOT NULL, until_at timestamptz NOT NULL,
  state jsonb NOT NULL, PRIMARY KEY(account_key, method)
);
CREATE TABLE IF NOT EXISTS linkedin_automation.withdrawals (
  account_id bigint PRIMARY KEY, state jsonb NOT NULL
);
COMMIT;
-- Grant USAGE on schema, SELECT/INSERT/UPDATE/DELETE on these tables and
-- USAGE/SELECT on its sequences to the backend role. Do not grant CREATE.
