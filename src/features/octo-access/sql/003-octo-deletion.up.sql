-- Explicit owner migration; grants only. No profile data or schema is changed.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$
BEGIN
  IF current_database() NOT IN ('unicorn_noco_copy','unicorn_noco_copy_restore') OR
    (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())
      IS DISTINCT FROM 'unicorn-noco-copy:pqe5susktrsa9z3:20260911:v1' THEN
    RAISE EXCEPTION 'Copy database required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN
    ('noco.dolphin_profiles'::regclass,'noco.octo_profiles'::regclass,'noco.octo_event_inbox'::regclass)
    AND pg_get_userbyid(relowner) IS DISTINCT FROM current_user) THEN
    RAISE EXCEPTION 'Run as the profile tables owner';
  END IF;
END $$;
GRANT DELETE ON noco.octo_profiles,noco.octo_event_inbox,noco.dolphin_profiles TO unicorn_sql_app;
COMMIT;
