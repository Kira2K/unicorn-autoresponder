# Telegram Resume Bot Performance TODO

Status: partially implemented. `/open_my_tasks` already queries only active CV
workflow statuses and renders a compact paged task list.

## Goal
Finish the remaining `/open_my_tasks` performance work for large CV workflow
tables.

## Remaining Optimization
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
