# Manual filling: persisted contract and regression map

Contract version: **2**. These are implementation gates, not live HH acceptance.
PR66 retains explicit client/market selection, manual-only execution, publication and recovery.
PR60 adds complete persisted-state verification, preservation, source and delivery journals.

## Execution

1. Resolve the market through the configured read-only repository, regardless of client status.
   Require a unique account/profile, stack and final CV. PostgreSQL mode verifies the configured
   source and shared pool identity, with no fallback to Noco after failure.
2. Read the actual Dolphin name. Final CV supplies fields; experience descriptions supply only named
   organizations. Reject identity overrides. Refresh source records before mutation and deletion.
   Use a visible browser with an exclusive profile lock.
3. Snapshot old IDs and open the operation journal. Fill/reuse a unique baseline, read before writes,
   save only supported differences, preserve unrelated records and reopen saved editors.
4. Verify full content/privacy before publication and before each native copy. Record clone IDs and
   reuse them on recovery. Never blindly repeat an unknown clone POST.
5. Publish each exact target, verify active/searchable HH server state, then ensure active job-search
   status. En requires persisted EN. Every target requires exactly 30 saved Advanced skills.
6. Recheck every target before deleting old snapshot IDs. At the resume limit stop without deleting
   existing resumes to make room. Preserve completed work when an operation fails.
7. Report success only with a complete versioned contract and verified IDs. verify-final is read-only
   and rejects drafts. activate and title-variants preserve existing resumes; activation never refills
   content or privacy, and incomplete prerequisites block it.

Queues, status triggers and scheduled Profile Filler tasks remain disabled. The legacy repository
method revalidateClientStatus now refreshes source identity/target data, not client market status.

## Evidence and regressions

| Requirement | Gate / regression |
| --- | --- |
| Titles and IDs | Exact mapping, unique targets, ambiguous matches rejected; contract/service tests |
| Identity, contacts, About | Reopened editors compared with approved fields; contract DOM tests |
| Experience/education | Content, dates, resume membership and unrelated-record preservation; DOM tests |
| Languages | CV/fallback levels, dedicated editor; language policy and UI tests |
| Skills | 30 unique persisted tags, same 30 Advanced levels, loss restores then stops; skills tests |
| En resume language | Metadata EN independent of site UI; publication/language adapter tests |
| Location/permits/preferences | Saved market values and exact checked sets; contract/UI tests |
| Privacy | Blacklist, anonymous, hidden phones, other fields visible; persisted checks |
| Employers | Source stop-list/named organizations, one candidate per save, saved checkbox; employer tests |
| Publication | Exact ID/title active and searchable; active_search job status; completion tests |
| Copies/deletion | Verified baseline before copy; all targets rechecked before delete; failure regressions |
| Preservation | Immutable first observations, exclusive profile lock, operation/target journal; invariant tests |
| Source | Fresh repository data, SQL configuration/pool identity; source/repository tests |
| Reporting | Actual Dolphin name, sanitized reason, complete terminal contract; format tests |
| Delivery | Operation-keyed sent/unknown journal; sent skips, uncertain delivery blocks retry; invariant tests |
| Smoke | Allowlisted client/profile, unpublished draft, cleanup, no Telegram; service tests |

Only missing/ambiguous official employer cards may be skipped with a recorded reason. Unavailable
search, lost checkboxes, unreadable fields or missing sections block whole-operation success.

## Validation boundary

Run profile-filler:test, typecheck, Dolphin runtime and affected PostgreSQL runtime tests. Suites use
mock adapters and intercepted local browser fixtures. They do not fill live HH resumes, send Telegram,
change ENV files or register tasks. Fixtures do not prove compatibility with a changed live HH layout.
