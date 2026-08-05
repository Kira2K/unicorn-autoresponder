# HH Autoresponses Unfixed Unsuccessful Profile Runs

Generated from HH orchestrator logs on 2026-07-26.

Scope:

- Log window: 2026-05-26 through 2026-07-26.
- Source logs: `logs/orchestrator-run-*.jsonl`.
- Files scanned: 338.
- Client final statuses scanned: 708.
- Rows retained here: 133 unsuccessful profile runs grouped by mistake class and client/market.

This document intentionally lists only mistake classes that still look unfixed after comparing the logs with the HH/orchestrator commits in the same period.

## Method

I treated these as normal or already accepted terminal outcomes and excluded them:

- `targets_processed`
- `no_new_targets`
- `limit_reached`
- `manual_targets_only`
- `hh_response_daily_limit_exceeded`
- `user_stop`
- `orchestrator_stop_after_watch`

I also excluded failure classes that later commits appear to have addressed:

- selected-client fatal failures, covered by `c9a55d3`, `cf6da0e`, and `c69c493`
- response-limit completion confusion, covered by `830c0a3`
- accepted HH terminal-stop reporting, covered by `7364813`
- production stop-list integration, covered by `a9bd086`
- single broken-vacancy recovery such as `NO_APPLY_RETURNED`, covered by later browser-responder recovery work
- old broad Dolphin auth preflight errors that were turned into clearer process-level preflight failures

Each table row below groups repeated unsuccessful profile runs for one client/market. `Runs` is the number of profile runs, `Dates` lists every unique date seen in the two-month window, and `Latest log` points to the newest evidence file for that group.

## Summary

| Mistake class | Profile runs | What is still not fixed |
|---|---:|---|
| HH captcha / anti-bot state | 50 | Captcha/DDOS/unclear HH anti-bot pages still stop individual profiles and require human handling. |
| HH auth / account state | 57 | Some profiles repeatedly fail logged-out/auth-validation/login-selector flows. |
| Dolphin / CDP disconnect | 19 | Browser profile starts but Playwright/CDP connection times out or closes while responder is running. |
| No terminal stop reason | 5 | Browser responder exits without a usable terminal reason, mostly EN profiles. |
| Profile lock busy | 1 | Automation lock can block a selected profile. |
| Dolphin cloud internal server error | 1 | Dolphin cloud API can fail during profile lock/tag cleanup and leave status ambiguous. |

## HH Captcha / Anti-Bot State

