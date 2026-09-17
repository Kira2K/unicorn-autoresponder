\set ON_ERROR_STOP on
SELECT NOT EXISTS (SELECT FROM pg_database WHERE datname='unicorn_noco_copy') AS missing \gset
\if :missing
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='unicorn_noco_copy_owner') THEN
    RAISE EXCEPTION 'existing_unowned_role';
  END IF;
END $$;
CREATE ROLE unicorn_noco_copy_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE DATABASE unicorn_noco_copy OWNER unicorn_noco_copy_owner TEMPLATE template0 ENCODING 'UTF8';
COMMENT ON DATABASE unicorn_noco_copy IS 'unicorn-noco-copy:pqe5susktrsa9z3:20260911:v1';
REVOKE ALL ON DATABASE unicorn_noco_copy FROM PUBLIC;
\else
DO $$ BEGIN
  IF shobj_description((SELECT oid FROM pg_database WHERE datname='unicorn_noco_copy'),'pg_database')
     IS DISTINCT FROM 'unicorn-noco-copy:pqe5susktrsa9z3:20260911:v1' THEN
    RAISE EXCEPTION 'existing_unowned_database';
  END IF;
END $$;
\endif
