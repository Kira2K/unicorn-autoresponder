# Company Stop-List DB TODO

The runtime company stop-list is built from production DB data:

- global `Comtek`, applied to every client
- `clients.stop_list_company`
- linked companies from `client_company_restrictions_from_stop_companies`

Future DB data must come with the client profile as:

```ts
blockedCompanies: Array<{ id: string; name: string }>
```

Important caution: load this list once per client before an automation run and
pass it into browser settings. Do not query DB while processing every vacancy.

NocoDB migration note:

- `client_company_restrictions_from_stop_companies` keeps the raw migrated
  stop-list fields.
- `src/integrations/noco/stop-companies` parses those raw fields, creates
  missing company directory rows in `companies_from_applications`, and links
  restrictions to companies through `rel_restrictions_blocked_companies`.
- Runtime integration builds `blockedCompanies` once per client run from these
  linked company rows plus `clients.stop_list_company`.

Archive TODO:

- After production stop-list data is consolidated and verified, archive
  `client_company_restrictions_from_stop_companies`. It is currently still read
  for compatibility with migrated stop-company restrictions.
