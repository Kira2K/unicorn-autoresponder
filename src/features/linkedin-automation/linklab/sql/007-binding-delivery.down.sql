-- Additive source migration. Stop Console writers first; no startup DDL or historical replay.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_database() NOT IN ('unicorn_noco_copy','unicorn_noco_copy_restore') OR
   (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())
   IS DISTINCT FROM 'unicorn-noco-copy:pqe5susktrsa9z3:20260911:v1' THEN RAISE EXCEPTION 'Copy database required'; END IF;
END $$;
LOCK TABLE noco.linklab,noco.platform_accounts,noco.linkedin_creation_task,noco.linkedin_account_cycles IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='noco.linklab_before_change()'::regprocedure) IS DISTINCT FROM 'f5507028beaaf67f4a18d28863144c37' THEN RAISE EXCEPTION 'crm_binding_rollback_function_drift:linklab_before_change'; END IF; END $$;
DO $$ BEGIN IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='noco.linkedin_confirm_cycle()'::regprocedure) IS DISTINCT FROM '7d322a63222a48eddeb39d6d8818a050' THEN RAISE EXCEPTION 'crm_binding_rollback_function_drift:linkedin_confirm_cycle'; END IF; END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM noco.crm_account_deliveries) OR EXISTS(SELECT 1 FROM noco.linkedin_replacement_intents) OR EXISTS(SELECT 1 FROM noco.crm_account_binding_repairs) THEN RAISE EXCEPTION 'crm_binding_rollback_requires_forward_recovery'; END IF;
END $$;
DROP TRIGGER crm_enqueue_account_cycle ON noco.linkedin_account_cycles;
DROP TRIGGER crm_guard_current_account ON noco.platform_accounts;
DROP TRIGGER crm_validate_account_replacement ON noco.linkedin_replacement_intents;
DROP FUNCTION noco.crm_enqueue_account_cycle(),noco.crm_guard_current_account(),noco.crm_begin_account_replacement(bigint,bigint),noco.crm_finish_account_replacement(bigint,bigint,bigint,bigint),noco.crm_validate_account_replacement(),noco.crm_claim_account_delivery(uuid),noco.crm_account_delivery_current(uuid,uuid),noco.crm_finish_account_delivery(uuid,uuid,text,text),noco.crm_acknowledge_account_cycle(uuid,uuid,text),noco.crm_account_binding_facts(bigint,bigint),noco.crm_repair_account_binding(uuid,bigint,uuid,bigint,bigint,bigint,bigint,jsonb),noco.crm_linkedin_public_url(text),noco.crm_assert_repair_account_idle(bigint,bigint);
DROP TABLE noco.crm_account_deliveries,noco.linkedin_replacement_intents,noco.crm_account_binding_repairs;
CREATE OR REPLACE FUNCTION noco.linklab_before_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
END $function$;
CREATE OR REPLACE FUNCTION noco.linkedin_confirm_cycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
END $function$;
COMMIT;
