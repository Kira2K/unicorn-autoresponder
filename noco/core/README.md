# Noco Core

Shared helpers for NocoDB jobs.

- `config.ts`: reads and validates NocoDB environment config.
- `client.ts`: NocoDB request wrapper, retry handling, pagination, create/patch helpers.
- `schema.ts`: shared table ids and relation names.
- `client-ref-overrides.ts`: user-confirmed legacy `client_ref` aliases and mentor matching overrides.
- `relations.ts`: relation column creation/reuse and record linking.
- `reports.ts`: timestamped report directories, `latest.txt`, json/text writers.
- `job.ts`: CLI argument parsing. No args means dry-run.
- `text.ts`: shared normalization and slug helpers.
- `test-utils.ts`: tiny helpers for fixture tests.

Do not put job-specific rules here. If a helper mentions a concrete business table behavior, it belongs in a job folder.

Exception: durable identity facts confirmed by the user may live in `client-ref-overrides.ts`, because several jobs need the same canonical client mapping.
