# Dolphin Profile Assigner

Documentation-only placeholder for the future service that will create and normalize Dolphin browser profiles.

This service must own profile assignment standards, while low-level Dolphin API
access should stay in `src/integrations/dolphin`.

## Responsibilities

- Create ready Dolphin profile(s) for a new client during onboarding.
- Normalize existing Dolphin profiles so they match our current operational standards.
- Keep profile behavior market-specific: Ru and En profiles may have different names, settings, tags, proxies, notes, and sheet fields.

## Feature Folders

- `createProfiles/`: create one or two Dolphin profiles for a new client based on enabled markets.
- `normalizeProfiles/`: audit and mass-fix existing profiles to match the current standards.

## Non-Goals For The First TODO Stage

- No runtime implementation.
- No CLI commands.
- No Dolphin API mutations.
- No Google Sheets writes.
- No Telegram notifications.

These docs exist so the implementation can be designed safely before touching real Dolphin accounts.

## Shared Future Requirements

- All write operations must support dry-run/report mode first.
- Every mutation must produce a per-profile result record.
- Profile standards must be explicit and versioned enough that old profiles can be compared against them.
- Any sheet write-back must be separate from Dolphin mutation and confirm exactly which cells would change.
