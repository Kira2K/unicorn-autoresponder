BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE noco.linklab
  ADD COLUMN profile_revision bigint NOT NULL DEFAULT -1 CHECK (profile_revision >= -1),
  ADD COLUMN profile_filled_count integer CHECK (profile_filled_count BETWEEN 0 AND 21),
  ADD COLUMN profile_percent integer GENERATED ALWAYS AS
    (round(profile_filled_count::numeric * 100 / 21)::integer) STORED,
  ADD COLUMN profile_first_completed_at timestamptz,
  ADD COLUMN proxy_state text NOT NULL DEFAULT 'Не активна'
    CHECK (proxy_state IN ('Не активна','Активна')),
  ADD COLUMN proxy_cycle_id uuid,
  ADD COLUMN proxy_started_at timestamptz,
  ADD COLUMN proxy_ends_at timestamptz,
  ADD COLUMN proxy_completed_at timestamptz;

ALTER TABLE noco.linklab_changes
  ADD COLUMN proxy_cycle_id uuid,
  ADD COLUMN proxy_started_at timestamptz;

CREATE TABLE noco.linklab_crm_results (
  operation_id uuid PRIMARY KEY,
  client_id bigint NOT NULL REFERENCES noco.linklab(client_id),
  crm_student_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('profile_progress','proxy_completed')),
  payload jsonb NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('applied','stale')),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Runs after linklab_before_change; existing status/date rules stay unchanged.
CREATE FUNCTION noco.linklab_workflow_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.proxy_state <> 'Не активна' OR NEW.proxy_cycle_id IS NOT NULL THEN
      RAISE EXCEPTION 'linklab_proxy_requires_existing_binding';
    END IF;
  ELSIF NEW.proxy_state IS DISTINCT FROM OLD.proxy_state THEN
    IF NEW.proxy_state = 'Активна' THEN
      IF OLD.confirmed_version <> OLD.version OR OLD.crm_student_id IS NULL
        OR OLD.platform_account_id IS NULL THEN
        RAISE EXCEPTION 'linklab_proxy_requires_confirmed_binding';
      END IF;
      NEW.proxy_cycle_id := gen_random_uuid();
      NEW.proxy_started_at := clock_timestamp();
      NEW.proxy_ends_at := NEW.proxy_started_at + interval '48 hours';
      NEW.proxy_completed_at := NULL;
      NEW.version := OLD.version + 1;
      NEW.updated_at := NEW.proxy_started_at;
    ELSIF NEW.proxy_state = 'Не активна' AND OLD.proxy_cycle_id IS NOT NULL THEN
      -- Only the CRM function has permission to set this completion field.
      IF NEW.proxy_completed_at IS DISTINCT FROM OLD.proxy_ends_at
        OR clock_timestamp() < OLD.proxy_ends_at THEN
        RAISE EXCEPTION 'linklab_proxy_completion_required';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION noco.linklab_workflow_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.proxy_cycle_id IS DISTINCT FROM OLD.proxy_cycle_id THEN
    UPDATE noco.linklab_changes SET
      changed_fields=changed_fields || ARRAY['proxy_state'],
      proxy_cycle_id=NEW.proxy_cycle_id, proxy_started_at=NEW.proxy_started_at
      WHERE client_id=NEW.client_id AND version=NEW.version;
    IF NOT FOUND THEN RAISE EXCEPTION 'linklab_proxy_event_missing'; END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER linklab_workflow_before BEFORE INSERT OR UPDATE ON noco.linklab
  FOR EACH ROW EXECUTE FUNCTION noco.linklab_workflow_before();
CREATE TRIGGER linklab_workflow_after AFTER UPDATE ON noco.linklab
  FOR EACH ROW EXECUTE FUNCTION noco.linklab_workflow_after();

CREATE FUNCTION noco.linklab_apply_crm_result(
  p_operation_id uuid, p_client_id bigint, p_student_id uuid, p_kind text, p_payload jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_row noco.linklab; saved noco.linklab_crm_results;
  revision bigint; filled integer; first_at timestamptz; outcome text := 'applied';
BEGIN
  IF p_operation_id IS NULL OR p_student_id IS NULL OR p_kind IS NULL OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'linklab_result_invalid'; END IF;
  SELECT * INTO current_row FROM noco.linklab WHERE client_id=p_client_id FOR UPDATE;
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

REVOKE ALL ON FUNCTION noco.linklab_workflow_before(), noco.linklab_workflow_after() FROM PUBLIC;
REVOKE ALL ON FUNCTION noco.linklab_apply_crm_result(uuid,bigint,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON TABLE noco.linklab_crm_results FROM PUBLIC;
COMMIT;