| Client / market | Runs | Dates | Reasons | Last detail | Latest log |
|---|---:|---|---|---|---|
| Кира / Ru | 21 | 2026-05-28, 2026-06-02, 2026-06-04, 2026-06-09, 2026-06-11, 2026-06-15, 2026-06-16, 2026-06-30, 2026-07-07, 2026-07-08, 2026-07-09, 2026-07-20 | `error_before_requirement` (21) | `HH captcha detected during auth flow` | `orchestrator-run-2026-07-20T00-49-50-591Z-23704.jsonl` |
| Всеволод Насонов / Ru | 5 | 2026-06-22, 2026-06-23, 2026-06-30, 2026-07-07 | `error_before_requirement` (5) | `HH captcha detected during auth flow` | `orchestrator-run-2026-07-07T02-38-02-919Z-34144.jsonl` |
| Самвел Мхитарян / Ru | 4 | 2026-06-30, 2026-07-15, 2026-07-23 | `error_before_requirement` (4) | HH auth stayed unknown with `ddosGuard`/anti-bot signals | `orchestrator-run-2026-07-23T02-00-07-613Z-25456.jsonl` |
| Анатолий Селиванов / Ru | 2 | 2026-06-30 | `error_before_requirement` (2) | HH auth stayed conflict before auto-responder start | `orchestrator-run-2026-06-30T14-42-11-522Z-22044.jsonl` |
| Андрей Пашинцев / Ru | 2 | 2026-06-30 | `error_before_requirement` (2) | HH auth stayed conflict before auto-responder start | `orchestrator-run-2026-06-30T14-42-11-522Z-22044.jsonl` |
| Андрей Прокопенко / Ru | 2 | 2026-06-30 | `error_before_requirement` (2) | HH auth stayed conflict before auto-responder start | `orchestrator-run-2026-06-30T14-42-11-522Z-22044.jsonl` |
| Данияр Сейфолла / Ru | 2 | 2026-06-30 | `error_before_requirement` (2) | HH auth stayed conflict before auto-responder start | `orchestrator-run-2026-06-30T14-42-11-522Z-22044.jsonl` |
| Иван Чебыкин / Ru | 2 | 2026-06-30 | `error_before_requirement` (2) | HH auth stayed conflict before auto-responder start | `orchestrator-run-2026-06-30T14-42-11-522Z-22044.jsonl` |
| Ильяс Тохтаран / Ru | 2 | 2026-06-30 | `error_before_requirement` (2) | HH auth stayed conflict before auto-responder start | `orchestrator-run-2026-06-30T14-42-11-522Z-22044.jsonl` |
| Мария Андреева / Ru | 2 | 2026-06-30 | `error_before_requirement` (2) | HH auth stayed conflict before auto-responder start | `orchestrator-run-2026-06-30T14-42-11-522Z-22044.jsonl` |
| Руслан Исхаков / Ru | 2 | 2026-06-30 | `error_before_requirement` (2) | HH auth stayed conflict before auto-responder start | `orchestrator-run-2026-06-30T14-42-11-522Z-22044.jsonl` |
| Всеволод Насонов / En | 1 | 2026-07-24 | `error_before_requirement` (1) | `HH captcha detected during auth flow` | `orchestrator-run-2026-07-24T04-43-30-106Z-13612.jsonl` |
| Данияр Сейфолла / En | 1 | 2026-07-20 | `error_before_requirement` (1) | `HH captcha detected during auth flow` | `orchestrator-run-2026-07-20T10-04-59-301Z-11196.jsonl` |
| Егор Новиков / Ru | 1 | 2026-06-30 | `error_before_requirement` (1) | HH auth stayed conflict before auto-responder start | `orchestrator-run-2026-06-30T14-42-11-522Z-22044.jsonl` |
| Самвел Мхитарян / En | 1 | 2026-07-23 | `error_before_requirement` (1) | `HH captcha detected during auth flow` | `orchestrator-run-2026-07-23T04-19-41-009Z-18976.jsonl` |

## HH Auth / Account State

| Client / market | Runs | Dates | Reasons | Last detail | Latest log |
|---|---:|---|---|---|---|
| Иван Чебыкин / Ru | 12 | 2026-06-11, 2026-06-16, 2026-07-01, 2026-07-14, 2026-07-15, 2026-07-16, 2026-07-20, 2026-07-21, 2026-07-22, 2026-07-23, 2026-07-24 | `auth_required` (2), `error_before_requirement` (10) | `HH auth validation failed: logged_out` | `orchestrator-run-2026-07-24T02-08-28-126Z-23516.jsonl` |
| Дан Цой / Ru | 9 | 2026-06-23, 2026-06-25, 2026-06-29, 2026-06-30, 2026-07-01, 2026-07-06 | `error_before_requirement` (9) | HH auth timed out after 240000ms | `orchestrator-run-2026-07-06T04-55-08-097Z-24100.jsonl` |
| Ирина Молодых / Ru | 8 | 2026-06-02, 2026-06-17, 2026-06-30, 2026-07-01, 2026-07-06 | `error_before_requirement` (8) | HH auth timed out after 240000ms | `orchestrator-run-2026-07-06T04-55-08-097Z-24100.jsonl` |
| Всеволод Насонов / Ru | 7 | 2026-06-17, 2026-06-22, 2026-06-29, 2026-06-30, 2026-07-01, 2026-07-06 | `error_before_requirement` (7) | HH auth timed out after 240000ms | `orchestrator-run-2026-07-06T04-55-08-097Z-24100.jsonl` |
| Егор Новиков / Ru | 5 | 2026-06-29, 2026-06-30 | `error_before_requirement` (5) | HH auth conflict after current-page auth | `orchestrator-run-2026-06-30T12-59-29-113Z-30688.jsonl` |
| Кира / Ru | 5 | 2026-06-11, 2026-06-30, 2026-07-01, 2026-07-06 | `error_before_requirement` (5) | HH auth timed out after 240000ms | `orchestrator-run-2026-07-06T04-55-08-097Z-24100.jsonl` |
| Анатолий Селиванов / Ru | 2 | 2026-06-23 | `error_before_requirement` (2) | HH auth validation stayed unknown | `orchestrator-run-2026-06-23T09-31-38-801Z-20228.jsonl` |
| Денис Полочкин / Ru | 2 | 2026-06-15 | `error_before_requirement` (2) | HH login form did not open | `orchestrator-run-2026-06-15T04-28-16-025Z-27312.jsonl` |
| Мария Андреева / Ru | 2 | 2026-07-01 | `auth_required` (1), `error_before_requirement` (1) | HH auth timed out after 240000ms | `orchestrator-run-2026-07-01T08-03-01-752Z-31264.jsonl` |
| Данияр Сейфолла / Ru | 1 | 2026-06-22 | `error_before_requirement` (1) | HH auth selector not found at email input | `orchestrator-run-2026-06-22T09-18-57-442Z-19972.jsonl` |
| Денис Полочкин / En | 1 | 2026-07-24 | `error_before_requirement` (1) | HH auth selector not found at password input | `orchestrator-run-2026-07-24T04-43-30-106Z-13612.jsonl` |
| Кирилл Карченков / Ru | 1 | 2026-07-06 | `error_before_requirement` (1) | HH auth timed out after 240000ms | `orchestrator-run-2026-07-06T04-55-08-097Z-24100.jsonl` |
| Руслан Исхаков / Ru | 1 | 2026-06-30 | `error_before_requirement` (1) | HH auth validation stayed unknown | `orchestrator-run-2026-06-30T07-57-00-009Z-8500.jsonl` |
| Самвел Мхитарян / Ru | 1 | 2026-06-24 | `error_before_requirement` (1) | HH login form did not open | `orchestrator-run-2026-06-24T08-43-06-970Z-9256.jsonl` |

