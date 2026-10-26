-- Prepared artifact only. Never executed by importing or starting the bot.
-- No existing client data, statuses or notification settings are modified.
BEGIN;
CREATE SCHEMA IF NOT EXISTS mentor_bot;
CREATE TABLE IF NOT EXISTS mentor_bot.runtime (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  environment text NOT NULL CHECK(environment IN ('disabled','local-test','release')),
  update_offset bigint NOT NULL DEFAULT 0
);
INSERT INTO mentor_bot.runtime(singleton,environment) VALUES(true,'disabled') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS mentor_bot.learners (key text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS mentor_bot.sessions (key text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS mentor_bot.checkins (key text PRIMARY KEY, payload jsonb NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS mentor_checkin_period ON mentor_bot.checkins
  ((payload->>'clientId'), (payload->>'end'));
ALTER TABLE mentor_bot.checkins DROP CONSTRAINT IF EXISTS mentor_complete_result;
ALTER TABLE mentor_bot.checkins ADD CONSTRAINT mentor_complete_result CHECK (
  NOT (payload ? 'result') OR (
    jsonb_typeof(payload->'result') = 'object' AND
    COALESCE(jsonb_typeof(payload->'result'->'recruiters') = 'boolean',false) AND
    COALESCE(jsonb_typeof(payload->'result'->'interviews') = 'boolean',false) AND
    COALESCE(jsonb_typeof(payload->'result'->'actor') = 'string',false)
  )
);
CREATE TABLE IF NOT EXISTS mentor_bot.deliveries (key text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS mentor_bot.operations (key text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS mentor_bot.history (key text PRIMARY KEY, payload jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS mentor_delivery_state ON mentor_bot.deliveries ((payload->>'state'));
-- Grants to the deployment role are intentionally a separate, reviewed release action.
COMMIT;
