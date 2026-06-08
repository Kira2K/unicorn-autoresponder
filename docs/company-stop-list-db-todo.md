# Company Stop-List DB TODO

The current company stop-list is intentionally mocked:

- `mock-comtek` / `Comtek`
- `mock-trynexis` / `Trynexis`

Future DB data must come with the client profile as:

```ts
blockedCompanies: Array<{ id: string; name: string }>
```

Important caution: load this list once per client before an automation run and
pass it into browser settings. Do not query DB while processing every vacancy.

NocoDB migration note:

- `client_company_restrictions_from_stop_companies` keeps the raw migrated
  stop-list fields.
- `noco/stop-companies` parses those raw fields, creates missing company
  directory rows in `companies_from_applications`, and links restrictions to
  companies through `rel_restrictions_blocked_companies`.
- Runtime integration is still a separate step: once NocoDB becomes the runtime
  DB, build `blockedCompanies` from the linked company rows once per client run.
