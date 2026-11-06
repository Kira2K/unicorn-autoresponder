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
DO $$ BEGIN IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='noco.linklab_before_change()'::regprocedure) IS DISTINCT FROM '86e254a699ee9d3fe4f5583f2720ce0c' THEN RAISE EXCEPTION 'crm_binding_function_drift:linklab_before_change'; END IF; END $$;
DO $$ BEGIN IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='noco.linkedin_confirm_cycle()'::regprocedure) IS DISTINCT FROM 'bf6b9df3bd7523ddfe1ced6fbf643cdd' THEN RAISE EXCEPTION 'crm_binding_function_drift:linkedin_confirm_cycle'; END IF; END $$;
CREATE TABLE noco.crm_account_deliveries (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id bigint NOT NULL UNIQUE REFERENCES noco.linkedin_account_cycles(task_id),
 client_id bigint NOT NULL, account_id bigint NOT NULL, old_account_id bigint NOT NULL,
 student_id uuid NOT NULL, source_version bigint NOT NULL,
 body text NOT NULL, payload_sha256 text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','attempting','sent','review','superseded')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_id uuid, lease_until timestamptz, error_code text,
 acknowledged_at timestamptz, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(octet_length(body)<=8192), CHECK(payload_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX crm_account_deliveries_due ON noco.crm_account_deliveries(available_at) WHERE state IN ('pending','attempting');
CREATE TABLE noco.linkedin_replacement_intents (
 client_id bigint NOT NULL, old_account_id bigint NOT NULL,
 transaction_id bigint NOT NULL, task_id bigint, new_account_id bigint,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(client_id,old_account_id,transaction_id)
);
CREATE TABLE noco.crm_account_binding_repairs (
 operation_id uuid PRIMARY KEY, client_id bigint NOT NULL, student_id uuid NOT NULL,
 source_old_account_id bigint, crm_old_account_id bigint NOT NULL, new_account_id bigint NOT NULL,
 expected_version bigint NOT NULL, proof jsonb NOT NULL, transaction_id bigint NOT NULL,
 applied_version bigint, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Same public URL normalization as the sender, including UTF8/percent-encoded slugs.
CREATE FUNCTION noco.crm_linkedin_public_url(value text) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE matched text[]; slug text; bytes bytea:=''::bytea; pos integer:=1; part text; result text:=''; code integer;
BEGIN
 matched:=regexp_match(regexp_replace(btrim(value),'[?#].*$',''),'^(?:https?://)?(?:www[.])?linkedin[.]com/in/([^/?#[:space:]]+)/?$','i');
 IF matched IS NULL THEN RAISE EXCEPTION 'crm_cycle_profile_url_invalid'; END IF;
 slug:=matched[1];
 BEGIN
  WHILE pos<=length(slug) LOOP
   part:=substr(slug,pos,1);
   IF part='%' THEN
    IF substr(slug,pos+1,2) !~ '^[0-9a-fA-F]{2}$' THEN RAISE EXCEPTION 'invalid_percent'; END IF;
    bytes:=bytes||decode(substr(slug,pos+1,2),'hex');pos:=pos+3;
   ELSE bytes:=bytes||convert_to(part,'UTF8');pos:=pos+1;
   END IF;
  END LOOP;
  PERFORM convert_from(bytes,'UTF8');
 EXCEPTION WHEN OTHERS THEN bytes:=convert_to(slug,'UTF8');
 END;
 FOR pos IN 0..length(bytes)-1 LOOP
  code:=get_byte(bytes,pos);
  IF code BETWEEN 48 AND 57 OR code BETWEEN 65 AND 90 OR code BETWEEN 97 AND 122 OR code IN (45,95) THEN result:=result||chr(code);
  ELSE result:=result||'%'||upper(lpad(to_hex(code),2,'0'));
  END IF;
 END LOOP;
 RETURN 'https://www.linkedin.com/in/'||result;
END $$;

-- This trigger runs inside expert completion, before its transaction can commit.
CREATE FUNCTION noco.crm_enqueue_account_cycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_row noco.linklab; event uuid; payload text; public_url text;
BEGIN
 IF NEW.applied_at IS NULL OR OLD.applied_at IS NOT NULL OR NEW.old_account_id IS NULL OR NEW.old_account_id=NEW.account_id THEN RETURN NEW; END IF;
 SELECT * INTO STRICT current_row FROM noco.linklab WHERE client_id=NEW.client_id FOR UPDATE;
 IF current_row.crm_student_id IS NULL THEN RETURN NEW; END IF; -- Existing first-intake owner remains authoritative.
 IF current_row.platform_account_id<>NEW.account_id OR current_row.status<>'Прогрев' OR NOT current_row.crm_integration_required THEN RAISE EXCEPTION 'crm_cycle_enqueue_conflict'; END IF;
 SELECT a.url INTO STRICT public_url FROM noco.platform_accounts a WHERE a.id=NEW.account_id AND a.clients_id=NEW.client_id AND NOT coalesce(a.__nc_deleted,false);
 -- Canonical public URL, never credentials. Complex/invalid URLs require review, not a guessed identity.
 public_url:=noco.crm_linkedin_public_url(public_url);
 IF public_url IS NULL THEN RAISE EXCEPTION 'crm_cycle_profile_url_invalid'; END IF;
 event:=gen_random_uuid();
 payload:=json_build_object('schema_version',1,'event_type','linkedin.account_command','source','unicorn',
  'command','replacement','event_id',event::text,'client_id',NEW.client_id::text,'account_id',NEW.account_id::text,
  'linklab_version',current_row.version::text,'confirmed_at',to_char(NEW.applied_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'cycle_id',NEW.task_id::text,'old_account_id',NEW.old_account_id::text,'account_url',public_url)::text;
 INSERT INTO noco.crm_account_deliveries(event_id,task_id,client_id,account_id,old_account_id,student_id,source_version,body,payload_sha256)
 VALUES(event,NEW.task_id,NEW.client_id,NEW.account_id,NEW.old_account_id,current_row.crm_student_id,current_row.version,payload,
   encode(sha256(convert_to(payload,'UTF8')),'hex'));
 RETURN NEW;
END $$;
CREATE TRIGGER crm_enqueue_account_cycle AFTER UPDATE OF applied_at ON noco.linkedin_account_cycles FOR EACH ROW EXECUTE FUNCTION noco.crm_enqueue_account_cycle();

-- No arbitrary delete/soft-delete of the currently linked account. Explicit replacement
-- is allowed only with a same-transaction intent sealed to the new expert task at COMMIT.
CREATE FUNCTION noco.crm_guard_current_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.clients_id,NEW.platforms_id) IS DISTINCT FROM ROW(OLD.id,OLD.clients_id,OLD.platforms_id)
  AND EXISTS(SELECT 1 FROM noco.linklab WHERE platform_account_id=OLD.id) THEN RAISE EXCEPTION 'crm_current_account_identity_immutable'; END IF;
 IF (TG_OP='DELETE' OR (NOT coalesce(OLD.__nc_deleted,false) AND coalesce(NEW.__nc_deleted,false)))
   AND EXISTS(SELECT 1 FROM noco.linklab WHERE platform_account_id=OLD.id) THEN
  IF TG_OP='DELETE' OR NOT EXISTS(SELECT 1 FROM noco.linkedin_replacement_intents i WHERE i.client_id=OLD.clients_id AND i.old_account_id=OLD.id AND i.transaction_id=txid_current()) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='crm_current_account_requires_explicit_replacement';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_guard_current_account BEFORE DELETE OR UPDATE ON noco.platform_accounts FOR EACH ROW EXECUTE FUNCTION noco.crm_guard_current_account();
CREATE FUNCTION noco.crm_begin_account_replacement(p_client bigint,p_old bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM noco.platform_accounts a JOIN noco.platforms p ON p.id=a.platforms_id WHERE a.id=p_old AND a.clients_id=p_client AND lower(p.name)='linkedin' AND a.is_banned AND NOT coalesce(a.__nc_deleted,false)) THEN RAISE EXCEPTION 'crm_replacement_stale'; END IF;
 INSERT INTO noco.linkedin_replacement_intents(client_id,old_account_id,transaction_id) VALUES(p_client,p_old,txid_current()) ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION noco.crm_finish_account_replacement(p_client bigint,p_old bigint,p_task bigint,p_new bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM noco.linkedin_creation_task t WHERE t.id=p_task AND t.client_id=p_client AND t.linkedin_account_id=p_new AND p_new<>p_old AND t.status<>'сделана экспертом') THEN RAISE EXCEPTION 'crm_replacement_task_required'; END IF;
 UPDATE noco.linkedin_replacement_intents SET task_id=p_task,new_account_id=p_new WHERE client_id=p_client AND old_account_id=p_old AND transaction_id=txid_current();
 IF NOT FOUND THEN RAISE EXCEPTION 'crm_replacement_intent_required'; END IF;
END $$;
CREATE FUNCTION noco.crm_validate_account_replacement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM noco.linkedin_replacement_intents i JOIN noco.linkedin_creation_task t ON t.id=i.task_id
  JOIN noco.platform_accounts a ON a.id=i.new_account_id AND a.clients_id=i.client_id
  WHERE i.client_id=NEW.client_id AND i.old_account_id=NEW.old_account_id AND i.transaction_id=NEW.transaction_id
   AND t.client_id=i.client_id AND t.linkedin_account_id=i.new_account_id AND NOT coalesce(a.__nc_deleted,false)) THEN RAISE EXCEPTION 'crm_replacement_task_required'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER crm_validate_account_replacement AFTER INSERT ON noco.linkedin_replacement_intents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION noco.crm_validate_account_replacement();

CREATE FUNCTION noco.crm_claim_account_delivery(p_lease uuid) RETURNS SETOF noco.crm_account_deliveries LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_lease IS NULL THEN RAISE EXCEPTION 'crm_delivery_lease_required'; END IF;
 UPDATE noco.crm_account_deliveries SET state='review',error_code='crm_account_command_attempts_exhausted',lease_id=NULL,lease_until=NULL
  WHERE state='attempting' AND lease_until<clock_timestamp() AND attempts>=20;
 RETURN QUERY WITH candidate AS (SELECT event_id FROM noco.crm_account_deliveries WHERE
  (state='pending' AND available_at<=clock_timestamp()) OR (state='attempting' AND lease_until<clock_timestamp())
  ORDER BY available_at,event_id LIMIT 1 FOR UPDATE SKIP LOCKED)
 UPDATE noco.crm_account_deliveries d SET state='attempting',lease_id=p_lease,lease_until=clock_timestamp()+interval '90 seconds',attempts=attempts+1
 FROM candidate c WHERE d.event_id=c.event_id RETURNING d.*;
END $$;
CREATE FUNCTION noco.crm_account_delivery_current(p_event uuid,p_lease uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM noco.crm_account_deliveries d JOIN noco.linklab l ON l.client_id=d.client_id
  JOIN noco.platform_accounts a ON a.id=d.account_id AND a.clients_id=d.client_id
  WHERE d.event_id=p_event AND d.lease_id=p_lease AND d.state='attempting' AND d.lease_until>clock_timestamp()
   AND l.platform_account_id=d.account_id AND l.version=d.source_version AND l.crm_student_id=d.student_id
   AND NOT a.is_banned AND NOT coalesce(a.__nc_deleted,false));
$$;
CREATE FUNCTION noco.crm_finish_account_delivery(p_event uuid,p_lease uuid,p_result text,p_error text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_result NOT IN ('sent','retry','review','superseded') OR (p_error IS NOT NULL AND p_error !~ '^crm_[a-z0-9_]{1,90}$') THEN RAISE EXCEPTION 'crm_delivery_result_invalid'; END IF;
 UPDATE noco.crm_account_deliveries SET state=CASE WHEN p_result='retry' AND attempts<20 THEN 'pending' WHEN p_result='retry' THEN 'review' ELSE p_result END,
  available_at=clock_timestamp()+make_interval(secs=>least(3600,15*power(2,least(attempts,8)))),
  sent_at=CASE WHEN p_result='sent' THEN clock_timestamp() ELSE sent_at END,error_code=p_error,lease_id=NULL,lease_until=NULL
 WHERE event_id=p_event AND lease_id=p_lease AND state='attempting' AND lease_until>clock_timestamp()
  AND (p_result<>'sent' OR acknowledged_at IS NOT NULL);
 RETURN FOUND;
END $$;

-- Only the CRM DB role may EXECUTE this. Its own receipt and this ACK commit together.
CREATE FUNCTION noco.crm_acknowledge_account_cycle(p_event uuid,p_student uuid,p_sha text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d noco.crm_account_deliveries; l noco.linklab; current_url text;
BEGIN
 SELECT * INTO STRICT d FROM noco.crm_account_deliveries WHERE event_id=p_event;
 SELECT * INTO STRICT l FROM noco.linklab WHERE client_id=d.client_id FOR UPDATE NOWAIT;
 SELECT a.url INTO STRICT current_url FROM noco.platform_accounts a JOIN noco.clients c ON c.id=a.clients_id JOIN noco.platforms p ON p.id=a.platforms_id
  WHERE a.id=d.account_id AND a.clients_id=d.client_id AND NOT a.is_banned AND NOT coalesce(a.__nc_deleted,false)
   AND NOT coalesce(c.__nc_deleted,false) AND NOT coalesce(p.__nc_deleted,false) AND lower(p.name)='linkedin' FOR SHARE OF a,c,p NOWAIT;
 current_url:=noco.crm_linkedin_public_url(current_url);
 IF d.student_id IS DISTINCT FROM p_student OR d.payload_sha256 IS DISTINCT FROM p_sha OR
   current_url IS DISTINCT FROM d.body::jsonb->>'account_url' OR
   ROW(l.platform_account_id,l.version,l.crm_student_id,l.status) IS DISTINCT FROM ROW(d.account_id,d.source_version,p_student,'Прогрев'::text) OR
   NOT EXISTS(SELECT 1 FROM noco.platform_accounts a WHERE a.id=d.account_id AND a.clients_id=d.client_id AND NOT a.is_banned AND NOT coalesce(a.__nc_deleted,false)) OR
   EXISTS(SELECT 1 FROM noco.linkedin_account_cycles c WHERE c.client_id=d.client_id AND c.task_id<>d.task_id AND (c.applied_at IS NULL OR c.applied_at>d.created_at)) THEN RAISE EXCEPTION 'crm_cycle_ack_conflict'; END IF;
 UPDATE noco.linklab SET crm_integration_required=false,confirmed_version=version,confirmed_at=clock_timestamp(),sync_error=NULL,sync_error_version=NULL WHERE client_id=d.client_id;
 UPDATE noco.linklab_changes SET crm_receipt_id=p_event,confirmed_at=clock_timestamp() WHERE client_id=d.client_id AND version=d.source_version AND (crm_receipt_id IS NULL OR crm_receipt_id=p_event);
 IF NOT FOUND THEN RAISE EXCEPTION 'crm_cycle_ack_event_conflict'; END IF;
 UPDATE noco.platform_accounts SET "isUnsyncedWithCRM"=false WHERE id=d.account_id AND clients_id=d.client_id;
 UPDATE noco.crm_account_deliveries SET acknowledged_at=coalesce(acknowledged_at,clock_timestamp()) WHERE event_id=p_event;
 RETURN true;
END $$;

-- Explicit same-physical-account repair; caller is the CRM manager service, NOT the sender.
CREATE FUNCTION noco.crm_assert_repair_account_idle(p_client bigint,p_account bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT pg_try_advisory_xact_lock(730644,p_client::integer) THEN RAISE EXCEPTION 'crm_repair_busy'; END IF;
 -- FOR UPDATE also fences new task FKs (KEY SHARE), including direct SQL writers.
 -- Together with the client gate this prevents a task from appearing between
 -- the idle check and the binding update. All waits fail fast.
 PERFORM 1 FROM noco.platform_accounts WHERE id=p_account AND clients_id=p_client FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'crm_repair_target_invalid'; END IF;
 PERFORM 1 FROM noco.linkedin_creation_task WHERE client_id=p_client
  AND linkedin_account_id=p_account AND status<>'сделана экспертом' FOR SHARE NOWAIT;
 IF FOUND THEN RAISE EXCEPTION 'crm_repair_expert_task_pending'; END IF;
END $$;
CREATE FUNCTION noco.crm_account_binding_facts(p_client bigint,p_account bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE account_row record; profiles jsonb; l noco.linklab;
BEGIN
 PERFORM noco.crm_assert_repair_account_idle(p_client,p_account);
 SELECT * INTO STRICT l FROM noco.linklab WHERE client_id=p_client FOR UPDATE NOWAIT;
 SELECT a.url,a.xmin::text AS revision INTO STRICT account_row FROM noco.platform_accounts a JOIN noco.platforms p ON p.id=a.platforms_id JOIN noco.clients c ON c.id=a.clients_id
  WHERE a.id=p_account AND a.clients_id=p_client AND lower(p.name)='linkedin' AND NOT coalesce(a.__nc_deleted,false)
   AND NOT coalesce(p.__nc_deleted,false) AND NOT coalesce(c.__nc_deleted,false) AND NOT a.is_banned FOR SHARE OF a,p,c NOWAIT;
 SELECT coalesce(jsonb_agg(row_to_json(v)),'[]'::jsonb) INTO profiles FROM
  (SELECT id AS record_id,locale,browser,dolphin_profile_id AS dolphin,octo_profile_id AS octo FROM noco.dolphin_profiles
   WHERE "02_clients_id"=p_client AND lower(btrim(locale))='en' AND NOT coalesce(__nc_deleted,false) FOR SHARE NOWAIT) v;
 RETURN jsonb_build_object('url',account_row.url,'revision',account_row.revision,'profiles',profiles,
  'old_account_live',EXISTS(SELECT 1 FROM noco.platform_accounts WHERE id=l.platform_account_id AND NOT coalesce(__nc_deleted,false)),
  'source',jsonb_build_array(l.platform_account_id,l.version,l.crm_student_id,l.status,l.confirmed_version,l.crm_integration_required));
END $$;
CREATE FUNCTION noco.crm_repair_account_binding(p_operation uuid,p_client bigint,p_student uuid,p_source_old bigint,p_crm_old bigint,p_new bigint,p_version bigint,p_proof jsonb) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l noco.linklab; saved noco.crm_account_binding_repairs; v bigint;
BEGIN
 IF p_operation IS NULL OR p_student IS NULL OR p_client IS NULL OR p_crm_old IS NULL OR p_new IS NULL OR p_version IS NULL OR jsonb_typeof(p_proof) IS DISTINCT FROM 'object'
  OR p_proof->>'kind' IS DISTINCT FROM 'same_physical_account' OR coalesce(length(p_proof->>'old_provider_id'),0)<3
  OR p_proof->>'old_provider_id' IS DISTINCT FROM p_proof->>'new_provider_id' OR coalesce(length(p_proof->>'evidence_ref'),0)<5
  OR p_proof->>'confirmed_by' IS NULL THEN RAISE EXCEPTION 'crm_repair_input_invalid'; END IF;
 IF NOT pg_try_advisory_xact_lock(730644,p_client::integer) THEN RAISE EXCEPTION 'crm_repair_busy'; END IF;
 SELECT * INTO STRICT l FROM noco.linklab WHERE client_id=p_client FOR UPDATE NOWAIT;
 SELECT * INTO saved FROM noco.crm_account_binding_repairs WHERE operation_id=p_operation;
 IF FOUND THEN
  IF ROW(saved.client_id,saved.student_id,saved.source_old_account_id,saved.crm_old_account_id,saved.new_account_id,saved.expected_version,saved.proof) IS DISTINCT FROM ROW(p_client,p_student,p_source_old,p_crm_old,p_new,p_version,p_proof) THEN RAISE EXCEPTION 'crm_repair_operation_conflict'; END IF;
  RETURN saved.applied_version;
 END IF;
 PERFORM noco.crm_assert_repair_account_idle(p_client,p_new);
 IF ROW(l.platform_account_id,l.version,l.crm_student_id) IS DISTINCT FROM ROW(p_source_old,p_version,p_student) OR p_new=p_crm_old OR l.proxy_state='Активна' OR l.status IN ('Блок','Завершен')
  OR EXISTS(SELECT 1 FROM noco.platform_accounts WHERE id=p_crm_old AND NOT coalesce(__nc_deleted,false)) THEN RAISE EXCEPTION 'crm_repair_binding_conflict'; END IF;
 PERFORM 1 FROM noco.platform_accounts a JOIN noco.platforms p ON p.id=a.platforms_id JOIN noco.clients c ON c.id=a.clients_id
  WHERE a.id=p_new AND a.clients_id=p_client AND lower(p.name)='linkedin' AND NOT coalesce(p.__nc_deleted,false) AND NOT coalesce(c.__nc_deleted,false) AND NOT coalesce(a.__nc_deleted,false) AND NOT a.is_banned
   AND coalesce(btrim(a.url),'')<>'' FOR SHARE OF a,p,c NOWAIT;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM noco.linklab WHERE platform_account_id=p_new AND client_id<>p_client) OR
  EXISTS(SELECT 1 FROM noco.linkedin_account_cycles WHERE client_id=p_client AND (account_id=p_new OR applied_at IS NULL)) OR
  EXISTS(SELECT 1 FROM noco.crm_account_deliveries WHERE client_id=p_client AND state IN ('pending','attempting','review')) THEN RAISE EXCEPTION 'crm_repair_current_account_required'; END IF;
 INSERT INTO noco.crm_account_binding_repairs(operation_id,client_id,student_id,source_old_account_id,crm_old_account_id,new_account_id,expected_version,proof,transaction_id)
 VALUES(p_operation,p_client,p_student,p_source_old,p_crm_old,p_new,p_version,p_proof,txid_current());
 UPDATE noco.linklab SET platform_account_id=p_new,crm_integration_required=false WHERE client_id=p_client RETURNING version INTO v;
 UPDATE noco.linklab_changes SET source='crm',source_operation_id=p_operation,crm_receipt_id=p_operation,confirmed_at=clock_timestamp() WHERE client_id=p_client AND version=v AND crm_receipt_id IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'crm_repair_event_conflict'; END IF;
 UPDATE noco.linklab SET confirmed_version=v,confirmed_at=clock_timestamp(),sync_error=NULL,sync_error_version=NULL WHERE client_id=p_client;
 UPDATE noco.platform_accounts SET "isUnsyncedWithCRM"=false WHERE id=p_new AND clients_id=p_client;
 UPDATE noco.crm_account_binding_repairs SET applied_version=v WHERE operation_id=p_operation;
 RETURN v;
END $$;

REVOKE ALL ON noco.crm_account_deliveries,noco.linkedin_replacement_intents,noco.crm_account_binding_repairs FROM PUBLIC,unicorn_sql_app;
REVOKE ALL ON FUNCTION noco.crm_assert_repair_account_idle(bigint,bigint) FROM PUBLIC,unicorn_sql_app;
REVOKE ALL ON FUNCTION noco.crm_linkedin_public_url(text) FROM PUBLIC,unicorn_sql_app;
REVOKE ALL ON FUNCTION noco.crm_enqueue_account_cycle(),noco.crm_guard_current_account(),noco.crm_begin_account_replacement(bigint,bigint),noco.crm_finish_account_replacement(bigint,bigint,bigint,bigint),noco.crm_validate_account_replacement(),noco.crm_claim_account_delivery(uuid),noco.crm_account_delivery_current(uuid,uuid),noco.crm_finish_account_delivery(uuid,uuid,text,text),noco.crm_acknowledge_account_cycle(uuid,uuid,text),noco.crm_account_binding_facts(bigint,bigint),noco.crm_repair_account_binding(uuid,bigint,uuid,bigint,bigint,bigint,bigint,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION noco.crm_acknowledge_account_cycle(uuid,uuid,text),noco.crm_account_binding_facts(bigint,bigint),noco.crm_repair_account_binding(uuid,bigint,uuid,bigint,bigint,bigint,bigint,jsonb) FROM unicorn_sql_app;
GRANT SELECT(event_id,task_id,state,attempts,error_code) ON noco.crm_account_deliveries TO unicorn_sql_app;
GRANT EXECUTE ON FUNCTION noco.crm_begin_account_replacement(bigint,bigint),noco.crm_finish_account_replacement(bigint,bigint,bigint,bigint),noco.crm_claim_account_delivery(uuid),noco.crm_account_delivery_current(uuid,uuid),noco.crm_finish_account_delivery(uuid,uuid,text,text) TO unicorn_sql_app;

CREATE OR REPLACE FUNCTION noco.linklab_before_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE new_cycle boolean; technical_repair boolean;
BEGIN
  new_cycle := EXISTS(SELECT 1 FROM noco.linkedin_account_cycles c WHERE c.client_id=NEW.client_id AND c.account_id=NEW.platform_account_id AND c.applied_at IS NULL);
  technical_repair := TG_OP='UPDATE' AND EXISTS(
    SELECT 1 FROM noco.crm_account_binding_repairs r
    WHERE r.client_id=NEW.client_id AND r.source_old_account_id IS NOT DISTINCT FROM OLD.platform_account_id
      AND r.new_account_id=NEW.platform_account_id AND r.expected_version=OLD.version
      AND r.transaction_id=txid_current() AND r.applied_version IS NULL);
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
      IF NOT new_cycle AND NOT technical_repair AND (NEW.platform_account_id IS NOT NULL OR EXISTS(
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
 IF previous.crm_student_id IS NOT NULL AND previous.platform_account_id IS NULL THEN RAISE EXCEPTION 'crm_previous_binding_confirmation_required'; END IF;
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
  UPDATE noco.linklab SET platform_account_id=NEW.linkedin_account_id,status=CASE WHEN previous.crm_student_id IS NOT NULL AND previous.platform_account_id IS NOT NULL AND previous.platform_account_id<>NEW.linkedin_account_id THEN 'Прогрев' ELSE 'Новый' END,profile_revision=-1,profile_filled_count=0,
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
