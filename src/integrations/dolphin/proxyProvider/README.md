# Dolphin Proxy Provider

This area owns Dolphin proxy diagnostics and remaining proxy repair/adoption
work for existing profiles.

New-profile English proxy assignment is currently handled by the web-console
Dolphin provisioning flow. Standalone proxy work should focus on already-created
profiles that are missing a proxy, using a suspicious proxy, using a user-owned
proxy that should be adopted, or needing a verified standard proxy name.

## Responsibilities

- Diagnose proxy/profile state from real Dolphin data.
- Plan safe existing-profile proxy repair or adoption.
- Keep proxy selection, profile update, verification, and notification outcomes
  auditable.
- Keep live proxy deletion behind a separate opt-in E2E safety gate.

## Feature Folders

- `checkRequiredProxy/`: read-only report for profiles that need proxy review.
- `provideProxy/`: TODO for existing-profile proxy repair/adoption.
- `real-e2e-proxy-deleting/`: TODO for a live opt-in delete safety test.

## Safety Rules

- Diagnostic checks must not mutate Dolphin or send Telegram messages.
- Mutation features must start with dry-run/report mode.
- Proxy deletion must not be added to normal repair/adoption flows.
- Do not print proxy credentials in Telegram messages or ordinary logs.
