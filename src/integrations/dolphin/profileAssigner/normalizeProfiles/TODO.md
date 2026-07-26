# TODO: Normalize Existing Dolphin Profiles

Goal: audit and repair already-created Dolphin profiles so they match the
current Noco-backed web-console provisioning standards.

This is not profile creation. New missing profiles are already handled by the
web-console Dolphin provisioning flow.

## Current Baseline

- Noco Dolphin profile bindings are the source of truth for which profiles
  belong to a client.
- Web-console provisioning creates missing profiles from
  `DOLPHIN_TEMPLATE_PROFILE_ID`.
- Canonical profile tags include `binded`, `to <client name>`, and
  `noco:<clientId>`.
- Profile names are built from client first name, second name, stack, and market
  label.
- English profiles may need a standard proxy name based on client name, profile
  id, common chat id, stack, and `En`.

## Remaining Work

1. Read Noco clients and Dolphin profile bindings.
2. Load current Dolphin profile state for each bound profile.
3. Compare each profile against current web-console provisioning standards.
4. Produce a dry-run report with exact before/after values.
5. Add explicit apply mode only after the report format and safe patch fields
   are reviewed.
6. Re-read every changed profile after mutation and report verification results.

## Checks

- Profile exists in Dolphin for every active Noco binding.
- Bound profile name matches the current standard.
- Required tags are present without removing unrelated useful tags.
- Market/locale expectation matches the Noco binding.
- English profile proxy exists when required and has the expected safe display
  name.
- Suspicious or shared proxies are reported, not automatically changed.

## Safety Rules

- Dry-run must be the default.
- Apply mode must be explicit and focused.
- Do not create new profiles from this job.
- Do not change Noco profile ids from this job unless a separate repair mode is
  designed and reviewed.
- Do not print proxy credentials in ordinary logs or reports.
- Failed updates must not stop cleanup/reporting for other profiles.
