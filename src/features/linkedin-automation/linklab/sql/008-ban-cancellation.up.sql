BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
  IF current_database() NOT IN ('unicorn_noco_copy','unicorn_noco_copy_restore') OR
    (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())
    IS DISTINCT FROM 'unicorn-noco-copy:pqe5susktrsa9z3:20260911:v1' THEN
    RAISE EXCEPTION 'Copy database required';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION noco.crm_cancel_ban_report(
  p_client bigint, p_account bigint, p_student uuid, p_link_version bigint,
  p_ban_version text, p_confirmed_at timestamptz
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE
  binding record;
  account record;
BEGIN
  IF p_client IS NULL OR p_client<1 OR p_client>2147483647 OR p_account IS NULL OR p_account<1 OR
    p_student IS NULL OR p_link_version IS NULL OR p_link_version<1 OR
    p_ban_version IS NULL OR p_ban_version !~ '^[1-9][0-9]{0,9}$' OR p_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'crm_ban_cancel_invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(730644,p_client::integer);
  PERFORM id FROM noco.clients WHERE id=p_client AND NOT coalesce(__nc_deleted,false) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'crm_ban_cancel_stale'; END IF;
  SELECT platform_account_id,crm_student_id,version,status INTO binding
    FROM noco.linklab WHERE client_id=p_client FOR UPDATE;
  IF NOT FOUND OR binding.platform_account_id IS DISTINCT FROM p_account OR
    binding.crm_student_id IS DISTINCT FROM p_student OR binding.version IS DISTINCT FROM p_link_version THEN
    RAISE EXCEPTION 'crm_ban_cancel_stale';
  END IF;
  SELECT a.is_banned,a.xmin::text AS row_version,
    coalesce(a.updated_at,a.created_at,'epoch'::timestamptz) AS changed_at INTO account
    FROM noco.platform_accounts a JOIN noco.platforms p ON p.id=a.platforms_id
    WHERE a.id=p_account AND a.clients_id=p_client AND lower(p.name)='linkedin'
      AND NOT coalesce(a.__nc_deleted,false) AND NOT coalesce(p.__nc_deleted,false) FOR UPDATE OF a;
  IF NOT FOUND OR account.row_version IS DISTINCT FROM p_ban_version OR
    account.changed_at IS DISTINCT FROM p_confirmed_at THEN
    RAISE EXCEPTION 'crm_ban_cancel_stale';
  END IF;
  IF account.is_banned THEN
    UPDATE noco.platform_accounts SET is_banned=false,updated_at=statement_timestamp()
      WHERE id=p_account AND clients_id=p_client;
  END IF;
  RETURN binding.status;
END;
$body$;
REVOKE ALL ON FUNCTION noco.crm_cancel_ban_report(bigint,bigint,uuid,bigint,text,timestamptz) FROM PUBLIC,unicorn_sql_app;
GRANT EXECUTE ON FUNCTION noco.crm_cancel_ban_report(bigint,bigint,uuid,bigint,text,timestamptz) TO linkedin_manager;
COMMIT;
