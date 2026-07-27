# Telegram Resume Bot Performance TODO

Status: implemented. `/open_my_tasks` queries only active CV workflow statuses,
renders a compact paged task list, and avoids full client/platform-account
loading until a specific task is opened.

## Goal
Finish the remaining `/open_my_tasks` performance work for large CV workflow
tables.

## Implemented Optimization
- Avoid fetching all clients just to enrich the active CV task rows.
- Fetch full links, student contacts, and platform accounts only after a
  specific task is opened.
- In save/input flows, prefer the selected `workflowId` path and avoid falling
  back to full task-list scans when possible.

## Expected Result
- `/open_my_tasks` responds faster for Kira, main providers, and RU translator.
- Task details still show full data after clicking a task.
- Workflow statuses, commands, provider-lane rules, and Noco data semantics stay
  unchanged.

## Test Checklist
- `npm run tg:support-bot:test`
- `npm run web:test`
- `npm run typecheck`
