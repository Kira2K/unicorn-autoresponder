-- Coordinated Console release: stop all old Console writers/dispatchers before installation.
-- Historical completion records, dates, LinkLab cycles and delivery receipts are preserved.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_database() NOT IN ('unicorn_noco_copy','unicorn_noco_copy_restore') OR
  (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())
    IS DISTINCT FROM 'unicorn-noco-copy:pqe5susktrsa9z3:20260911:v1' THEN RAISE EXCEPTION 'Copy database required'; END IF;
END $$;
LOCK TABLE noco.linkedin_creation_task,noco.linkedin_cycle_notifications IN ACCESS EXCLUSIVE MODE;
DO $$ DECLARE pending_ids text; BEGIN
 SELECT string_agg(t.id::text,',' ORDER BY t.id) INTO pending_ids FROM noco.linkedin_creation_task t
 WHERE t.status='сделана экспертом' AND NOT EXISTS(SELECT 1 FROM noco.linkedin_account_cycles c WHERE c.task_id=t.id AND c.applied_at IS NOT NULL);
 IF pending_ids IS NOT NULL THEN RAISE EXCEPTION 'linkedin_pending_expert_tasks: %',pending_ids; END IF;
END $$;
-- Only this controlled rename bypasses task business triggers. Do not replay completion.
ALTER TABLE noco.linkedin_creation_task DISABLE TRIGGER linkedin_creation_task_check;
ALTER TABLE noco.linkedin_creation_task DISABLE TRIGGER linkedin_new_proxy_check;
ALTER TABLE noco.linkedin_creation_task DISABLE TRIGGER linkedin_confirm_cycle;
UPDATE noco.linkedin_creation_task SET status='сделана экспертом' WHERE status='выполнение подтверждено';
ALTER TABLE noco.linkedin_creation_task ENABLE TRIGGER linkedin_creation_task_check;
ALTER TABLE noco.linkedin_creation_task ENABLE TRIGGER linkedin_new_proxy_check;
ALTER TABLE noco.linkedin_creation_task ENABLE TRIGGER linkedin_confirm_cycle;
ALTER TABLE noco.linkedin_creation_task DROP CONSTRAINT linkedin_creation_task_status_check;
ALTER TABLE noco.linkedin_creation_task ADD CONSTRAINT linkedin_creation_task_status_check CHECK(status IN ('не начата','блок','сделана экспертом'));
-- Existing rows remain reports, with their exact delivery states and IDs. No student backfill.
ALTER TABLE noco.linkedin_cycle_notifications ADD COLUMN IF NOT EXISTS recipient text NOT NULL DEFAULT 'reports' CHECK(recipient IN ('reports','student'));
ALTER TABLE noco.linkedin_cycle_notifications ADD COLUMN IF NOT EXISTS chat_id text;
UPDATE noco.linkedin_cycle_notifications SET chat_id='-1003187558078' WHERE recipient='reports' AND chat_id IS NULL;
ALTER TABLE noco.linkedin_cycle_notifications DROP CONSTRAINT linkedin_cycle_notifications_pkey;
ALTER TABLE noco.linkedin_cycle_notifications ADD PRIMARY KEY(task_id,recipient);

