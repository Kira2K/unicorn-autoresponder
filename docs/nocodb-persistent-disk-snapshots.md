# NocoDB Persistent Disk Snapshots

Investigation date: 2026-07-06 UTC.

## Current Export Size

I ran the existing read-only full API backup:

```powershell
npm run noco:full-backup:apply
```

Generated snapshot:

```text
logs/nocodb-full-backup/2026-07-06T04-13-05-956Z
```

Measured size:

| Measure | Value |
| --- | ---: |
| Tables | 29 |
| Records | 3,615 |
| Files | 100 |
| Raw directory size | 3,789,478 bytes / 3.614 MiB |
| ZIP size | 290,023 bytes / 0.277 MiB |

Largest record exports:

| Table | Records | Records file size |
| --- | ---: | ---: |
| `migration_trace_archive` | 2,133 | 1.095 MiB |
| `platform_accounts` | 435 | 0.354 MiB |
| `clients` | 107 | 0.171 MiB |
| `hh-autoresponses` | 31 | 0.082 MiB |
| `contracts_payments` | 104 | 0.066 MiB |

Retention estimate at today's size:

| Retention | Raw snapshots | ZIP snapshots |
| --- | ---: | ---: |
| 30 daily snapshots | ~108 MiB | ~8.3 MiB |
| 90 daily snapshots | ~325 MiB | ~24.9 MiB |
| 365 daily snapshots | ~1.29 GiB | ~101 MiB |

Even with a 10x growth buffer, one year of daily raw API snapshots would be
around 13 GiB. Compressed snapshots are dramatically smaller because the export
is mostly JSON text.

## Can We Use The Persistent Disk?

Yes, the persistent disk is a good fit for these NocoDB API snapshots. The data
volume is small, snapshots are append-only directories, and the existing backup
job already writes a self-contained directory with manifest, checksums, table
metadata, records, and best-effort optional metadata.

Current code writes to:

```text
logs/nocodb-full-backup/<timestamp>/
```

To place snapshots on the new disk, use one of these approaches:

1. Run the repo from a working directory that lives on the persistent disk.
2. Symlink or junction `logs/nocodb-full-backup` to a directory on the persistent
   disk.
3. Add a configurable backup/report root, for example
   `NOCO_FULL_BACKUP_ROOT`, if we want the job to write directly to the mount.

Option 2 is the smallest operational change. Option 3 is cleaner if this should
be part of repeatable automation.

## "Literally All The Data" Caveat

The existing backup is a full visible NocoDB API snapshot, not a database-level
dump. It includes:

- All tables returned by the base metadata API.
- Full table metadata returned by NocoDB.
- All visible records from those tables.
- Relation values as returned in record payloads.
- Table hooks and other optional metadata when the current API token is allowed
  to read them.
- Checksums and a manifest.

It does not guarantee:

- Deleted records or trash history.
- Deleted columns.
- NocoDB internals blocked from API-token access.
- Organization API tokens, plugin settings, some visibility/share settings, or
  other admin-only endpoints when NocoDB returns 401/403/404.
- Attachment binary files. The current schema scan did not find actual
  attachment columns, but if attachment fields are added later, this job will
  preserve only the attachment metadata returned in records unless we extend it
  to download the files too.

For the current database, this is enough for operational restore/reference of
the NocoDB base content. If the requirement becomes a legal/compliance-grade
"every byte NocoDB stores", we need either a NocoDB-native database dump from
the underlying storage or an admin export path, not only the API backup.

## Recommendation

Use the persistent disk for nightly `noco:full-backup:apply` snapshots and keep:

- 30-90 days of raw directories for easy inspection.
- Optional ZIP copies for longer retention.
- The generated `manifest.json` and `checksums.json` with every snapshot.

At the measured 2026-07-06 size, disk capacity is not a concern. The bigger
operational concern is secrecy: these exports include personal data and account
credentials, so the persistent disk should be access-restricted and treated like
production secrets storage.
