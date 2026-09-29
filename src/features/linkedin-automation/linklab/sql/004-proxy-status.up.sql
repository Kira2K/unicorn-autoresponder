BEGIN;
SET LOCAL lock_timeout = '3s';
LOCK TABLE noco.linklab IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM noco.linklab WHERE proxy_state='Активна') THEN
    RAISE EXCEPTION 'linklab_active_proxy_finish_before_migration';
  END IF;
END $$;

ALTER TABLE noco.linklab
  ADD COLUMN proxy_previous_status text CHECK
    (proxy_previous_status IN ('Новый','Прогрев','Раскачка','Пауза','Блок','Завершен')),
  ADD COLUMN proxy_status_overridden boolean NOT NULL DEFAULT false;

-- Alphabetic order: after ordinary status validation, before cycle creation.
-- Existing triggers still own IDs, deadlines and event delivery.
CREATE FUNCTION noco.linklab_proxy_status_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  NEW.proxy_previous_status := OLD.proxy_previous_status;
  NEW.proxy_status_overridden := OLD.proxy_status_overridden;
  IF OLD.proxy_state='Не активна' AND NEW.proxy_state='Активна' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'linklab_proxy_status_edit_separately';
    END IF;
    NEW.proxy_previous_status := OLD.status;
    NEW.proxy_status_overridden := false;
    NEW.status := 'Пауза';
    -- The existing workflow trigger advances the version for activation.
  ELSIF OLD.proxy_state='Активна' AND NEW.proxy_state='Не активна' THEN
    -- The existing workflow trigger still rejects early or forged completion.
    IF NOT OLD.proxy_status_overridden AND OLD.proxy_previous_status IS NOT NULL THEN
      NEW.status := OLD.proxy_previous_status;
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        NEW.version := OLD.version + 1;
        NEW.updated_at := clock_timestamp();
      END IF;
      -- Returning to an earlier Block is not a new actual block event.
      NEW.blocked_at := OLD.blocked_at;
    END IF;
  ELSIF OLD.proxy_state='Активна' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.proxy_status_overridden := true;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION noco.linklab_proxy_status_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE marker text;
BEGIN
  IF OLD.proxy_state='Не активна' AND NEW.proxy_state='Активна' THEN
    marker := 'proxy_status_paused';
  ELSIF OLD.proxy_state='Активна' AND NEW.proxy_state='Не активна'
    AND NEW.status IS DISTINCT FROM OLD.status THEN
    marker := 'proxy_status_restored';
  ELSE
    RETURN NULL;
  END IF;
  UPDATE noco.linklab_changes SET changed_fields=changed_fields || ARRAY[marker]
    WHERE client_id=NEW.client_id AND version=NEW.version;
  IF NOT FOUND THEN RAISE EXCEPTION 'linklab_proxy_status_event_missing'; END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER linklab_proxy_status_before BEFORE UPDATE ON noco.linklab
  FOR EACH ROW EXECUTE FUNCTION noco.linklab_proxy_status_before();
CREATE TRIGGER linklab_proxy_status_after AFTER UPDATE ON noco.linklab
  FOR EACH ROW EXECUTE FUNCTION noco.linklab_proxy_status_after();
REVOKE ALL ON FUNCTION noco.linklab_proxy_status_before(),noco.linklab_proxy_status_after() FROM PUBLIC;
COMMIT;
