# Noco Handoff

This is the short operational overview for colleagues who need to inspect or run
the NocoDB maintenance jobs.

## Source Of Truth

- Noco native relations and record `Id`s are canonical.
- Current client statuses live in Noco. The old Google status sheet is advisory
  only and may contain stale values.
- Old workbook/sheet imports are archive history, not live automation inputs.
- Missing Dolphin profile rows can be intentional cost saving.
- HH account/profile readiness is separate from Dolphin profile binding.

## Safe Workflow

1. Run a dry-run command.
2. Open the latest report directory under `logs/`.
3. Read `summary.json` first.
4. Inspect the focused detail file before any apply.
5. Apply only when the report matches the intended change.
6. Run the same dry-run again to confirm the result.

## Main Commands

```bash
npm run noco:post-migration-health:dry-run
npm run noco:dolphin-profile-audit:dry-run
npm run noco:relations:dry-run
npm run noco:cleanup-audit:dry-run
npm run noco:full-backup:apply
```

`noco:client-status:dry-run` compares Noco with the old status sheet, but its
patches are advisory. Apply mode is intentionally unsupported because the sheet
can be stale.

## Apply Commands

- `noco:relations:apply`: repairs native relation links from safe plans.
- `noco:dolphin-profile-audit:apply`: creates/links safe Dolphin profile rows.
- `noco:stop-companies:apply`, `noco:sync-markets:apply`, and
  `noco:sync-mentors:apply`: sync operational relation data.
- `noco:cleanup-audit:apply`: only for cleanup actions the audit supports.

For focused Dolphin profile repairs, scope apply with:

```bash
NOCO_DOLPHIN_PROFILE_AUDIT_CLIENT_ID=19 npm run noco:dolphin-profile-audit:apply
```

On PowerShell:

```powershell
$env:NOCO_DOLPHIN_PROFILE_AUDIT_CLIENT_ID='19'
npm run noco:dolphin-profile-audit:apply
Remove-Item Env:\NOCO_DOLPHIN_PROFILE_AUDIT_CLIENT_ID
```

## Current Health Interpretation

Health failures mean "review this bucket", not "apply every suggested patch".
In particular, client-status sheet mismatches are informational. Real blockers
are unsafe relation rows, Dolphin binding conflicts or missing profile rows, and
cleanup candidates that need a product/schema decision.

## Before Sharing A Commit

- Keep generated reports and local inventories out of the commit.
- Commit active Noco code, package scripts, and docs together.
- Run:

```bash
npm run noco:test
npm run typecheck
```
