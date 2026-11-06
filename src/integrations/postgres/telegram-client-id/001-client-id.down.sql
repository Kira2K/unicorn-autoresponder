BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DROP TRIGGER IF EXISTS client_tg_id_requested ON noco.clients;
DROP FUNCTION IF EXISTS noco.notify_client_tg_id();
-- Existing IDs and pre-existing application permissions are preserved.
COMMIT;
