-- Structural rollback only. No values, IDs, history or notification records are replaced.
-- Pause writers and reopen cached Unicorn SQL repositories after rollback.
BEGIN;
LOCK TABLE noco.clients IN ACCESS EXCLUSIVE MODE;
DO $migration$
DECLARE
    old_present boolean; new_present boolean; f record; body text;
BEGIN
    SELECT EXISTS(SELECT FROM pg_attribute WHERE attrelid='noco.clients'::regclass AND attname='resume_status' AND NOT attisdropped),
           EXISTS(SELECT FROM pg_attribute WHERE attrelid='noco.clients'::regclass AND attname='resume_status_legacy' AND NOT attisdropped)
      INTO old_present,new_present;
    IF old_present=new_present THEN RAISE EXCEPTION 'clients_legacy_column_ambiguous'; END IF;
    IF (SELECT count(*) FROM copy_meta.inventory WHERE definition->>'sqlName'='clients')<>1 THEN
        RAISE EXCEPTION 'clients_inventory_mapping_required';
    END IF;
    IF (SELECT count(*) FROM copy_meta.inventory i,
        LATERAL jsonb_array_elements(i.definition->'mapping') m
        WHERE i.definition->>'sqlName'='clients' AND m->>'sqlName' IN ('resume_status','resume_status_legacy'))<>1 THEN
        RAISE EXCEPTION 'clients_legacy_mapping_ambiguous';
    END IF;
    FOR f IN SELECT DISTINCT p.oid FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
             WHERE t.tgrelid='noco.clients'::regclass AND NOT t.tgisinternal
    LOOP
        body:=pg_get_functiondef(f.oid);
        IF body LIKE '%NEW."resume_status_legacy"%' OR body LIKE '%OLD."resume_status_legacy"%' THEN
            EXECUTE replace(replace(body,'NEW."resume_status_legacy"','NEW."resume_status"'),
                                         'OLD."resume_status_legacy"','OLD."resume_status"');
        END IF;
    END LOOP;
    IF new_present THEN ALTER TABLE noco.clients RENAME COLUMN resume_status_legacy TO resume_status; END IF;
    UPDATE copy_meta.inventory i SET definition=jsonb_set(i.definition,'{mapping}',(
        SELECT jsonb_agg(CASE WHEN m->>'sqlName'='resume_status_legacy'
                            THEN jsonb_set(m,'{sqlName}','"resume_status"'::jsonb) ELSE m END ORDER BY ord)
        FROM jsonb_array_elements(i.definition->'mapping') WITH ORDINALITY x(m,ord)
    )) WHERE i.definition->>'sqlName'='clients';
END;
$migration$;
COMMIT;
