# Dolphin Profile Assigner

This area documents remaining Dolphin profile standardization work.

New missing profile creation is currently handled by the web-console Dolphin
provisioning flow in `src/features/web-console/backend/dolphin-profile-provisioning.ts`.
That flow creates profiles from `DOLPHIN_TEMPLATE_PROFILE_ID`, writes Noco
Dolphin profile bindings, applies canonical tags, and handles current English
proxy assignment rules.

## Responsibilities

- Keep current Dolphin profile naming, tagging, locale, and proxy standards
  explicit.
- Audit existing Dolphin profiles against Noco-backed web-console provisioning
  standards.
- Plan safe repair of existing profiles through dry-run reports before any
  mutation.

## Feature Folders

- `normalizeProfiles/`: audit and repair already-created profiles so they match
  current standards.

## Safety Rules

- Dry-run/report mode must be the default for normalization.
- Do not create new profiles from normalization jobs.
- Do not change Noco profile ids unless a separate focused repair mode is
  designed and reviewed.
- Do not print proxy credentials in ordinary logs or reports.