CREATE OR REPLACE FUNCTION noco.linkedin_creation_task_check() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.status='сделана экспертом' THEN
    IF NEW.status IS DISTINCT FROM OLD.status OR
      ROW(NEW.client_id,NEW.linkedin_account_id,NEW.outlook_account_id) IS DISTINCT FROM ROW(OLD.client_id,OLD.linkedin_account_id,OLD.outlook_account_id) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='linkedin_task_completed';
    END IF;
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL; END IF;
  END IF;
  IF TG_OP='INSERT' AND NEW.status='сделана экспертом' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='linkedin_task_invalid_status';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM noco.platform_accounts a JOIN noco.platforms p ON p.id=a.platforms_id
    WHERE a.id=NEW.linkedin_account_id AND a.clients_id=NEW.client_id AND lower(p.name)='linkedin'
      AND NOT coalesce(a.__nc_deleted,false)) OR NOT EXISTS
    (SELECT 1 FROM noco.platform_accounts a JOIN noco.platforms p ON p.id=a.platforms_id
    WHERE a.id=NEW.outlook_account_id AND a.clients_id=NEW.client_id AND lower(p.name)='email_outlook'
      AND NOT coalesce(a.__nc_deleted,false)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='linkedin_task_account_binding_invalid';
  END IF;
  IF TG_OP='UPDATE' THEN
    NEW.version:=OLD.version+1; NEW.updated_at:=clock_timestamp(); NEW.created_at:=OLD.created_at;
  END IF;
  IF NEW.status = 'сделана экспертом' AND
    (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
    IF NOT EXISTS (SELECT 1 FROM noco.platform_accounts WHERE id=NEW.linkedin_account_id
      AND coalesce(btrim(url),'')<>'' AND coalesce(btrim(login),'')<>'' AND coalesce(password,'')<>'')
      OR NEW.proxy_saved_at IS NULL OR NEW.proxy_uuid IS NULL OR NOT EXISTS
      (SELECT 1 FROM noco.octo_profiles p WHERE p.profile_id=NEW.proxy_profile_id AND p.client_id=NEW.client_id
        AND p.locale='en' AND p.state->'proxy'->>'uuid'=NEW.proxy_uuid AND p.state->>'phase'='ready'
        AND p.state->'deletion' IS NULL AND p.state->'pending' IS NULL
        AND (p.state->'grant' IS NULL OR p.state->'grant'->>'phase'='complete')
        AND (p.state->'proxyChange' IS NULL OR p.state->'proxyChange'->>'phase'='complete') FOR SHARE OF p) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='linkedin_task_result_or_proxy_required';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION noco.linkedin_new_proxy_check() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.requires_new_proxy AND ((NEW.status = 'сделана экспертом' AND (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status))
   OR NEW.proxy_saved_at IS DISTINCT FROM OLD.proxy_saved_at AND NEW.proxy_saved_at IS NOT NULL) THEN
  IF NOT EXISTS(SELECT 1 FROM noco.linkedin_creation_proxy v JOIN noco.octo_profiles p ON p.profile_id=v.profile_id
   WHERE v.task_id=NEW.id AND p.client_id=NEW.client_id AND p.locale='en'
    AND v.fingerprint IS NOT NULL AND v.exit_ip IS NOT NULL AND v.comparison IN ('different','skipped')
    AND v.fingerprint IS DISTINCT FROM v.baseline_fingerprint
    AND ((v.comparison='different' AND v.baseline_ip IS NOT NULL AND v.exit_ip<>v.baseline_ip)
      OR (v.comparison='skipped' AND v.baseline_ip IS NULL))
    AND p.state->'proxyChange'->>'id'=v.operation_id::text AND p.state->'proxyChange'->>'phase'='complete'
    AND p.state->'pending' IS NULL AND (p.state->'grant' IS NULL OR p.state->'grant'->>'phase'='complete')
    AND p.state->'proxy'->>'uuid'=NEW.proxy_uuid AND p.profile_id=NEW.proxy_profile_id
    AND NEW.proxy_uuid IS DISTINCT FROM v.baseline_uuid) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='linkedin_task_new_proxy_required';
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- CRM СЕЙЧАС НЕ ПОДКЛЮЧАЕМ. БУДУЩАЯ ИНТЕГРАЦИЯ ДОЛЖНА ПРИВЯЗЫВАТЬ РЕЗУЛЬТАТЫ К КОНКРЕТНОМУ LINKEDIN-АККАУНТУ И ЦИКЛУ.
CREATE OR REPLACE FUNCTION noco.linkedin_confirm_cycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous noco.linklab; inserted bigint; student_chat text;
BEGIN
 IF NEW.status<>'сделана экспертом' OR OLD.status='сделана экспертом' THEN RETURN NEW; END IF;
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
 SELECT coalesce(nullif(btrim(to_jsonb(c)->>'secured_general_chat_id'),''),nullif(btrim(c.telegram_general_chat_id),''))
 INTO student_chat FROM noco.clients c WHERE c.id=NEW.client_id;
 INSERT INTO noco.linkedin_cycle_notifications(task_id,client_id,account_id,url,recipient,chat_id,state,error_code)
 SELECT NEW.id,NEW.client_id,NEW.linkedin_account_id,a.url,v.recipient,v.chat_id,
  CASE WHEN v.chat_id IS NULL THEN 'failed' ELSE 'pending' END,
  CASE WHEN v.chat_id IS NULL THEN 'recipient_missing' ELSE NULL END
 FROM noco.platform_accounts a CROSS JOIN (VALUES('reports','-1003187558078'),('student',student_chat)) v(recipient,chat_id)
 WHERE a.id=NEW.linkedin_account_id;
 RETURN NEW;
END $$;
COMMIT;
