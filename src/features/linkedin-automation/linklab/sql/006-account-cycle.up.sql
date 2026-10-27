-- CRM СЕЙЧАС НЕ ПОДКЛЮЧАЕМ. ДЛЯ БУДУЩЕГО ПОДКЛЮЧЕНИЯ НУЖНО ИЗМЕНИТЬ ЕЁ ЛОГИКУ:
-- ПЕРЕДАВАТЬ НОВЫЙ ЦИКЛ И ПРИВЯЗЫВАТЬ РЕЗУЛЬТАТЫ К КОНКРЕТНОМУ LINKEDIN-АККАУНТУ.
-- Explicit owner migration after LinkLab 001-005 and creation-tasks 001-002. No automatic startup DDL.
BEGIN;
ALTER TABLE noco.linklab ADD COLUMN crm_integration_required boolean NOT NULL DEFAULT false;
CREATE TABLE noco.linkedin_account_cycles(
 task_id bigint PRIMARY KEY REFERENCES noco.linkedin_creation_task(id),
 client_id bigint NOT NULL REFERENCES noco.clients(id), account_id bigint NOT NULL UNIQUE REFERENCES noco.platform_accounts(id),
 old_account_id bigint, previous_state jsonb, applied_at timestamptz);
CREATE TABLE noco.linkedin_cycle_notifications(
 task_id bigint PRIMARY KEY REFERENCES noco.linkedin_account_cycles(task_id),client_id bigint NOT NULL,account_id bigint NOT NULL,
 url text NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','attempting','sent','failed','uncertain')),
 claimed_at timestamptz,claim_token uuid,message_id bigint,error_code text);
CREATE OR REPLACE FUNCTION noco.linklab_before_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE new_cycle boolean;
BEGIN
  new_cycle := EXISTS(SELECT 1 FROM noco.linkedin_account_cycles c WHERE c.client_id=NEW.client_id AND c.account_id=NEW.platform_account_id AND c.applied_at IS NULL);
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
      IF NOT new_cycle AND (NEW.platform_account_id IS NOT NULL OR EXISTS(
        SELECT 1 FROM noco.platform_accounts WHERE id=OLD.platform_account_id
      )) THEN RAISE EXCEPTION 'linklab_binding_immutable'; END IF;
    END IF;
    NEW.version := OLD.version;
    NEW.created_at := OLD.created_at;
    IF NOT new_cycle THEN NEW.blocked_at := OLD.blocked_at; END IF;
    NEW.updated_at := OLD.updated_at;
    IF new_cycle OR ROW(NEW.status,NEW.new_account_url,NEW.platform_account_id) IS DISTINCT FROM
       ROW(OLD.status,OLD.new_account_url,OLD.platform_account_id) THEN
      NEW.version := OLD.version + 1;
      NEW.updated_at := clock_timestamp();
      IF NEW.status = 'Блок' AND OLD.status <> 'Блок' THEN NEW.blocked_at := NEW.updated_at; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION noco.linklab_after_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE fields text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    fields := ARRAY['created','status'];
  ELSE
    IF NEW.version = OLD.version THEN RETURN NULL; END IF;
    fields := ARRAY[]::text[];
    IF EXISTS(SELECT 1 FROM noco.linkedin_account_cycles c WHERE c.client_id=NEW.client_id AND c.account_id=NEW.platform_account_id AND c.applied_at IS NULL) THEN fields:=fields||ARRAY['account_cycle_started']; END IF;
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