## Dolphin / CDP Disconnect

| Client / market | Runs | Dates | Reasons | Last detail | Latest log |
|---|---:|---|---|---|---|
| Ирина Молодых / Ru | 3 | 2026-06-18, 2026-06-23, 2026-06-30 | `error_before_requirement` (3) | `browserType.connectOverCDP: Timeout 60000ms exceeded` | `orchestrator-run-2026-06-30T07-57-00-009Z-8500.jsonl` |
| Самвел Мхитарян / Ru | 3 | 2026-05-28, 2026-06-23, 2026-06-30 | `error_before_requirement` (3) | `browserType.connectOverCDP: Timeout 60000ms exceeded` | `orchestrator-run-2026-06-30T07-57-00-009Z-8500.jsonl` |
| Анатолий Селиванов / Ru | 2 | 2026-06-22, 2026-07-01 | `error_before_requirement` (2) | `browserType.connectOverCDP: Timeout 60000ms exceeded` | `orchestrator-run-2026-07-01T01-15-42-126Z-15088.jsonl` |
| Дан Цой / Ru | 2 | 2026-06-15, 2026-06-22 | `error_before_requirement` (2) | Browser CDP connection closed while responder was running | `orchestrator-run-2026-06-22T08-36-16-759Z-16248.jsonl` |
| Денис Полочкин / Ru | 2 | 2026-05-28, 2026-06-23 | `error_before_requirement` (2) | Browser CDP connection closed while responder was running | `orchestrator-run-2026-06-23T09-31-38-801Z-20228.jsonl` |
| Андрей Прокопенко / Ru | 1 | 2026-06-22 | `error_before_requirement` (1) | Browser CDP connection closed while responder was running | `orchestrator-run-2026-06-22T08-36-16-759Z-16248.jsonl` |
| Артем Пыркин / Ru | 1 | 2026-07-06 | `error_before_requirement` (1) | `browserType.connectOverCDP: Timeout 60000ms exceeded` | `orchestrator-run-2026-07-06T04-55-08-097Z-24100.jsonl` |
| Дан Цой / En | 1 | 2026-07-24 | `error_before_requirement` (1) | Browser CDP connection closed while responder was running | `orchestrator-run-2026-07-24T04-43-30-106Z-13612.jsonl` |
| Егор Новиков / Ru | 1 | 2026-07-01 | `error_before_requirement` (1) | `browserType.connectOverCDP: Timeout 60000ms exceeded` | `orchestrator-run-2026-07-01T01-15-42-126Z-15088.jsonl` |
| Иван Чебыкин / Ru | 1 | 2026-06-23 | `error_before_requirement` (1) | Browser CDP connection closed while responder was running | `orchestrator-run-2026-06-23T09-31-38-801Z-20228.jsonl` |
| Ильяс Тохтаран / En | 1 | 2026-07-20 | `error_before_requirement` (1) | Browser CDP connection closed while responder was running | `orchestrator-run-2026-07-20T04-26-48-001Z-16012.jsonl` |
| Мария Андреева / Ru | 1 | 2026-06-23 | `error_before_requirement` (1) | Browser CDP connection closed while responder was running | `orchestrator-run-2026-06-23T09-31-38-801Z-20228.jsonl` |

