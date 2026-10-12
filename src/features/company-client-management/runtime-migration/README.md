# Runtime migration and original restrictions

Current business data uses `noco.companies`, `noco.sources`, `noco.vacancies`, `noco.applications` and the **original** `noco.client_company_restrictions_from_stop_companies` plus `noco.clients.stop_list_company`. HH enforces company/name bans; contextual interpretation remains external-only.

Migration 004 originally copied restrictions into `company_restrictions` and archived the original editors. That arrangement was superseded by [migration 005](../restrictions/README.md): originals are editable again and the replacement table plus `active_restrictions` and `client_company_summary` views are removed. The old company/application evidence remains archived. Do not re-run archive or legacy-import commands to configure current restrictions.

`noco.collection_runs` holds collection/classification checkpoints. `noco.vacancy_stacks` links saved vacancies to existing populated stacks. `noco.application_batches` stores frozen targets, limits and resumable submission intent. `applications` stores durable outcomes and evidence; batch state and outcome rows commit together. [Migration 006](../workflow-relocation/README.md) moves these three existing tables into the schema exposed by the current NocoDB source. None is another restrictions directory.

`planRuntime(pool,database)` and `applyRuntime(pool,database,checksum)` remain historical migration/reconciliation interfaces. Applied SQL checksums are immutable. Follow migrations 001–004 with 005 and 006 when restoring that historical installation sequence. Current readers select original restriction storage using the 005 receipt; failures never silently disable bans.

All business tables remain under the existing PostgreSQL source in NocoDB base `pr3u973t7owkzz1`. Never create another source. After cleanup, PostgreSQL Meta Sync may be needed to remove obsolete UI entries. Do not label the original restrictions table or student stop-list field as archived.

Tests: company SQL contracts, external `tests/postgres-pipeline.test.ts`, `tests/database-policy.test.ts`, and PostgreSQL `canonical-policy.test.mts`. No live applications are part of migration verification.
