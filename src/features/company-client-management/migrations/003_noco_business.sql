-- Move existing objects, preserving OIDs, rows, foreign keys, indexes and owned sequences.
-- Internal evidence and migration receipts stay outside the NocoDB source schema.
ALTER TABLE company_management.companies SET SCHEMA noco;
ALTER TABLE company_management.company_identifiers SET SCHEMA noco;
ALTER TABLE company_management.company_restrictions SET SCHEMA noco;
ALTER TABLE company_management.vacancies SET SCHEMA noco;
ALTER TABLE company_management.applications SET SCHEMA noco;
ALTER TABLE company_management.client_company_events SET SCHEMA noco;
ALTER TABLE company_management.sources SET SCHEMA noco;
ALTER VIEW company_management.active_restrictions SET SCHEMA noco;
ALTER VIEW company_management.client_company_summary SET SCHEMA noco;
ALTER VIEW company_management.company_directory SET SCHEMA noco;
ALTER TABLE company_management.schema_migrations ADD COLUMN details jsonb;
