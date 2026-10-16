-- Apply only AFTER CV-done-compatible Unicorn/CRM consumers have been installed.
-- Automatic messages must be disabled. Preserve all links, history, IDs and dates.
BEGIN;
UPDATE noco."CV processing" SET status='CV done'
WHERE status IN ('moved to filling','filled','finished');
CREATE OR REPLACE FUNCTION noco.normalize_cv_done_status()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
BEGIN
    IF NEW.status IN ('moved to filling','filled','finished') THEN NEW.status:='CV done'; END IF;
    RETURN NEW;
END;
$body$;
DROP TRIGGER IF EXISTS aa_cv_done_status ON noco."CV processing";
CREATE TRIGGER aa_cv_done_status BEFORE INSERT OR UPDATE OF status ON noco."CV processing"
FOR EACH ROW EXECUTE FUNCTION noco.normalize_cv_done_status();
-- Do not rename clients.resume_status here: generated legacy SQL triggers and
-- copy_meta.inventory mappings need a separate compatibility check first.
COMMIT;
