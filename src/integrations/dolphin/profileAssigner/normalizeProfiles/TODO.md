# TODO: Normalize Existing Profiles

Goal: mass-fix existing Dolphin profiles so they align with our current standards.

This feature is for already-created profiles. It must not create new profiles unless a later explicit mode is designed for that.

## Intended Flow

1. Read enabled profile targets from `Dolphin main`.
2. Load the current Dolphin profile state for each target.
3. Compare each profile against the market-specific standard.
4. Produce a dry-run report with proposed changes.
5. In a future explicit apply mode, patch only approved fields.
6. Verify every changed profile after mutation.

## Market-Specific Standards

Ru and En profiles may differ. The future implementation must keep standards separate by market.

Expected checks:

- Profile name.
- Tags.
- Status.
- Proxy presence and proxy type.
- Profile fields required by Dolphin.
- Browser settings.
- Notes/comment fields.
- Any market-specific metadata we rely on for automation.

## Expected Result

- Per-profile audit result.
- List of profiles already aligned.
- List of profiles needing changes.
- In apply mode, list of successfully patched profiles and failed profiles.

## Future Decisions

- Exact standard for Ru profiles.
- Exact standard for En profiles.
- Which differences are warnings and which are blocking errors.
- Whether proxy normalization is owned here or delegated entirely to `proxyProvider`.
- Whether to normalize only enabled profiles or all known profiles.

## Safety Rules

- Dry-run must be the default.
- Apply mode must be explicit.
- The report must show before/after values for every proposed change.
- Failed updates must not stop cleanup/reporting for other profiles.
- Do not change profile ids in Google Sheets from this feature.
