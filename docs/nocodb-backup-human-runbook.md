# NocoDB Backup Runbook For Humans

This note explains how to back up our NocoDB data in a way that is easy to
follow, easy to inspect later, and safe enough for non-experts.

This document is written for humans. AI agents must not run these steps if the
backup status is RED or if any prerequisite is unclear.

## Goal

Save a complete, readable snapshot of the current NocoDB data on the persistent
disk.

Our database is small, so the strategy is simple:

- Make full backups, not incremental backups.
- Keep the raw backup folders because they are easy to inspect.
- Optionally keep ZIP copies for portability.
- Prefer boring, repeatable steps over clever automation.

## What The Backup Contains

The current backup job exports NocoDB data through the API.

It saves:

- Table list.
- Table metadata.
- Visible records from every table.
- Relation values returned by NocoDB.
- Best-effort optional metadata such as hooks and base info.
- A manifest and checksums.

It does not guarantee:

- Deleted records.
- Trash history.
- Deleted columns.
- Admin-only NocoDB internals blocked by API-token permissions.
- Attachment binary files, unless we later extend the backup job to download
  them.

For our current database, this is the easiest useful backup. If we ever need a
literal every-byte backend backup, we need a NocoDB/database-level dump, not
only the API export.

## Status Gate

Before running anything, set the backup status:

```text
GREEN  - Safe to run. Persistent disk is mounted, secrets are available, and the
         target folder is correct.
YELLOW - Human review needed. Something changed or is unclear.
RED    - Do not run.
```

AI agents must not run backup commands when status is RED.

AI agents must also stop if:

- The persistent disk path is unknown.
- The NocoDB token or base looks wrong.
- The command would write to an unexpected folder.
- The previous backup failed and no human has reviewed it.
- The human operator explicitly says not to run it.

## Normal Backup Process

1. Confirm the persistent disk is available.

   Make sure the target backup folder is on the persistent disk, not only on a
   temporary local workspace.

2. Confirm backup status is GREEN.

   If status is YELLOW, pause and review. If status is RED, stop.

3. Run the full backup job.

   ```powershell
   npm run noco:full-backup:apply
   ```

4. Find the generated folder.

   The job writes a timestamped folder under:

   ```text
   logs/nocodb-full-backup/<timestamp>/
   ```

   It also updates:

   ```text
   logs/nocodb-full-backup/latest.txt
   ```

5. Check the backup result.

   Open `manifest.json` and confirm:

   - `totals.tables` is not zero.
   - `totals.records` is not zero.
   - The table count looks normal.
   - The record count looks normal.
   - Any optional endpoint failures are expected permission/API limitations.

6. Check folder size.

   The backup should be small right now. A huge unexpected size jump is not
   automatically bad, but it should be reviewed.

7. Keep the folder.

   Do not edit files inside a completed backup folder. A backup is evidence; it
   should stay unchanged.

8. Optional: create a ZIP copy.

   ZIP copies are convenient for moving snapshots around, but the raw folder is
   easier to inspect.

## Clear TODO

- [ ] Decide the final persistent disk backup path.
- [ ] Put `logs/nocodb-full-backup` on that disk, either by running the repo
      from the disk or by using a junction/symlink.
- [ ] Decide who is allowed to run backups.
- [ ] Define where backup status lives: GREEN, YELLOW, or RED.
- [ ] Add attachment-file downloading if NocoDB attachment columns are ever
      added.
- [ ] Add a checksum verification command for existing snapshots.
- [ ] Add a monthly restore/readback test.
- [ ] Decide retention policy. Default: keep all daily backups unless the disk
      becomes unexpectedly large.
- [ ] Make sure the persistent disk is access-restricted because backups include
      personal data and credentials.

## Human Rules

- If unsure, do not run the backup.
- If status is RED, do not run the backup.
- If the target folder is not on the persistent disk, do not treat the result as
  a real backup.
- If the backup command fails, save the error and ask for review.
- Do not delete old backups casually.
- Do not share backup folders in chat or public tools.

## AI Rules

This file is for human operators first.

AI agents may explain this process, inspect existing backup folders, or draft
improvements. AI agents must not run the backup command if the status is RED.

AI agents must ask for human confirmation before running the backup if:

- The status is missing.
- The status is YELLOW.
- The persistent disk path cannot be verified.
- Running the command requires live NocoDB access.
- The human request is ambiguous.

When in doubt, AI should stop and report what is unclear.
