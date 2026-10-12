# Company sources

This stage owns the source registry and prepares inputs for vacancy collection. Start with [sources.md](sources.md), not historical verification files. Different source formats require different readers; a Google workbook URL is not an employer careers URL.

Market policy updated 2026-09-28: market is derived from the vacancy description, English -> Global and Russian -> Ru; other/ambiguous language stays unknown. The old company-jurisdiction helper was removed. The source loader does not impose a company market; collection records the language decision on each vacancy and accepted SQL source JSON. This is an operator routing convention, not a claim about legal jurisdiction. Student cohort routing and aggregator adapters remain separate work. Pending registration/login review belongs to the source, not one task per student.

The reviewed September 26 company directory is consolidated through [company-client-management/directory](../../company-client-management/directory/README.md). Its authoritative collection scope is the 428 active source companies, exposed by `noco.company_directory`, with URLs in `noco.sources` after migration `003_noco_business`. These belong to the existing PostgreSQL NocoDB source. Historical migration identities exist only to retain restrictions/history links and do not expand the collection scope. `notify_only` is a data flag for a report section, with no assignee requirement or notification-delivery logic. The SQL consolidation does not switch this stage's existing file reader to DB automatically.

## Contract

`processCompanySources(snapshot, layout) → CompanySourceCatalog` in [index.ts](index.ts) is pure: it reads no network, database, browser or AI and sends no applications. [google-sheet.ts](google-sheet.ts) is the native Sheets snapshot reader; [resources.sheet.json](resources.sheet.json) defines this workbook's tab/column mapping and deferred sources. [types.ts](types.ts) defines the contracts. [report.ts](report.ts) produces offline Markdown and CSV.

Input: an authenticated, timestamped workbook snapshot with file ID/name/MIME type, sheet metadata and bounded `CellData` reads, plus the source-specific layout. Output: typed resources, exact file/sheet/row/cell references, per-tab coverage, duplicate occurrences, a company manifest and review/deferred/blocked queues. Identity mismatch, wrong MIME type or missing read timestamp throws. Missing/unconfigured tabs and missing/invalid links remain explicit audit issues.

Actual hyperlinks and rich-text links take precedence over displayed labels. Literal `HYPERLINK("URL", ...)` formulas are supported; formulas are never executed or guessed. Company-name hyperlinks are a fallback when the designated link cell has none. Duplicate URLs retain every reference; no company-name merging or student application-history inference occurs.

## Current registry and routing

The registered file is **РЕСУРСЫ для откликов**, ID `1_LoP34m2JAhkzBo_q9P5geltTlwEJ6LHKTd67UywP04`, a native Google Sheet with 16 tabs. It is a different source from the earlier 41-company verification workbook; that older workbook is not implicitly added to this registry.

| Source content | Handling |
|---|---|
| `ИНТЕГРАТОРЫ И САЙТЫ`, rows 3 onward | Name in C, fallback B; website in D, fallback links in C/B. E is auxiliary LinkedIn data and always blocked. G:L notes are evidence, not executable rules. F contacts are not needed. |
| `АГРЕГАТОРЫ` | Named aggregator resources; separate search adapters required. |
| `ТГ-КАНАЛЫ (En)` / `(Ru)` | Deferred inputs for the future `tg-responses` integration using the existing Telegram parser. |
| Python, AQA, React, DevOps, Java, Go, .NET/C#, MLOps | Historical vacancy seeds. Recheck availability and resolve employers' complete listings before collection; tab names are hints, not DB stack definitions. |
| `Контакты HR из ТГ`, `КРИТЕРИИ` | Not activated as discovery sources. No HR outreach or import of old criteria into student restrictions. |
| Hidden tabs | Audited as skipped archives, not silently activated. |

LinkedIn/`lnkd.in` links are retained as blocked audit records and never opened. Himalayas, HiringCafe, Wantapply and Hirefy/Hirify remain deferred under the user's existing scope. HH links belong to the existing HH workflow. Mail/phone links remain deferred references. Nested Drive links require their own reader. No link is opened by this stage.

Current access was verified through Google Drive metadata and native Sheets cell reads on 2026-09-25. Twelve source-bearing tabs were processed; four reference/archive tabs are explicitly excluded. All selected reads covered their metadata-bounded rows, including empty tails. Student names and application marks from vacancy tabs were removed from the saved snapshot; they are not confirmation evidence. The original Sheet was not modified.

## Run and refresh

```powershell
npm run external:responses -- sources --input storage/external-responses/company-sources/resources-20260925.snapshot.json --layout src/features/external-responses/company_sources/resources.sheet.json --out logs/external-responses/company-sources/resources-20260925
```

Generated files: `catalog.json`, `companies.json`, `review.json`, `deferred.json`, `blocked.json`, `report.md`, `sources.csv`. Snapshots belong under ignored `storage/external-responses/company-sources`; reports under ignored `logs/external-responses/company-sources`. Keep access credentials and fetched data out of this source-code folder.

`companies.json` is structurally compatible with `collect --input ...`, but contains only prepared website URLs. It is not proof of complete registry coverage: first reconcile missing company links and explicitly record the scope of deferred/blocked resources. `readyForFullCollection` stays false while unresolved or deferred resources remain. Do not call a prepared subset a complete all-company campaign. Source preparation does not crawl websites or establish that vacancies exist.

Refresh currently uses the dialog's authenticated Drive connector: read metadata first, then use native Sheets `CellData` for this file, preserving hyperlinks and physical coordinates. Read only needed columns; omit student/contact details. Office workbooks require a Drive file reader instead, without converting the original. Standalone CLI replay is implemented; unattended Drive authentication/fetch and other source-format adapters remain future integration work.

The active pipeline is: resolve registered sources + existing populated DB stacks → collect every company in the reviewed manifest → classify the complete vacancy list by DB stack descriptions → evaluate each student's restrictions → prepare/apply/report. Source notes and old sheet criteria cannot override confirmed DB policies.

To extend, add an explicit registry entry and a source-specific reader producing the same resource/provenance contract. Keep acquisition outside normalization. Unknown formats/tabs become review items rather than guessed website sources. Tests: `node --test src/features/external-responses/tests/company-sources.test.ts` and `pipeline-cli.test.ts`.

## PostgreSQL source registry

`loadDatabaseSources(read)` in `postgres.ts` reads active companies and canonical sources with explicit company/source IDs. `sources --out catalog.json` exports that registry independently. Normal `collect` uses the complete SQL manifest; a bounded manual test can pass a frozen subset with its original DB bindings to `collectVacancies` and the independent SQL adapters. `--offline` is for file-only fixtures. Aggregators remain distinct discovery sources, never employers. Deferred/unsupported entries and sources with terminal coverage gaps remain in the report. Missing source outcomes still block applications. `notify_only` is a report flag and prohibits automatic submission; there is no notification delivery.
