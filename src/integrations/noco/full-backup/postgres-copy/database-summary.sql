\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT json_build_object('database',current_database(),
  'tables',(SELECT count(*) FROM information_schema.tables WHERE table_schema='noco' AND table_type='BASE TABLE'),
  'inventory_count',(SELECT count(*) FROM copy_meta.inventory),
  'inventory_digest',(SELECT md5(string_agg(id||':'||definition::text,'' ORDER BY id)) FROM copy_meta.inventory),
  'constraints_digest',(SELECT md5(string_agg(conname||':'||pg_get_constraintdef(oid),'' ORDER BY conname,conrelid::regclass::text))
      FROM pg_constraint WHERE connamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('noco','copy_meta'))),
  'sequences_digest',(SELECT md5(string_agg(sequencename||':'||last_value::text,'' ORDER BY sequencename)) FROM pg_sequences WHERE schemaname='noco'),
  'size_bytes',pg_database_size(current_database()));
ROLLBACK;
