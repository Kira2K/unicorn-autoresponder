# TODO: Existing-Profile Proxy Repair And Adoption

Goal: provide a safe standalone path for repairing or adopting proxies on
already-existing Dolphin profiles.

New-profile English proxy assignment is already handled by web-console Dolphin
profile provisioning. This TODO is for existing profiles that are missing a
proxy, using a suspicious proxy, using a user-owned proxy that should be
adopted, or needing a verified standard proxy name.

## Current Baseline

- Proxy diagnostics live in `proxyProvider/checkRequiredProxy`.
- Web-console provisioning can select an unused named proxy or `Ready N` proxy
  for a new English profile and rename it to the standard display name.
- Any live proxy deletion must wait for the separate real E2E safety test in
  `real-e2e-proxy-deleting`.

## Remaining Work

1. Read target profiles from Noco Dolphin bindings or explicit profile ids.
2. Read real Dolphin profile and proxy state.
3. Build a dry-run repair/adoption plan for each target.
4. For missing proxies, choose a safe unused proxy using the current
   provisioning rules.
5. For user-owned or incorrectly named proxies, plan adoption or rename without
   deleting the old proxy.
6. Verify profile state after every applied proxy update.
7. Write a local report that separates selection, Dolphin update, verification,
   notification, and manual cleanup outcomes.

## Notification Policy To Decide

- Whether client/admin Telegram notification is sent immediately or returned as
  a send plan.
- Exact message text for assigned, renamed, adopted, failed, and manual-review
  proxy outcomes.
- Whether provider-facing notifications are ever needed.

## Safety Rules

- Dry-run must be the default.
- Apply mode must be explicit and scoped to selected targets.
- Do not detach an existing working proxy without explicit apply mode.
- Do not delete proxies in this feature.
- Profile update and Telegram notification must be separately tracked.
- Never print proxy credentials in Telegram messages or ordinary logs.
