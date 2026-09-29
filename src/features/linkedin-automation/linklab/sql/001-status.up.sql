-- Apply explicitly, as the schema owner. Never run from application startup.
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE noco.clients ADD COLUMN client_role text
  CONSTRAINT clients_client_role_check CHECK (client_role IN ('клиент','ученик','реферал','фейк'));

CREATE TABLE noco.linklab (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id bigint NOT NULL UNIQUE REFERENCES noco.clients(id),
  platform_account_id bigint REFERENCES noco.platform_accounts(id) ON DELETE SET NULL,
  account_issue text GENERATED ALWAYS AS
    (CASE WHEN platform_account_id IS NULL THEN 'linkedin_account_missing' END) STORED,
  status text NOT NULL DEFAULT 'Новый'
    CONSTRAINT linklab_status_check CHECK (status IN ('Новый','Прогрев','Раскачка','Пауза','Блок','Завершен')),
  new_account_url text,
  blocked_at timestamptz,
  new_account_due_date date GENERATED ALWAYS AS
    (((blocked_at AT TIME ZONE 'Europe/Moscow')::date) + 30) STORED,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  confirmed_version bigint NOT NULL DEFAULT 0 CHECK (confirmed_version >= 0 AND confirmed_version <= version),
  crm_student_id uuid CONSTRAINT linklab_crm_student_unique UNIQUE,
  sync_error text,
  sync_error_version bigint,
  sync_state text GENERATED ALWAYS AS (CASE
    WHEN confirmed_version = version THEN 'Готово'
    WHEN sync_error IS NOT NULL THEN 'Ошибка' ELSE 'Ожидание' END) STORED,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at timestamptz
);

CREATE TABLE noco.linklab_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id bigint NOT NULL REFERENCES noco.linklab(client_id),
  platform_account_id bigint,
  version bigint NOT NULL,
  previous_version bigint NOT NULL,
  previous_status text,
  status text NOT NULL,
  new_account_url text,
  changed_fields text[] NOT NULL,
  source text NOT NULL CHECK (source IN ('noco','crm')),
  source_operation_id uuid UNIQUE,
  db_actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  crm_receipt_id uuid UNIQUE,
  confirmed_at timestamptz,
  UNIQUE (client_id, version),
  CHECK (version = previous_version + 1)
);

