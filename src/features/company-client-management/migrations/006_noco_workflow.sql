-- Workflow records belong beside the existing business tables in the NocoDB source.
-- SET SCHEMA retains table identities, all rows, keys, indexes and native references.
ALTER TABLE company_management.collection_runs SET SCHEMA noco;
ALTER TABLE company_management.vacancy_stacks SET SCHEMA noco;
ALTER TABLE company_management.application_batches SET SCHEMA noco;
