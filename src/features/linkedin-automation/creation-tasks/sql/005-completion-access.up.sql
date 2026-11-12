-- Change only the access prerequisite in the currently installed completion guards.
-- Preserve every other installed rule, ownership, privilege and historical row.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_database() NOT IN ('unicorn_noco_copy','unicorn_noco_copy_restore') OR
  (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())
    IS DISTINCT FROM 'unicorn-noco-copy:pqe5susktrsa9z3:20260911:v1' THEN RAISE EXCEPTION 'Copy database required'; END IF;
END $$;
LOCK TABLE noco.linkedin_creation_task IN SHARE ROW EXCLUSIVE MODE;
DO $migration$
DECLARE
 target regprocedure;
 definition text;
 prerequisite constant text := '(p.state->''grant'' IS NULL OR p.state->''grant''->>''phase''=''complete'')';
 replacement constant text := 'true /* linkedin_completion_access_independent_v1 */';
BEGIN
 FOREACH target IN ARRAY ARRAY['noco.linkedin_creation_task_check()'::regprocedure,'noco.linkedin_new_proxy_check()'::regprocedure] LOOP
  definition := pg_get_functiondef(target);
  IF position(prerequisite IN definition)>0 THEN
   IF (length(definition)-length(replace(definition,prerequisite,'')))/length(prerequisite)<>1 THEN
    RAISE EXCEPTION 'linkedin_completion_guard_unrecognized: %',target;
   END IF;
   EXECUTE replace(definition,prerequisite,replacement);
  ELSIF position(replacement IN definition)=0 THEN
   RAISE EXCEPTION 'linkedin_completion_guard_unrecognized: %',target;
  END IF;
 END LOOP;
END $migration$;
COMMIT;
