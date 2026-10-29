-- Explicit operator migration. Application startup never applies this file.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF current_database() NOT IN ('unicorn_noco_copy','unicorn_noco_copy_restore') OR
    (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())
      IS DISTINCT FROM 'unicorn-noco-copy:pqe5susktrsa9z3:20260911:v1' THEN
    RAISE EXCEPTION 'Copy database required';
  END IF;
END $$;

ALTER TABLE noco.platform_accounts ADD COLUMN IF NOT EXISTS is_banned boolean NOT NULL DEFAULT false;
ALTER TABLE noco.octo_profiles ADD COLUMN IF NOT EXISTS proxy_is_made_by_expert boolean NOT NULL DEFAULT false;

-- The provenance travels with the exact proxy binding in durable profile state.
CREATE OR REPLACE FUNCTION noco.octo_proxy_expert_projection() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  NEW.proxy_is_made_by_expert:=coalesce((NEW.state->'proxy'->>'isMadeByExpert')::boolean,false);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS octo_proxy_expert_projection ON noco.octo_profiles;
CREATE TRIGGER octo_proxy_expert_projection BEFORE INSERT OR UPDATE ON noco.octo_profiles
FOR EACH ROW EXECUTE FUNCTION noco.octo_proxy_expert_projection();

-- Only a saved expert receipt for this exact current student/profile/proxy proves provenance.
UPDATE noco.octo_profiles p SET state=jsonb_set(p.state,'{proxy,isMadeByExpert}','true'::jsonb,true),revision=p.revision+1
WHERE p.state->'proxy'->>'uuid' IS NOT NULL AND NOT coalesce((p.state->'proxy'->>'isMadeByExpert')::boolean,false)
AND EXISTS(SELECT 1 FROM noco.linkedin_creation_task t WHERE t.client_id=p.client_id AND t.proxy_profile_id=p.profile_id
  AND t.proxy_uuid=p.state->'proxy'->>'uuid' AND t.proxy_saved_at IS NOT NULL);

CREATE TABLE IF NOT EXISTS noco.linkedin_intake_notifications(
 account_id bigint PRIMARY KEY REFERENCES noco.platform_accounts(id),
 client_id bigint NOT NULL REFERENCES noco.clients(id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','attempting','sent','failed','uncertain')),
 claim_token text,claimed_at timestamptz,message_id bigint,error_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT SELECT,INSERT,UPDATE ON noco.linkedin_intake_notifications TO unicorn_sql_app;
COMMIT;