CREATE OR REPLACE FUNCTION noco.linklab_request_status(
  p_client_id bigint, p_expected_version bigint, p_operation_id uuid, p_status text
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_row noco.linklab; command noco.linklab_commands; event_id bigint;
BEGIN
  IF p_operation_id IS NULL OR p_expected_version IS NULL OR p_status IS NULL THEN
    RAISE EXCEPTION 'linklab_command_required';
  END IF;
  SELECT * INTO current_row FROM noco.linklab WHERE client_id=p_client_id FOR UPDATE;
  IF current_row.crm_integration_required THEN RAISE EXCEPTION 'linklab_crm_integration_required'; END IF;
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

CREATE OR REPLACE FUNCTION noco.linklab_acknowledge(p_event_id bigint, p_crm_student_id uuid, p_receipt_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE event noco.linklab_changes; current_row noco.linklab;
BEGIN
  IF p_crm_student_id IS NULL OR p_receipt_id IS NULL THEN RAISE EXCEPTION 'linklab_receipt_required'; END IF;
  SELECT * INTO event FROM noco.linklab_changes WHERE id=p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'linklab_event_missing'; END IF;
  SELECT * INTO current_row FROM noco.linklab WHERE client_id=event.client_id FOR UPDATE;
  IF current_row.crm_integration_required THEN RETURN false; END IF;
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

CREATE OR REPLACE FUNCTION noco.linklab_record_failure(p_event_id bigint, p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE event noco.linklab_changes; current_row noco.linklab;
BEGIN
  IF p_code IS NULL OR p_code NOT IN ('crm_unavailable','crm_conflict','binding_missing',
    'binding_conflict','account_ambiguous','crm_apply_failed') THEN RAISE EXCEPTION 'linklab_error_code_invalid'; END IF;
  SELECT * INTO event FROM noco.linklab_changes WHERE id=p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'linklab_event_missing'; END IF;
  SELECT * INTO current_row FROM noco.linklab WHERE client_id=event.client_id FOR UPDATE;
  IF current_row.crm_integration_required THEN RETURN false; END IF;
  IF event.version <= current_row.confirmed_version THEN RETURN false; END IF;
  IF event.version <> current_row.confirmed_version+1 THEN RAISE EXCEPTION 'linklab_out_of_order'; END IF;
  UPDATE noco.linklab SET sync_error=p_code,sync_error_version=event.version WHERE client_id=event.client_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION noco.linklab_apply_crm_result(
  p_operation_id uuid, p_client_id bigint, p_student_id uuid, p_kind text, p_payload jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_row noco.linklab; saved noco.linklab_crm_results;
  revision bigint; filled integer; first_at timestamptz; outcome text := 'applied';
BEGIN
  IF p_operation_id IS NULL OR p_student_id IS NULL OR p_kind IS NULL OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'linklab_result_invalid'; END IF;
  SELECT * INTO current_row FROM noco.linklab WHERE client_id=p_client_id FOR UPDATE;
  IF current_row.crm_integration_required THEN RETURN 'stale'; END IF;
  IF NOT FOUND OR current_row.crm_student_id IS DISTINCT FROM p_student_id THEN
    RAISE EXCEPTION 'linklab_result_binding_conflict';
  END IF;
  SELECT * INTO saved FROM noco.linklab_crm_results WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF ROW(saved.client_id,saved.crm_student_id,saved.kind,saved.payload) IS DISTINCT FROM
      ROW(p_client_id,p_student_id,p_kind,p_payload) THEN
      RAISE EXCEPTION 'linklab_result_operation_conflict';
    END IF;
    RETURN 'duplicate';
  END IF;
  IF p_kind = 'profile_progress' THEN
    IF NOT (p_payload ?& ARRAY['revision','filled_count','total_count','percent','first_completed_at'])
      OR jsonb_typeof(p_payload->'revision') <> 'number'
      OR jsonb_typeof(p_payload->'filled_count') <> 'number'
      OR (p_payload->>'revision') !~ '^[0-9]+$'
      OR (p_payload->>'filled_count') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'linklab_profile_result_invalid';
    END IF;
    revision := (p_payload->>'revision')::bigint;
    filled := (p_payload->>'filled_count')::integer;
    first_at := (p_payload->>'first_completed_at')::timestamptz;
    IF filled NOT BETWEEN 0 AND 21 OR (p_payload->'total_count') IS DISTINCT FROM '21'::jsonb
      OR (p_payload->'percent') IS DISTINCT FROM to_jsonb(round(filled::numeric*100/21)::integer) THEN
      RAISE EXCEPTION 'linklab_profile_result_invalid';
    END IF;
    IF revision < current_row.profile_revision THEN
      outcome := 'stale';
    ELSE
      IF revision = current_row.profile_revision AND
        ROW(filled,first_at) IS DISTINCT FROM
        ROW(current_row.profile_filled_count,current_row.profile_first_completed_at) THEN
        RAISE EXCEPTION 'linklab_profile_revision_conflict';
      END IF;
      IF current_row.profile_first_completed_at IS NOT NULL AND
        first_at IS DISTINCT FROM current_row.profile_first_completed_at THEN
        RAISE EXCEPTION 'linklab_profile_first_date_conflict';
      END IF;
      UPDATE noco.linklab SET profile_revision=revision, profile_filled_count=filled,
        profile_first_completed_at=first_at WHERE client_id=p_client_id;
    END IF;
  ELSIF p_kind = 'proxy_completed' THEN
    IF (p_payload->>'cycle_id')::uuid IS DISTINCT FROM current_row.proxy_cycle_id
      OR current_row.proxy_cycle_id IS NULL
      OR (p_payload->>'completed_at')::timestamptz IS DISTINCT FROM current_row.proxy_ends_at THEN
      RAISE EXCEPTION 'linklab_proxy_result_conflict';
    END IF;
    IF clock_timestamp() < current_row.proxy_ends_at THEN
      RAISE EXCEPTION 'linklab_proxy_not_finished';
    END IF;
    UPDATE noco.linklab SET proxy_state='Не активна', proxy_completed_at=proxy_ends_at
      WHERE client_id=p_client_id;
  ELSE
    RAISE EXCEPTION 'linklab_result_kind_invalid';
  END IF;
  INSERT INTO noco.linklab_crm_results(operation_id,client_id,crm_student_id,kind,payload,outcome)
    VALUES(p_operation_id,p_client_id,p_student_id,p_kind,p_payload,outcome);
  RETURN outcome;
END $$;
CREATE FUNCTION noco.linkedin_confirm_cycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous noco.linklab; inserted bigint;
BEGIN
 IF NEW.status<>'выполнение подтверждено' OR OLD.status='выполнение подтверждено' THEN RETURN NEW; END IF;
 PERFORM 1 FROM noco.platform_accounts a JOIN noco.platforms p ON p.id=a.platforms_id
  WHERE a.id=NEW.linkedin_account_id AND a.clients_id=NEW.client_id AND lower(p.name)='linkedin'
   AND NOT coalesce(a.__nc_deleted,false) AND coalesce(btrim(a.url),'')<>'' AND coalesce(btrim(a.login),'')<>'' AND coalesce(a.password,'')<>'' FOR SHARE OF a;
 IF NOT FOUND THEN RAISE EXCEPTION 'linkedin_task_account_binding_invalid'; END IF;
 SELECT * INTO previous FROM noco.linklab WHERE client_id=NEW.client_id FOR UPDATE;
 IF previous.platform_account_id IS DISTINCT FROM NEW.linkedin_account_id AND previous.platform_account_id IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM noco.platform_accounts WHERE id=previous.platform_account_id AND clients_id=NEW.client_id AND coalesce(__nc_deleted,false))
 THEN RAISE EXCEPTION 'linklab_active_binding'; END IF;
 INSERT INTO noco.linkedin_account_cycles(task_id,client_id,account_id,old_account_id,previous_state)
 VALUES(NEW.id,NEW.client_id,NEW.linkedin_account_id,previous.platform_account_id,
  jsonb_build_object('status',previous.status,'profile_revision',previous.profile_revision,'filled_count',previous.profile_filled_count,
    'first_completed_at',previous.profile_first_completed_at,'blocked_at',previous.blocked_at,'new_account_url',previous.new_account_url))
 ON CONFLICT DO NOTHING RETURNING task_id INTO inserted;
 IF inserted IS NULL THEN RETURN NEW; END IF;
 IF previous.client_id IS NULL THEN
  INSERT INTO noco.linklab(client_id,platform_account_id,status,profile_filled_count,crm_integration_required)
   VALUES(NEW.client_id,NEW.linkedin_account_id,'Новый',0,true);
 ELSE
  UPDATE noco.linklab SET platform_account_id=NEW.linkedin_account_id,status='Новый',profile_revision=-1,profile_filled_count=0,
   profile_first_completed_at=NULL,blocked_at=NULL,new_account_url=NULL,crm_integration_required=true,
   credentials_issue=NULL WHERE client_id=NEW.client_id;
 END IF;
 UPDATE noco.linkedin_account_cycles SET applied_at=clock_timestamp() WHERE task_id=NEW.id;
 INSERT INTO noco.linkedin_cycle_notifications(task_id,client_id,account_id,url)
 SELECT NEW.id,NEW.client_id,NEW.linkedin_account_id,url FROM noco.platform_accounts WHERE id=NEW.linkedin_account_id;
 RETURN NEW;
END $$;
CREATE TRIGGER linkedin_confirm_cycle AFTER UPDATE OF status ON noco.linkedin_creation_task
 FOR EACH ROW EXECUTE FUNCTION noco.linkedin_confirm_cycle();
CREATE OR REPLACE VIEW noco.linklab_pending_changes WITH(security_invoker=true) AS
 SELECT e.* FROM noco.linklab_changes e JOIN noco.linklab l USING(client_id)
 WHERE NOT l.crm_integration_required AND e.version=l.confirmed_version+1;
REVOKE ALL ON TABLE noco.linkedin_account_cycles,noco.linkedin_cycle_notifications FROM PUBLIC;
REVOKE ALL ON FUNCTION noco.linkedin_confirm_cycle() FROM PUBLIC;
COMMIT;
