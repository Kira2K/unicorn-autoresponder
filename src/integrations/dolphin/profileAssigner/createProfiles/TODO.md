# TODO: Create Profile(s) For New User

Goal: create ready Dolphin browser profile(s) for a new client during onboarding.

## Intended Flow

1. Read onboarding/client data.
2. Determine enabled markets.
3. Create one Dolphin profile if the client has one enabled market.
4. Create two Dolphin profiles if the client has both Ru and En enabled.
5. Apply the correct market-specific profile standard to each profile.
6. Return Dolphin profile id(s) ready to write back to `Dolphin main`.

## Inputs

- Client name.
- Enabled market config: `Ru`, `En`, or both.
- Stack.
- Telegram/common chat data.
- Desired profile standard for each market.
- Optional existing proxy decision from `proxyProvider`.

## Expected Result

- Created Dolphin profile id(s).
- Profile metadata aligned with the standard for the market.
- A report that says which profile was created for which market.
- Data ready for `Dolphin main` write-back, especially:
  - `Dolphin Profile Ru Id`
  - `Dolphin Profile En Id`

## Future Decisions

- Exact profile naming convention.
- Required tags.
- Required profile status.
- Whether proxy assignment happens during profile creation or in a separate `proxyProvider` step.
- Whether the feature writes back to Google Sheets automatically or only returns a write-back plan.
- Which browser/profile fields are required for Ru vs En.

## Safety Rules

- First implementation must support dry-run mode.
- Do not create profiles when required onboarding fields are missing.
- Do not overwrite existing profile ids without an explicit replace mode.
- Every created profile must be traceable in a local report.
