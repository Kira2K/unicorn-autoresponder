# CV completion after TAS-143

This addendum supersedes the final-status descriptions in `resume-workflow.md`
when the TAS-143 package is installed. Other roles, approvals, transition order,
links, rejection handling, and recipients remain unchanged.

- Student final approval writes the single terminal status `CV done`.
- Existing final statuses `moved to filling`, `filled`, and `finished` are
  normalized by the prepared SQL migration only after compatible consumers are installed.
- Readers accept the old final values during cutover. They are not offered as new selectable states.
- Profile fillers can read final CVs at `CV done`; completion does not start their tasks automatically.
- EN approval continues to record LinkLab's confirmation date atomically; RU approval,
  imports, and manual final-status edits do not invent this date.
- RU-only final replies include the RU link; EN/both replies retain the available EN/RU links.
- The existing final-step notification conditions remain the same, now keyed by `CV done`.
- Test-user runs finish at `CV done`, not at an independent profile-filling state.

Clients notifier installation and rollback: see
`src/features/client-lifecycle/README.md`. Message values and the report recipient
are read from the protected PostgreSQL settings row. `.env.clients.example` contains
only the disabled feature flag; no real recipient IDs, URLs, or credentials are published.
