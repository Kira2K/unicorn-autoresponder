-- Apply only in an explicitly approved deployment. No data backfill or new storage.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
CREATE OR REPLACE FUNCTION noco.notify_client_tg_id()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $body$
BEGIN
  IF TG_OP='INSERT' OR NEW.telegram_personal_chat_id IS DISTINCT FROM OLD.telegram_personal_chat_id
    OR NEW.client_tg_id IS DISTINCT FROM OLD.client_tg_id
    OR NEW.__nc_deleted IS DISTINCT FROM OLD.__nc_deleted THEN
    PERFORM pg_notify('unicorn_client_tg_id', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$body$;
DROP TRIGGER IF EXISTS client_tg_id_requested ON noco.clients;
CREATE TRIGGER client_tg_id_requested
AFTER INSERT OR UPDATE OF telegram_personal_chat_id,client_tg_id,__nc_deleted ON noco.clients
FOR EACH ROW WHEN (NOT COALESCE(NEW.__nc_deleted,false)
  AND NULLIF(btrim(NEW.client_tg_id),'') IS NULL
  AND NULLIF(btrim(NEW.telegram_personal_chat_id),'') IS NOT NULL)
EXECUTE FUNCTION noco.notify_client_tg_id();
GRANT SELECT (id,telegram_personal_chat_id,client_tg_id,__nc_deleted),UPDATE (client_tg_id)
  ON noco.clients TO unicorn_sql_app;
COMMIT;
