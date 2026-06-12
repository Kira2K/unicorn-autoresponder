# Dolphin Proxy Provider

Documentation-only placeholder for the future service that will manage Dolphin proxies for new and existing accounts.

This service should own proxy selection, preparation, profile attachment, and client notification policy.

## Responsibilities

- Operate with existing proxies inside Dolphin.
- Modify or prepare proxies when needed.
- Attach proxies to Dolphin profiles.
- Support both onboarding profiles and existing accounts.
- Notify clients by Telegram after a proxy is assigned or changed.

## Feature Folders

- `checkRequiredProxy/`: read-only report that checks `ПЕРС ДАННЫЕ` against real Dolphin proxy/profile state.
- `provideProxy/`: assign or update a proxy for a Dolphin profile and prepare notification output.

## Non-Goals For Mutation Features

- No Dolphin proxy mutations without explicit apply mode.
- No Telegram sends from diagnostic checks.
- No proxy credentials in ordinary logs or reports.

The first real implementation should start with dry-run/report mode before changing any proxy/profile.

## Shared Future Requirements

- Proxy assignment must be auditable.
- Existing proxy inventory must be read from Dolphin, not hardcoded.
- Profile updates and Telegram notification should be treated as separate steps.
- Failures must clearly say whether proxy selection, Dolphin update, verification, or notification failed.
