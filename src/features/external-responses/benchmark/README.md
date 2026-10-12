# Guarded collection benchmark

## Sol browser and classification validation (2026-10-02)

Treat these as separate experiments. Browser investigation uses Sol high to interpret focused source evidence and propose a recipe/engine repair; existing host readers and Patchright execute collection. Classification uses Sol medium with a tool-free JSON contract. Static readers/prechecks/replay are not model work, and fixture success is not a live Sol quality result. Jev is deferred.

Model gate resolved by the operator on 2026-10-02: use available `gpt-6-sol`, high for browser investigation/engine repair and medium for classification. The earlier requested `gpt-6.1-sol` was absent from the authenticated catalog. Runtime still checks exact model/effort availability before dispatch. Preserve the original campaign budget/window and historical model-bound artifacts; the model change grants no fresh budget. The continuation plan and frozen five-company scope are in `logs/external-responses/sol61-role-validation-20261002/continuation-plan.md` and `continuation-scope.json`.

Next live sequence:

1. Freeze two captured source-investigation cases (hidden dynamic listing and pagination/embedded board), expected complete listings, allowed controls and forbidden routes. Run one fresh Sol-high investigation at a time through the existing reasoner/inspection contract. Execute proposals through Patchright and framework validation, then replay without Sol; require equal listing identities/full descriptions and zero application/registration navigation. Keep repaired and failed attempts in the comparison.
2. Freeze the existing six-description classification corpus with reviewed global/per-stack reference decisions. Run one bounded Sol-medium batch through the constrained transport. Require exact batch identities, complete descriptions, valid evidence and agreement with the reference; report uncertain cases separately. Deterministic title/date/salary/geography checks stay ahead of this batch. Mock reference tests alone do not supply a live accuracy score.
3. If both pass, freeze a small official-source manifest before the next public-source transfer run. Measure extraction completeness separately from classification completion. Do not replace failed companies, use student profiles, apply or promote benchmark results into SQL implicitly.

Keep one action at a time, existing packet limits and zero automatic generation retries. Record input/cached/output tokens when returned, reader calls, pages, repairs and total account-wide weekly change. No API-key fallback. For the current six-point campaign the recorded baseline is 90%, admission stop 95%, hard stop 96%; implementation, failures and reporting share that allowance. This is an observed stop, not a guarantee against delayed quota accounting. Do not spend the remaining allowance merely because it exists.

Evidence: `logs/external-responses/sol61-role-validation-20261002/`. Its model catalog, fixture results and local report are separate from historical Jev evidence.

`benchmark-batch --campaign DIR --batch 1..6 --execute [--resume] [--replay]`
uses a frozen 30-company manifest in groups of five. Every group gets a durable
one-point weekly-quota allowance inside the shared five-point campaign budget.
Classification and recipe replay share that group's allowance; resume never
rebases either ledger. A Markdown/JSON analysis is saved after each group.
The special `bounded_batch_skip_unresolved` policy preserves partial findings and
moves on without replacement companies or the historical three-failure stop.
Initial scans use at most 40 reader calls / 180 seconds per source, inside the
existing absolute 200-call / 900-second caps. No paid calls or applications occur.

The current whole-percentage quota meter cannot verify a 0.5-point company repair
cap. This mode therefore dispatches **zero AI repair calls** and records
`company_repair_skipped_quota_precision_insufficient_0_5_points` for unresolved
sources. It does not claim a half-point stop was measured. Existing deterministic
recipe repair remains bounded. `--replay` fetches fresh pages with initial-run
validated recipes; it does not use weekly search snapshots. Exact compatible
decisions from the initial reviewed run may be reused, retaining their provenance.
Selection results remain isolated until explicitly validated and persisted via
the independent classification/SQL stages. Overall quota observations are
account-wide and delayed; buffers reduce, but cannot guarantee absence of overshoot.

`benchmark-review --directory RUN_DIRECTORY` writes complete, bounded review
packets and a focused Sol task.
The shared title/date/description precheck runs before packet creation. Automatic
decisions stay in `automatic.json`, never labelled as Sol assessments; only unresolved
postings enter packets. `--review-name NAME` preserves older review artifacts when
preparing a new rules snapshot. Do not overwrite an immutable SQL classification.
This is the historical tool-enabled review path; it is not the new constrained classifier and must not be reported as its token benchmark. Run the task with the existing `sol-task-cli`
using the **batch campaign directory**, medium effort and assessment packet kind;
its generation shares the same batch allowance. Then use `benchmark-review
--directory RUN_DIRECTORY --consume` to verify every identity/evidence reference
and save `reviewed-classified.json` with session provenance. Missing packet outputs
fail explicitly; they are never replaced with guessed exclusions. No SQL write is
implicit in the benchmark. Validated results use the existing collection and
classification persistence adapters when promotion is explicitly authorized:
add `--consume --save-sql` to persist and verify the accepted rows and run audit.

`guarded-benchmark --mode cold|transfer --campaign DIR --run ID [--resume]` is the non-crawling preflight. Add `--execute` for the guarded browser run. A first or second failed company pauses before the next company; resume it once with `--execute --resume --diagnose-company ID`. The third consecutive failed company hard-stops the whole benchmark before another company or repair.

Cold mode requires all companies 140–159 and stacks 2,5,7. It starts with empty memories and ignores observations, decisions, recipes, generated bindings, learned hints and HTTP validators while retaining built-in ATS readers. Transfer mode reads the exact six unseen companies 172,225,196,203,167,173 from `transfer-scope.json`; the recorded family is only a hypothesis until this independent run. It may receive explicitly tested engine bindings, but no result cache. Without a binding, reuse is reported unavailable rather than invented.

Execution uses the existing global collection lock, one company/source at a time, an isolated browser profile, and benchmark-local observations, evidence, semantic cache, accepted-only output and reports. It performs no applications, paid API calls, hidden model calls or SQL writes. Sol assessments and repair proposals are separate explicit session artifacts; missing assessment remains pending.

The checkpoint monotonically accumulates 200 reader calls, 900000 active milliseconds and two engine candidates per source across repair/resume. Browser asset requests are not reader calls. The company gate evaluates one company after all normal and unsupported source outcomes: partial or repaired coverage is a failure, verified empty complete boards are clean, failures one and two require one bounded diagnosis, and failure three latches a hard stop. Quota pause/stop outranks diagnosis and produces the same deterministic local report with interrupted work left non-complete.

An explicit follow-up may instead declare `failurePolicy: continue_until_success_target_or_budget` with `stopAfterSuccessfulCompanies`. In that branch failed companies are durably reported and collection continues in frozen order without diagnosis or the legacy three-failure stop. A success requires at least one supported source and complete terminal coverage for every supported source; verified empty and successfully repaired complete boards qualify, while partial, unattempted, or unsupported-only companies do not. Ancillary forbidden channels remain reported but do not invalidate complete official coverage. The checkpoint persists the successful-company count and terminal stop reason, and reaching the target stops before any later company read, including after resume. Quota decisions retain precedence.
