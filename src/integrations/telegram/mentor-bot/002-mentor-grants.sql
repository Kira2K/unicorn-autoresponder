-- Prepared release artifact. DO NOT APPLY as part of local development.
-- Requires reviewed 001 migration and the existing application role.
BEGIN;
GRANT USAGE ON SCHEMA mentor_bot TO unicorn_sql_app;
GRANT SELECT,INSERT,UPDATE ON mentor_bot.learners,mentor_bot.sessions,mentor_bot.checkins,
  mentor_bot.deliveries,mentor_bot.operations TO unicorn_sql_app;
GRANT SELECT,INSERT ON mentor_bot.history TO unicorn_sql_app;
GRANT DELETE ON mentor_bot.sessions TO unicorn_sql_app;
GRANT SELECT ON mentor_bot.runtime TO unicorn_sql_app;
GRANT UPDATE(update_offset) ON mentor_bot.runtime TO unicorn_sql_app;
GRANT SELECT(id,client_id,old_status,new_status,changed_at) ON noco.client_status_history TO unicorn_sql_app;
GRANT UPDATE(client_status,market_id,tg_hard_mentor,tg_soft_mentor) ON noco.clients TO unicorn_sql_app;
-- Existing noco.clients read permissions and its status-history trigger are prerequisites.
-- The application cannot change the environment marker or grant itself release access.
COMMIT;
