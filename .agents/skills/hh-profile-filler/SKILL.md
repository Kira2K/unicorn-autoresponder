---
name: hh-profile-filler
description: Fill and replace HH resumes in Dolphin from final Google Drive CVs and read-only Noco data. Use when Codex is asked to prepare, dry-run, run, schedule, supervise, diagnose, or report HH profile filling by client/status/market, including About, privacy, employer stop-lists, resume duplicates, and password login.
---

# HH Profile Filler

Operate the repository implementation in `src/features/hh-profile-filler`. Keep Noco read-only.

## Safety invariants

- Resolve the client by numeric Noco ID and market; never guess between duplicate names.
- Require current `client_status` to match `on ru market` or `on en market`.
- Require a final CV with status `moved to filling` or `filled`. If it is missing, make no HH changes.
- Treat CAPTCHA, 2FA, unknown mandatory fields, missing/ambiguous stack/profile/account, and rejected credentials as typed failures. Do not bypass them.
- Never log passwords, Noco tokens, Dolphin tokens, raw CV bytes, or full credentials.
- Never publish a resume or start autoresponses.
- Snapshot old resume IDs/titles before replacement. Create and verify replacements before deleting old resumes, except for the documented one-at-a-time HH limit fallback.
- Send failures and completion reports through the existing Telegram reporting session to `summary_logs_channel_id`.

## Commands

- One client, live dry-run: `npm run profile-filler -- --client-id <id> --market ru|en --dry-run`
- One client, dry-run then real fill: `npm run profile-filler -- --client-id <id> --market ru|en`
- Scan status transitions only: `npm run profile-filler:scan`
- Scan and process pending jobs: `npm run profile-filler:pending`
- Tests: `npm run profile-filler:test && npm run typecheck`

The pending runner uses the fixed initial watermark `2026-09-03T15:53:37+02:00`, records later status transitions locally, performs a live dry-run before mutation, and retries failures once per day for at most three attempts.

## Source and field policy

Read [field-policy.md](references/field-policy.md) before a run that fills HH. Read [operations.md](references/operations.md) before scheduling, supervising, or diagnosing the runner.

Use the final CV first and Noco only as fallback. Use `Самопрезентация` from the student's Drive folder to expand employer candidates. Include employers, brand owners, brands/products, vendors, customers, and partners; add only unambiguous official HH employer cards and report skipped candidates without stopping.

For En always set `Tbilisi, Georgia` and work permits `Georgia`, `Serbia`, `Armenia`. For both markets set business trips ready, on-site/office + remote + hybrid, preferred contact email, hide structured phone numbers, and visibility to everyone except the employer stop-list. Build About in Contacts → Summary/About → Skills order. Set every added HH skill to Advanced.

Use the exact stack title mapping implemented in `stack-titles.ts`; the malformed Go En fragment `S` is intentionally absent.
