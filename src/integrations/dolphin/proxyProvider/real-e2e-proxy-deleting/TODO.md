# REAL E2E PROXY DELETING

## Goal

Build an opt-in live E2E test that proves Dolphin proxy adoption and proxy
deletion are safe before enabling any production delete path.

The test must cover the classic user workflow:

1. Create a disposable Dolphin team user for the test run.
2. Share a disposable test profile to that user.
3. Log in as the test user through Dolphin UI.
4. Create a proxy using Dolphin native UI.
5. Attach that proxy to the shared disposable profile.
6. Save the profile.
7. Run proxy adoption from the main account.
8. Verify the profile now uses a main-owned proxy.
9. Delete only the disposable old proxy after all safety checks pass.

## Required Safety Rules

- Never delete a proxy unless it is proven to be created by this E2E run.
- Tag/name all test objects with a unique run id, for example
  `proxy-adoption-e2e-<timestamp>`.
- Never delete if any Dolphin profile still references the old proxy id.
- Never delete if `/proxy?ids=<oldProxyId>` reports a nonzero or unknown
  `browser_profiles_count`.
- Never delete if the old proxy is owned by `DOLPHIN_MAIN_USER_ID`.
- Never delete if the old proxy id equals the new proxy id.
- Never delete if the target profile was not freshly re-read and verified to
  use the new main-owned proxy.
- If ownership or run-id proof is missing, leave the object and print manual
  cleanup instructions.

## Test Stages

1. Unit tests with fake Dolphin API responses:
   - dry-run performs no writes;
   - adoption creates or reuses the main-owned proxy;
   - profile reattach is verified after patch;
   - delete guard refuses every ambiguous case.
2. Integration-style fake workflow:
   - simulate a shared user attaching a user-owned proxy;
   - verify adoption output and redacted logs.
3. Live Playwright smoke, gated by `DOLPHIN_LIVE_PROXY_E2E=true`:
   - create disposable team user with `canCreateBp=true` and a small profile
     limit;
   - use Playwright for the Dolphin UI workflow;
   - run adoption first with `--no-delete`;
   - verify old proxy still exists and the profile uses the main proxy;
   - run delete-enabled adoption only for the disposable old proxy;
   - verify the main proxy still exists, the profile still uses it, and no
     unrelated proxy/profile ids changed.

## Cleanup Rules

- Delete only test-created profiles, proxies, and team users that include the
  unique run id.
- If cleanup cannot prove that an object belongs to the current E2E run, do not
  delete it.
- Cleanup failures must be reported with object ids and manual cleanup notes.

## Notes

- This E2E must stay separate from normal CI because it requires live Dolphin
  credentials and creates cloud objects.
- Normal production rollout must start with dry-run and `--no-delete`.
- Proxy host, login, password, and change-IP URL must stay redacted in logs by
  default.
