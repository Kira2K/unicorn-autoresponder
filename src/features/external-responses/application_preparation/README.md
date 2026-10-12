# Application preparation

`prepareWithCheckpoint` in [checkpoint.ts](checkpoint.ts) returns grounded answers plus a versioned per-field checkpoint. It has no browser/SQL dependencies. An unchanged context and opted-in generator policy reuse exact answers/missing facts; a changed question or scoped override regenerates only that field. Student/facts/CV, vacancy, engine, options and policy changes invalidate reuse. Private checkpoints persist in the existing SQL batch; report exports exclude answer values. See the [resume runbook](../application_workflow/RUNBOOK.md).

Approved ordering: shared stack + market routing -> matching students -> personal restrictions/history -> intended targets/form checks -> reuse or generate CV. No generation for excluded pairs. The external tailoring API returns no tokens: count calls/results/reuse separately and report token usage unknown. See [MVP reuse](../MVP_REUSE_PLAN.md).

Efficiency TODO: [target-only preparation and scoped reuse](../EFFICIENCY_PLAN.md#local-restrictions-and-application-answers). Inspect eligible frozen targets before tailoring/essay calls; reuse original CV extraction, exact tailored artifacts and confirmed answers while verifying the actual form.

Implemented integration: [sequential application workflow](../application_workflow/README.md). `tailorCv` reuses the shared web-console transport with original CV bytes and complete saved SQL `jobRequirements`. An explicit approved policy and durable single-request intent are required. The result is a separate `PreparedCv` artifact, never an overwrite of the original. The older vacancy-reuse plan remains historical.

`createAnswerGenerator(client?)` returns an `AnswerGenerator` port. It consumes candidate facts, one vacancy and inspected form requirements; returns values with evidence plus missing required fields. `withPreparedAnswers(base,drafts)` adds reviewed field-key/label answers without altering candidate facts. No upload or submission occurs in these modules.

[index.ts](index.ts) is the stage's public re-export entry point. Current internal callers import the two implementation modules directly; retain this small entry point as part of the independently replaceable stage structure.

The base answer generator uses supplied facts and exact enumerated options; unresolved required facts become questions. Run-specific prepared answers are a separate override mechanism, described below. Optional demographics/marketing stay unanswered. AI transport is injected; without AI, deterministic confirmed answers still work.

Skill-operated form defaults are defined in [application-answer-policy.md](../../../../.agents/skills/job-hunting/references/application-answer-policy.md). The operator can supply those choices as run-specific `preparedAnswers` with explicit policy/assumption evidence; they never become confirmed student facts or alter eligibility. The base generator still uses facts only. Automatic policy loading/semantic default resolution, SQL/CV data hydration and a student-wide answer catalog remain deferred; per-batch answer checkpoints are implemented above. Changing the skill does not change the CLI prompt or deploy a new AI/token policy.

CLI `prepare` invokes the application lifecycle in dry-run mode: it inspects the actual form, prepares answers and saves a batch while enforcing the same collection and restriction gates. It cannot accept `--live`. `prepare-application` does this through the new Dolphin workflow. Independent `tailor --live` requires a prepared batch; `run-application` composes stages and never calls tailoring during dry run. Deep semantic/layout CV checks are test-only; normal validation is local PDF readability and artifact identity.

Tests: prepared-answer cases in `contracts.test.ts`; conditional field and saved-value fixtures in `browser.test.ts`. Related contracts: [applications](../applications/README.md).

Reviewed local PDF corrections use `revise-cv --input FILE --live` before any submission attempt. Input `cvRevisions[positionId]` supplies the separate corrected PDF path/hash, parent hash, reason and review evidence. The command checks readability and binding, saves under the candidate lock, preserves the previous artifact in `cvRevisions` history and reuses an already adopted revision on resume. It never regenerates, opens a browser or submits. Submitted/uncertain/previously attempted targets cannot change CV through this command. Deep review remains a test/operator action, not a new production approval requirement. Contract: `revise-cv.test.ts`.