## No Terminal Stop Reason

| Client / market | Runs | Dates | Reasons | Last detail | Latest log |
|---|---:|---|---|---|---|
| Дан Цой / En | 3 | 2026-07-20, 2026-07-22, 2026-07-23 | `no_terminal_stop_reason` (3) | `no_terminal_stop_reason` | `orchestrator-run-2026-07-23T04-19-41-009Z-18976.jsonl` |
| Данияр Сейфолла / En | 2 | 2026-07-22, 2026-07-23 | `no_terminal_stop_reason` (2) | `no_terminal_stop_reason` | `orchestrator-run-2026-07-23T04-19-41-009Z-18976.jsonl` |

## Profile Lock Busy

| Client / market | Runs | Dates | Reasons | Last detail | Latest log |
|---|---:|---|---|---|---|
| Ильяс Тохтаран / Ru | 1 | 2026-07-08 | `instance_lock_busy` (1) | `instance_lock_busy:requirement_not_proven` | `orchestrator-run-2026-07-08T04-11-09-709Z-32352.jsonl` |

## Dolphin Cloud Internal Server Error

| Client / market | Runs | Dates | Reasons | Last detail | Latest log |
|---|---:|---|---|---|---|
| Иван Карпенко / Ru | 1 | 2026-07-22 | `error_before_requirement` (1) | Dolphin cloud API returned `Internal Server Error` during profile lock/startup | `orchestrator-run-2026-07-22T09-23-42-935Z-13276.jsonl` |

## Run-Level Blockers Not Counted Above

These are not profile-run rows, so they are not included in the 133 total. They are still relevant because they can prevent any profile from starting.

| Blocker | Count in window | Latest evidence | Current status |
|---|---:|---|---|
| Dolphin local API unreachable or stuck session | 23 | `orchestrator-run-2026-07-24T02-00-07-830Z-1200.jsonl` | Not fixed by code; still needs Dolphin app/session preflight and operator recovery. |
| Too many Dolphin profiles open before start | 19 | `orchestrator-run-2026-07-14T04-00-11-765Z-20652.jsonl` | Partly guarded by preflight, but stale profile cleanup still needs operational discipline. |
| Noco/network availability (`ENOTFOUND`, socket, 429) | 7 | `orchestrator-run-2026-07-20T04-20-12-135Z-20820.jsonl` | 429/readiness pressure was improved later by sequential readiness work; broad network outages are external. |
| Selected/readiness data fatal | 13 | `orchestrator-run-2026-07-22T02-00-10-226Z-25648.jsonl` | Treated as fixed by selected-client best-effort/readiness commits, so not listed as unfixed profile mistakes. |

## Recommended Fix Order

1. HH auth/account state:
   Focus first on `Иван Чебыкин / Ru` and `Денис Полочкин / En`, because they appear recently and repeatedly.

2. No terminal stop reason:
   Add a browser-responder/orchestrator classification fallback that captures why `Дан Цой / En` and `Данияр Сейфолла / En` exit without a terminal reason.

3. Dolphin/CDP disconnect:
   Add stronger retry/reopen behavior after profile starts but CDP either never connects or closes mid-run.

4. Captcha/anti-bot:
   Keep as per-client terminal with support/user action. Do not block the whole orchestrator.

5. Dolphin cloud API cleanup failure:
   Make tag/status cleanup retry cloud calls and record cleanup as degraded instead of making an otherwise normal profile look failed.
