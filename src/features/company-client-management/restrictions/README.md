# Shared restrictions: original storage only

Edit `noco.client_company_restrictions_from_stop_companies`, its existing student/company links, and `noco.clients.stop_list_company`. These are shared by HH and external responses. No additional restriction table is used after migration `005_existing_restrictions`.

`existing.mts` reads these original records and returns normalized rules in memory. It keeps market scope, native company links and the existing global HH stop-list. Canonical company IDs are resolved through explicit import provenance, never guessed from names. HH receives company/name bans. External responses also receives the original contextual text for interpretation. Unreadable or ambiguous relationships fail closed; they are not an empty restriction list.

Global vacancy-selection rules belong in [vacancy-selection/SKILL.md](../../../../.agents/skills/vacancy-selection/SKILL.md). They run before saving a vacancy and use no student's CV. They are separate from personal student restrictions.

`read.mts` switches storage based on the atomic migration receipt, so code can be deployed before cleanup. Its replacement-table reader exists only for older deployments and migration equivalence checks.

`restore.mts` removes `noco.company_restrictions`, `noco.active_restrictions` and `noco.client_company_summary`. The latter two are derived views, not processing/history tables. `noco.applications` retains outcomes and evidence; internal `application_batches` retains execution checkpoints. Neither is removed.

## Checked cleanup

```powershell
npm run company:sql -- restrictions-restore-plan --out .tmp/restrictions-backup.json
npm run company:sql -- restrictions-restore-apply --input .tmp/restrictions-backup.json --expect-checksum HASH --out .tmp/restrictions-result.json
```

The plan is a **private backup** of every replacement rule, both view definitions and the equivalent original-source policies. Keep it out of version control. The apply command takes the existing migration lock and source-table write locks, verifies complete equivalence and the saved backup hash, restores original editors, then drops the three redundant objects without CASCADE. DDL and the receipt commit together. New, edited, revoked or future replacement rules that cannot be represented exactly by the original sources block cleanup.

Lost commit acknowledgement is reconciled using the receipt. Historical migration SQL remains immutable; the old archive/import entry points cannot recreate the deleted policy model after restoration. NocoDB may require PostgreSQL Meta Sync to remove stale UI entries. Do not create another Noco source.

Tests: `tests/restore-restrictions.test.mts`, existing company SQL contracts, HH PostgreSQL policy tests and external database-policy tests. No applications or messages are sent by these checks.
