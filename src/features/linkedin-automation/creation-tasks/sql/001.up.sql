CREATE TABLE IF NOT EXISTS noco.linkedin_creation_task (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id bigint NOT NULL REFERENCES noco.clients(id),
  linkedin_account_id bigint NOT NULL REFERENCES noco.platform_accounts(id),
  outlook_account_id bigint NOT NULL REFERENCES noco.platform_accounts(id),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','student_intake')),
  status text NOT NULL DEFAULT 'не начата' CHECK (status IN ('не начата','блок','сделана экспертом','выполнение подтверждено')),
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  proxy_profile_id bigint REFERENCES noco.octo_profiles(profile_id) ON DELETE SET NULL,
  proxy_uuid text,
  proxy_saved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS linkedin_creation_student_form_unique
  ON noco.linkedin_creation_task(client_id) WHERE source='student_intake';
CREATE INDEX IF NOT EXISTS linkedin_creation_open_tasks ON noco.linkedin_creation_task(status,id);

CREATE OR REPLACE FUNCTION noco.linkedin_creation_task_check() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
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
  IF NEW.status IN ('сделана экспертом','выполнение подтверждено') AND
    (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
    IF NOT EXISTS (SELECT 1 FROM noco.platform_accounts WHERE id=NEW.linkedin_account_id
      AND coalesce(btrim(url),'')<>'' AND coalesce(btrim(login),'')<>'' AND coalesce(password,'')<>'')
      OR NEW.proxy_saved_at IS NULL OR NEW.proxy_uuid IS NULL OR NOT EXISTS
      (SELECT 1 FROM noco.octo_profiles p WHERE p.profile_id=NEW.proxy_profile_id AND p.client_id=NEW.client_id
        AND p.locale='en' AND p.state->'proxy'->>'uuid'=NEW.proxy_uuid AND p.state->>'phase'='ready'
        AND p.state->'deletion' IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='linkedin_task_result_or_proxy_required';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS linkedin_creation_task_check ON noco.linkedin_creation_task;
CREATE TRIGGER linkedin_creation_task_check BEFORE INSERT OR UPDATE ON noco.linkedin_creation_task
FOR EACH ROW EXECUTE FUNCTION noco.linkedin_creation_task_check();
