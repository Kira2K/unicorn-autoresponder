-- Explicit schema-owner migration; no account credentials or confirmed applications are rewritten.
BEGIN;
ALTER TABLE noco.linkedin_creation_task ADD COLUMN requires_new_proxy boolean NOT NULL DEFAULT true;
CREATE TABLE noco.linkedin_creation_proxy (
 task_id bigint PRIMARY KEY REFERENCES noco.linkedin_creation_task(id),
 baseline_uuid text, baseline_fingerprint text, baseline_ip inet, baseline_connection jsonb,
 fingerprint text, exit_ip inet, comparison text CHECK(comparison IN ('different','skipped')),
 operation_id uuid, profile_id bigint REFERENCES noco.octo_profiles(profile_id) ON DELETE SET NULL
);
CREATE FUNCTION noco.linkedin_proxy_baseline() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO noco.linkedin_creation_proxy(task_id,baseline_uuid)
 VALUES(NEW.id,(SELECT state->'proxy'->>'uuid' FROM noco.octo_profiles WHERE client_id=NEW.client_id AND locale='en'));
 RETURN NEW;
END $$;
CREATE TRIGGER linkedin_proxy_baseline AFTER INSERT ON noco.linkedin_creation_task
 FOR EACH ROW EXECUTE FUNCTION noco.linkedin_proxy_baseline();
-- Bootstrap verification metadata only for pending requests; never replay confirmed transitions.
INSERT INTO noco.linkedin_creation_proxy(task_id,baseline_uuid)
 SELECT t.id,p.state->'proxy'->>'uuid' FROM noco.linkedin_creation_task t
 LEFT JOIN noco.octo_profiles p ON p.client_id=t.client_id AND p.locale='en'
 WHERE t.status<>'выполнение подтверждено';
CREATE FUNCTION noco.linkedin_new_proxy_check() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.requires_new_proxy AND ((NEW.status IN ('сделана экспертом','выполнение подтверждено') AND (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status))
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
CREATE TRIGGER linkedin_new_proxy_check BEFORE INSERT OR UPDATE ON noco.linkedin_creation_task
 FOR EACH ROW EXECUTE FUNCTION noco.linkedin_new_proxy_check();
REVOKE ALL ON TABLE noco.linkedin_creation_proxy FROM PUBLIC;
REVOKE ALL ON FUNCTION noco.linkedin_proxy_baseline(),noco.linkedin_new_proxy_check() FROM PUBLIC;
COMMIT;
