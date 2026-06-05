# Client status advisory report

Compares Noco `clients.client_status` with the old Google status sheet.
Noco is the current source of truth; sheet mismatches are advisory.

Default mode is dry-run:

```bash
npm run noco:client-status:dry-run
npm run noco:client-status:test
```

The job reads the shared status spreadsheet as an audit/reference source. It
does not treat Dolphin profile count as a status signal.

Legacy apply still exists as `npm run noco:client-status:legacy-apply`, but use
it only when the sheet is explicitly confirmed as the desired source for that
run.
