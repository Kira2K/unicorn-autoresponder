# Profile Fill Queue Flow

This diagram defines two job types: read-only preview work and account-scoped,
read-back-verified mutations. It describes the target Web V1 job manager; the
initial scaffold does not yet implement every box shown here.

```mermaid
flowchart TD
    A["Verified LinkedIn identity"] --> RO["Create read_only job"]
    RO --> B["Read required current profile sections"]
    B --> C["Validate and normalize profile.json"]
    C --> D["Compare current state with desired state"]
    D --> E["Build ProfilePlan steps"]

    E --> E1["Remove unchanged fields"]
    E --> E2["Skip unsupported or ambiguous entries"]
    E --> E3["Resolve Open to Work titles and locations"]
    E --> E4["Split new Skills into batches of at most 10"]

    E1 --> F["Order all applicable steps"]
    E2 --> F
    E3 --> F
    E4 --> F

    F --> G["Create short-lived plan ID and plan hash"]
    G --> H["Show exact before/after preview, warnings, and skips"]
    H --> RODONE["Complete read_only job"]
    RODONE --> I{"Administrator confirms this plan?"}
    I -->|"No"| Z["Finish without mutations"]
    I -->|"Yes"| J["Create mutation job and verify plan binding"]

    J --> K{"Mutation active for this accountId?"}
    K -->|"Yes"| K1["Wait; do not block other accounts"]
    K -->|"No"| L["Create one in-memory job from the immutable plan"]

    L --> M["Take next queued step"]
    M --> N{"Cancellation requested?"}
    N -->|"Yes"| N1["Cancel between requests and produce report"]
    N -->|"No"| O["Select a fresh server-side random delay"]
    O --> P["Send exactly one Unipile mutation"]
    P --> Y{"Mutation response"}
    Y -->|"Normal response"| Q["Wait before verification"]
    Q --> R["Read the affected profile section again"]
    R --> S{"Read-back matches expected state?"}

    S -->|"Yes"| T["Mark step verified"]
    T --> U{"More steps?"}
    U -->|"Yes"| M
    U -->|"No"| V["Complete with redacted success report"]

    S -->|"No"| W["Stop the whole job"]
    W --> X["Report the first failed or unverified step"]

    Y -->|"API 429"| Y1["Honor Retry-After plus a random cushion"]
    Y1 --> R
    Y -->|"Provider 429"| W
    Y -->|"Uncertain create"| R
```

## Queue item

Every `ProfilePlan.steps[]` item contains:

```text
PlanStep
|- id
|- section: headline | about | experience | education | skills | open_to_work
|- action: update | create | add
|- summary
|- before
|- after
|- raw server payload
`- verification rule
```

This internal object never leaves the backend. The browser receives a
`PreviewStep` containing only `id`, `section`, `action`, `summary`, `before`,
and `after`.

The browser receives the preview, never an authority to replace the stored
payload. Starting a job references the short-lived server plan; the backend
verifies its hash, expiry, target `account_id`, and confirmed identity.

## Execution order

1. Headline.
2. About.
3. Existing Experience edits.
4. Existing Education edits.
5. Skills batches.
6. New Experience records.
7. New Education records.
8. Open to Work.

## Timing and stopping rules

- All steps and read-backs are serialized; no parallel LinkedIn mutations.
- Mutation serialization is per `accountId`, not global across all profiles.
- A `read_only` job for an account waits while that account has an active
  mutation; independent accounts may proceed under the configured global limit.
- Every wait is selected independently on the backend with
  `crypto.randomInt(min, max + 1)`.
- Closing the browser does not cancel the backend job.
- Cancellation is checked between requests, never in the middle of a write.
- Stop after the first failed or unverified mutation.
- Do not automatically repeat an uncertain create; read back first.
- `api/too_many_requests` follows `Retry-After`, observes `x-ratelimit-*`, and
  adds a fresh 5–20 second safety cushion. Without a usable `Retry-After`, the
  job stops instead of guessing a retry time.
- `provider/too_many_requests` stops for manual review because a reliable retry
  time is unavailable.
