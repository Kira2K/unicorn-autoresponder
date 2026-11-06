BEGIN;
DROP TRIGGER IF EXISTS client_tg_id_requested ON noco.clients;
DROP FUNCTION IF EXISTS noco.notify_client_tg_id();
-- Existing IDs and pre-existing application permissions are preserved.
COMMIT;