-- Keep no-op commands too: a retry must not become a new change after later edits.
CREATE TABLE noco.linklab_commands (
  operation_id uuid PRIMARY KEY,
  client_id bigint NOT NULL REFERENCES noco.linklab(client_id),
  expected_version bigint NOT NULL,
  status text NOT NULL,
  event_id bigint REFERENCES noco.linklab_changes(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION noco.linklab_before_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM noco.platform_accounts a JOIN noco.platforms p ON p.id = a.platforms_id
      JOIN noco.clients c ON c.id = a.clients_id
      WHERE a.id = NEW.platform_account_id AND a.clients_id = NEW.client_id
        AND p.id = 16 AND lower(p.name) = 'linkedin'
        AND NOT COALESCE(a.__nc_deleted,false) AND NOT COALESCE(p.__nc_deleted,false)
        AND NOT COALESCE(c.__nc_deleted,false)
      FOR SHARE OF a,p,c;
    IF NOT FOUND THEN RAISE EXCEPTION 'linklab_account_owner_or_linkedin_account_invalid'; END IF;
    NEW.version := 1;
    NEW.confirmed_version := 0;
    NEW.crm_student_id := NULL;
    NEW.sync_error := NULL;
    NEW.sync_error_version := NULL;
    NEW.confirmed_at := NULL;
    -- Bootstrap does not invent a historic block date; only trusted history may supply it.
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
  ELSE
    IF ROW(NEW.id,NEW.client_id) IS DISTINCT FROM ROW(OLD.id,OLD.client_id) THEN
      RAISE EXCEPTION 'linklab_binding_immutable';
    END IF;
    IF NEW.platform_account_id IS DISTINCT FROM OLD.platform_account_id THEN
      -- Preserve normal account deletion, but never allow a user to silently rebind LinkLab.
      IF NEW.platform_account_id IS NOT NULL OR EXISTS(
        SELECT 1 FROM noco.platform_accounts WHERE id=OLD.platform_account_id
      ) THEN RAISE EXCEPTION 'linklab_binding_immutable'; END IF;
    END IF;
    NEW.version := OLD.version;
    NEW.created_at := OLD.created_at;
    NEW.blocked_at := OLD.blocked_at;
    NEW.updated_at := OLD.updated_at;
    IF ROW(NEW.status,NEW.new_account_url,NEW.platform_account_id) IS DISTINCT FROM
       ROW(OLD.status,OLD.new_account_url,OLD.platform_account_id) THEN
      NEW.version := OLD.version + 1;
      NEW.updated_at := clock_timestamp();
      IF NEW.status = 'Блок' AND OLD.status <> 'Блок' THEN NEW.blocked_at := NEW.updated_at; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION noco.linklab_after_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE fields text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    fields := ARRAY['created','status'];
  ELSE
    IF NEW.version = OLD.version THEN RETURN NULL; END IF;
    fields := ARRAY[]::text[];
    IF NEW.status IS DISTINCT FROM OLD.status THEN fields := fields || ARRAY['status']; END IF;
    IF NEW.new_account_url IS DISTINCT FROM OLD.new_account_url THEN fields := fields || ARRAY['new_account_url']; END IF;
    IF NEW.platform_account_id IS DISTINCT FROM OLD.platform_account_id THEN fields := fields || ARRAY['platform_account_id']; END IF;
  END IF;
  INSERT INTO noco.linklab_changes(client_id,platform_account_id,version,previous_version,
    previous_status,status,new_account_url,changed_fields,source,db_actor)
    VALUES(NEW.client_id,NEW.platform_account_id,NEW.version,NEW.version-1,
      CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END,
      NEW.status,NEW.new_account_url,fields,'noco',session_user);
  RETURN NULL;
END $$;

CREATE TRIGGER linklab_before_change BEFORE INSERT OR UPDATE ON noco.linklab
  FOR EACH ROW EXECUTE FUNCTION noco.linklab_before_change();
CREATE TRIGGER linklab_after_change AFTER INSERT OR UPDATE ON noco.linklab
  FOR EACH ROW EXECUTE FUNCTION noco.linklab_after_change();

-- Fetch the next version for each student; ID alone is not commit order.
CREATE VIEW noco.linklab_pending_changes WITH (security_invoker=true) AS
SELECT e.* FROM noco.linklab_changes e JOIN noco.linklab l USING(client_id)
WHERE e.version = l.confirmed_version + 1;

CREATE FUNCTION noco.linklab_request_status(
  p_client_id bigint, p_expected_version bigint, p_operation_id uuid, p_status text
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_row noco.linklab; command noco.linklab_commands; event_id bigint;
BEGIN
  IF p_operation_id IS NULL OR p_expected_version IS NULL OR p_status IS NULL THEN
    RAISE EXCEPTION 'linklab_command_required';
  END IF;
  SELECT * INTO current_row FROM noco.linklab WHERE client_id=p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'linklab_client_missing'; END IF;
  SELECT * INTO command FROM noco.linklab_commands WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF ROW(command.client_id,command.expected_version,command.status) IS DISTINCT FROM
       ROW(p_client_id,p_expected_version,p_status) THEN RAISE EXCEPTION 'linklab_operation_conflict'; END IF;
    RETURN command.event_id;
  END IF;
  IF current_row.version <> p_expected_version THEN RAISE EXCEPTION 'linklab_version_conflict'; END IF;
  UPDATE noco.linklab SET status=p_status WHERE client_id=p_client_id;
  IF current_row.status IS DISTINCT FROM p_status THEN
    SELECT id INTO STRICT event_id FROM noco.linklab_changes
      WHERE client_id=p_client_id AND version=current_row.version+1;
    UPDATE noco.linklab_changes SET source='crm',source_operation_id=p_operation_id WHERE id=event_id;
  END IF;
  INSERT INTO noco.linklab_commands(operation_id,client_id,expected_version,status,event_id)
    VALUES(p_operation_id,p_client_id,p_expected_version,p_status,event_id);
  RETURN event_id;
END $$;

CREATE FUNCTION noco.linklab_acknowledge(p_event_id bigint, p_crm_student_id uuid, p_receipt_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE event noco.linklab_changes; current_row noco.linklab;
BEGIN
  IF p_crm_student_id IS NULL OR p_receipt_id IS NULL THEN RAISE EXCEPTION 'linklab_receipt_required'; END IF;
  SELECT * INTO event FROM noco.linklab_changes WHERE id=p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'linklab_event_missing'; END IF;
  SELECT * INTO current_row FROM noco.linklab WHERE client_id=event.client_id FOR UPDATE;
  -- Reread after locking: another worker may have committed the same confirmation.
  SELECT * INTO event FROM noco.linklab_changes WHERE id=p_event_id;
  IF current_row.crm_student_id IS NOT NULL AND current_row.crm_student_id <> p_crm_student_id THEN
    RAISE EXCEPTION 'linklab_binding_conflict';
  END IF;
  IF event.crm_receipt_id IS NOT NULL THEN
    IF event.crm_receipt_id <> p_receipt_id THEN RAISE EXCEPTION 'linklab_receipt_conflict'; END IF;
    RETURN false;
  END IF;
  IF event.version <> current_row.confirmed_version+1 THEN RAISE EXCEPTION 'linklab_out_of_order'; END IF;
  UPDATE noco.linklab_changes SET crm_receipt_id=p_receipt_id,confirmed_at=clock_timestamp() WHERE id=p_event_id;
  UPDATE noco.linklab SET confirmed_version=event.version,crm_student_id=p_crm_student_id,
    confirmed_at=clock_timestamp(),
    sync_error=CASE WHEN sync_error_version=event.version THEN NULL ELSE sync_error END,
    sync_error_version=CASE WHEN sync_error_version=event.version THEN NULL ELSE sync_error_version END
    WHERE client_id=event.client_id;
  RETURN true;
END $$;

CREATE FUNCTION noco.linklab_record_failure(p_event_id bigint, p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE event noco.linklab_changes; current_row noco.linklab;
BEGIN
  IF p_code IS NULL OR p_code NOT IN ('crm_unavailable','crm_conflict','binding_missing',
    'binding_conflict','account_ambiguous','crm_apply_failed') THEN RAISE EXCEPTION 'linklab_error_code_invalid'; END IF;
  SELECT * INTO event FROM noco.linklab_changes WHERE id=p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'linklab_event_missing'; END IF;
  SELECT * INTO current_row FROM noco.linklab WHERE client_id=event.client_id FOR UPDATE;
  IF event.version <= current_row.confirmed_version THEN RETURN false; END IF;
  IF event.version <> current_row.confirmed_version+1 THEN RAISE EXCEPTION 'linklab_out_of_order'; END IF;
  UPDATE noco.linklab SET sync_error=p_code,sync_error_version=event.version WHERE client_id=event.client_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION noco.linklab_before_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION noco.linklab_after_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION noco.linklab_request_status(bigint,bigint,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION noco.linklab_acknowledge(bigint,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION noco.linklab_record_failure(bigint,text) FROM PUBLIC;
REVOKE ALL ON TABLE noco.linklab,noco.linklab_changes,noco.linklab_commands,noco.linklab_pending_changes FROM PUBLIC;
REVOKE ALL ON SEQUENCE noco.linklab_id_seq,noco.linklab_changes_id_seq FROM PUBLIC;
COMMIT;
