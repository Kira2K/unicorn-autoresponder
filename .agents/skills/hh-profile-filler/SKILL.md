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
- Never start autoresponses. Do not publish a newly built resume. A title variant made with HH's native
  `Duplicate` flow may be published by HH when its profession is saved; allow that only after the filled
  baseline was verified and the mapped variant is missing.
- Snapshot old resume IDs/titles before replacement. Create and verify replacements before deleting old resumes, except for the documented one-at-a-time HH limit fallback.
- Send exactly one final Telegram report per client/market run through the existing reporting session to
  `summary_logs_channel_id`: only `Получилось заполнить` after verified completion or `Не получилось
  заполнить` after terminal failure. Do not include client IDs, credentials, stack/stop-list details, dry-run,
  retry, skipped-employer, or intermediate UI errors in Telegram; keep diagnostics in local artifacts.

## Commands

- One client, live dry-run: `npm run profile-filler -- --client-id <id> --market ru|en --dry-run`
- One client, dry-run then real fill: `npm run profile-filler -- --client-id <id> --market ru|en`
- Explicitly approved cross-person CV with Noco identity: add `--use-noco-identity`. Never use this
  flag from the status queue or without a direct user instruction naming both people.
- Scan status transitions only: `npm run profile-filler:scan`
- Scan and process pending jobs: `npm run profile-filler:pending`
- Tests: `npm run profile-filler:test && npm run typecheck`

The pending runner uses the fixed initial watermark `2026-09-03T15:53:37+02:00`, records later status transitions locally, performs a live dry-run before mutation, and retries failures once per day for at most three attempts.

## Source and field policy

Read [field-policy.md](references/field-policy.md) before a run that fills HH. Read [operations.md](references/operations.md) before scheduling, supervising, or diagnosing the runner.

Use the final CV first and Noco only as fallback. Use `Самопрезентация` from the student's Drive folder to expand employer candidates. Include employers, brand owners, brands/products, vendors, customers, and partners; add only unambiguous official HH employer cards and report skipped candidates without stopping.

For En always set `Tbilisi, Georgia` and work permits `Georgia`, `Serbia`, `Armenia`. For both markets set business trips ready, on-site/office + remote + hybrid, preferred contact email, hide structured phone numbers, and visibility to everyone except the employer stop-list. Build About in Contacts → Summary/About → Skills order. Set every added HH skill to Advanced.

Use the exact stack title mapping implemented in `stack-titles.ts`; the malformed Go En fragment `S` is intentionally absent.

## Resume title variants

- Build the complete title set for the resolved stack and market from `stack-titles.ts`.
- When one fully filled resume already exists under the primary mapped title, preserve it as the content
  baseline and create only missing title variants with HH's native `Duplicate` action. Reuse an incomplete
  draft whose profession matches a target variant instead of creating a second draft.
- Every variant must contain the same contacts, About, experience, education, languages, skills, skill
  levels, work preferences, anonymity, and employer stop-list. Only the resume title changes.
- Set each duplicate's profession through the dedicated profession step and select the stack specialization.
  The native duplicate flow can publish on `Save and continue`; this is permitted only for these verified
  title variants. Continue to use safe partial-edit routes for ordinary drafts and never publish them.
- Verify the baseline and every configured title before considering the run successful. Never remove the
  baseline merely to make room for another title unless the user explicitly authorizes replacement.
