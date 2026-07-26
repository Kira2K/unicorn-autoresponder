# Telegram Resume Bot Performance TODO

## Goal
Speed up `/open_my_tasks` when many CV processing rows exist.

## Planned Optimization
- Query only active resume task statuses from `cv_processing` instead of loading all rows.
- Keep compact task lists lightweight: workflow id, client id/name, market, status, and expected action.
- Fetch full links, student contacts, and platform accounts only after a specific task is opened.
- Refetch only the selected workflow row after save/advance operations instead of reloading all CV processing rows.

## Expected Result
- `/open_my_tasks` responds faster for Kira, main providers, and RU translator.
- Task details still show full data after clicking a task.
- Workflow statuses, commands, provider-lane rules, and Noco data stay unchanged.

## Test Checklist
- `npm run tg:support-bot:test`
- `npm run web:test`
- `npm run typecheck`
