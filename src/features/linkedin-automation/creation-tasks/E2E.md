# Contractor acceptance — 25 October 2026

The full live run passed for the two approved existing fixtures, tasks **1** and **9**.
No profiles were recreated. The backend used an isolated Render stand and the shared SQL
database; a single Octo worker held leadership. The Windows Desktop remained signed into
the restricted guest. A separate local owner Desktop handled the existing protected bridge
protocol and durable one-shot receipts. Owner sessions/caches remained local.

| Check | Task 1 — OctoGuide | Task 9 — synthetic Artyom |
| --- | --- | --- |
| Guest identity and actual EN opening | Passed | Passed |
| Normal closure and complete cleanup | Passed | Passed |
| Actual proxy capture and SQL receipt | Passed | Passed |
| Proxy typed and submitted through the visible form | Existing proxy preserved | Passed |
| LinkedIn fields in existing platform account | UI save/readback with full rollback | Test fields saved and verified |
| Expert completion and page reload | Existing status preserved | Passed |

Artyom's proxy connection came from **Октон Октонович (client 257)**, not OctoGuide.
All six connection fields matched; the demo has its own saved proxy object and one profile
binding. The source proxy/profile and OctoGuide's RU profile were preserved. No LinkedIn
account was registered and no messages were sent.

Local verification: **205** mock/contract tests, student and contractor browser E2E,
typecheck and frontend build passed. This is contractor access acceptance, separate from
the independent fresh-owner archive check.

Private run evidence is kept outside Git:
`tmp/linkedin-creation/denis-access/report.json` records `passed: true` and
`independentGuestDesktopVerified: true`, with results for each task.
`tmp/linkedin-creation/staging/docker-owner/.state/journal.json` retains the bridge receipts.
Reports contain no proxy passwords, guest credentials or API tokens.

The stand is temporary. Passing this test does not publish the contractor feature to
the production backend; deployment of that feature is a separate release.
