# Noco Full Backup

Read-only API backup for the current visible NocoDB state.

Purpose:

- Export every table returned by the base metadata API.
- Save full table metadata, including columns, views, relation fields, and other table-level metadata returned by Noco.
- Save all visible records as per-table JSONL files.
- Save best-effort project, permission, hook, and connected metadata that the current API token can read.
- Write counts, checksums, and a manifest so the backup can be inspected later.

Commands:

```bash
npm run noco:full-backup:dry-run
npm run noco:full-backup:apply
npm run noco:full-backup:test
```

Reports:

`logs/nocodb-full-backup/<timestamp>/`

- `manifest.json` - backup index, totals, table paths, endpoint results.
- `base-tables.json` - table list returned by the base metadata API.
- `checksums.json` - SHA-256 checksums for record export files.
- `records/*.jsonl` - actual row data, one JSON object per line.
- `table-meta/*.json` - full table metadata.
- `optional-meta/*.json` - permission/settings/hooks metadata the token could read.

Limits:

- This is not a database-level dump.
- Deleted/trash records and deleted columns are not included unless Noco returns them through the API.
- Attachment binary files are not downloaded; attachment metadata is preserved as returned in records.
- Some admin settings, API tokens, plugins, shared settings, or visibility rules may be blocked by Noco Cloud/API-token permissions.

