# TODO: Provide Proxy

Goal: provide a valid Dolphin proxy for new and existing accounts.

The feature operates with existing proxies inside Dolphin. It may modify/prepare proxies, connect them to profiles, and notify clients by Telegram after assignment.

## Intended Flow

1. Read the target profile(s).
2. Read available proxies from Dolphin.
3. Select a proxy according to the future proxy policy.
4. Modify or prepare the proxy if needed.
5. Connect the proxy to the Dolphin profile.
6. Verify the profile has the expected proxy attached.
7. Notify the client by Telegram.
8. Write a local assignment report.

## Inputs

- Dolphin profile id.
- Client name.
- Market.
- Common chat id or notification target.
- Existing Dolphin proxy inventory.
- Proxy assignment policy.

## Expected Result

- Dolphin profile has a valid assigned proxy.
- Assignment is verified after update.
- Client receives a Telegram notification.
- Local report records:
  - profile id
  - client name
  - market
  - selected proxy id/name
  - update status
  - notification status

## Future Decisions

- Proxy selection rules.
- Whether proxies can be reused across profiles.
- Rotation policy.
- How to handle dead or invalid proxies.
- Exact Telegram notification text.
- Whether notifications are sent immediately or returned as a send plan.
- Whether proxy preparation belongs here or in a separate sub-feature.

## Safety Rules

- First implementation must support dry-run mode.
- Do not detach an existing working proxy without explicit apply mode.
- Profile update and Telegram notification must be separately tracked.
- If profile update succeeds but notification fails, the report must make that partial success obvious.
- Never print proxy credentials in Telegram messages or ordinary logs.
