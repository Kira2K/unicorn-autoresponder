# Resume applications without rediscovery

Use this procedure for each authorized student/batch. SQL checkpoints are authoritative; chat history is not. No new application or tailoring allowance is created by resuming.

Follow [Continue the authorized task](../../../../.agents/skills/job-hunting/SKILL.md#continue-the-authorized-task): after necessary repairs and focused checks, resume the same authorized batch. A target-specific handoff does not stop other eligible targets. Intermediate reports and stage boundaries require no renewed approval; explicit search-only/dry-run scope, immutable targets and usage limits remain binding.

## Start with one small state read

Publication age comes before semantic review, tailoring or browser preparation. `application-status` and `classify --refresh-saved` read current SQL source snapshot/last-attempt pointers, including date-precheck audit rows for postings omitted from accepted results. They match the exact source and canonical posting URL; never use collection/update time as publication time. `exclude_expired_posting` requires skipping the target; `review_publication_date` requires resolving conflicting/ambiguous evidence. Truly missing dates retain the existing allow rule. Live workflow preflight repeats this check before opening Dolphin. Unknown/submitting attempts still go to reconciliation, never a fresh Submit. An old saved row alone is not a current shortlist.

```powershell
npm run external:responses -- application-status --input path/to/workflow.json --worker-packet --position POSITION_ID
```

The worker packet returns one frozen target, current status/attempt, rule compatibility, missing-question count, engine/form signature and next action. It contains references instead of CVs, descriptions, field choices or historical evidence. Omit `--worker-packet` and keep `--position ID` to retrieve complete exact choices/artifact references only when needed. No content is truncated; the full state remains in SQL/files. These read-only modes do not open Dolphin, upload documents or call AI. Keep the existing input path, candidate/student IDs, collection run, batch ID and target order. Do not recreate a batch to escape a blocker.

## Fresh-context operating packet

Browser lifetime and worker context lifetime are separate. Keep the owned application process/tab open. When delegation is authorized, start a fresh Sol worker with no inherited conversation (`fork_turns="none"`), passing only the generated packet, current task/authorization, budget file and retained process handle. Do not continue an old development agent with a large history. This command does not launch workers or approve any token policy. Existing model settings, usage guards and authorization still apply.

In the retained process, `status` prints its compact last-known checkpoint with zero browser, SQL, AI or submission calls. It explicitly says `refreshed:false`; use the public SQL status command for current persisted state, and the normal live gates before writes. Do not issue `resume` merely to obtain a status update. The coordinator should not repeat a worker's completed inspections or perform routine second opinions. For a code failure, read the affected module/test, repair it, run focused checks and report once; do not turn each pointer action into a development task.

Read the budget report before work and after tests; stop at its pause threshold or a non-ready status. Add the exact saved PDF path/hash or a focused blocker/receipt only when the next action needs it. A detailed status read supplies exact unresolved options, so do not reopen the form merely to remember their wording. Fetch the saved description, original CV or full form evidence only for a specific unresolved decision. Do not shorten the description/CV sent to tailoring.

Follow the reported `next` action per target. A `tailor_once` target with a compatible prepared batch can use `run-application --input ... --live --resume`; the saved checkpoint prevents a preliminary dry preparation pass. If using independent stages, run only `tailor --input ... --live` before `apply --workflow ... --live --resume`. A submitted/unknown attempt goes to reconciliation, never a fresh click. Keep the exact existing input file and targets across handoffs; record new reviewed answers or test reviews there with their required scope and evidence. The CLI's compact JSON points to the full report when diagnosis is needed.

| Next action | Procedure |
|---|---|
| `none` | Already complete/skipped; no new submission. |
| `reconcile_existing_attempt` | Read the preserved tab/receipt first. `unknown`/`submitting` never authorize another click. |
| `revalidate_saved_description` | Use the saved SQL description and current rules; see below. |
| `prepare_changed_answers` | Inspect the live form; reuse compatible checkpoint fields; resolve only missing/changed values. |
| `tailor_once` | Use the original CV and this vacancy's saved description; reuse an existing bound result/intent. |
| `recover_tailoring_result` | A bound result URL or artifact is saved; rerun the same `tailor --input ... --live` to download/validate and persist it, without another POST. |
| `resolve_tailoring_failure` | The exact target's one tailoring request was consumed without a saved result. Inspect the sanitized failure/diagnostic and obtain an explicit recovery decision; do not regenerate. |
| `review_saved_pdf` | Complete the already-required campaign test review of that PDF; do not regenerate. |
| `apply_saved_artifact` | Resume the frozen batch with its exact artifact; normal live gates still run. |
| `apply_original_cv` | An explicit dated `cvMode: original` approval selects the saved original PDF. Resume the same batch; its path/hash are bound before upload and checked again before use. |
| `resolve_attachment_mode` | An earlier attempt or batch selection conflicts with the requested original PDF. Reconcile the existing attachment/outcome; do not switch it. |
| `resolve_blocker` | Read the record reason and focused report detail. Resolve the restriction, unsupported form or other gate before choosing another stage. |

Inspect only the relevant field, error or saved artifact. Do not repeatedly load full CVs, all historical runs, whole-page screenshots or the repository. Supply focused evidence to an authorized reasoning worker only when code and saved answers cannot resolve meaning. Application commands do not invoke a paid answer model by default. Respect the separately approved token policy; these checkpoints do not themselves enforce a weekly quota.

## Independent commands

```powershell
npm run external:responses -- prepare --workflow path/to/workflow.json --dry-run --resume
npm run external:responses -- tailor --input path/to/workflow.json --live
npm run external:responses -- apply --workflow path/to/workflow.json --live --resume
```

Use only the needed stage. `run-application --input ... --live --resume` composes them and skips redundant preparation for compatible saved batches. Before writes it still inspects current fields, rechecks eligibility and verifies saved values and the vacancy-specific attachment. Application commands print a short JSON status and unresolved options; use `--verbose` only for a focused diagnostic. Full `report.md`, `results.json`, `failures.json`, `robot-failures.json`, `applications.csv` and `events.jsonl` remain in the batch log directory. Busy Dolphin profiles are deferred; never take them over. Preserve LinkedIn blocking and the exact selected driver.

When the user explicitly approves sending the original PDF, add `"cvMode": "original"` and `"originalCvApproval": { "approvedAt": "<ISO date>", "approvalReference": "<exact instruction>" }` to the existing frozen workflow input. Then use `apply --workflow ... --live --resume` (or `run-application ... --live --resume`); this mode does not call tailoring or require its API key. The original bytes must match the saved candidate SHA-256. The failed tailoring journal remains intact and does not authorize another tailoring request. Do not choose original mode for an already attempted tailored submission or a test campaign that requires a tailored PDF review.

## What is remembered, and where

| Memory | Location / compatibility |
|---|---|
| Form controls and provider behavior | Versioned ATS engine code in `applications/`; fixtures prove each fix. |
| Verified company form schema | `noco.sources.collection_state.applicationForms`; source + company + application origin + engine version + complete field signature. Bounded to eight variants. No answers/CVs/credentials. Collection recipes remain separate. |
| Private answers and missing facts | `noco.application_batches.state.records[].preparation`; exact student/facts/original CV, vacancy description/URL, engine and per-field policy/signature. |
| Tailored PDF | Existing `preparedCv` artifact with original/result/description hashes and any required test review. |
| Submission outcome | Existing SQL batch/application state, receipts and diagnostic event/evidence files. |

Unchanged field checkpoints use zero generator calls. A changed question/option/scoped override regenerates only affected fields. Changed student facts, CV, vacancy or engine invalidates that context. Generators without an explicit field-local cache contract are not reused. Public form memory assists compatibility diagnostics; it never replaces inspecting and verifying the current form. New adapters must preserve the same contracts and add fixtures; do not store executable scripts in SQL or temporary per-company orchestration files.

## CAPTCHA and uncertain outcomes

1. Inspect the existing tab before refilling or clicking. A passive widget is not an active puzzle; a puzzle disappearing is not submission success.
2. If verification is completed, first look for an employer receipt. Capture it without another click.
3. The ATS adapter permits **one continuation click** only in the retained live tab after a previously observed challenge, a verified provider checkbox, no active puzzle, no navigation change and zero possible application writes since the first click. It rechecks fields, attachment, eligibility and durable intent before continuing the same attempt.
4. Any application request/network loss, lost tab/process evidence, repeated challenge or missing verification proof leaves a handoff/uncertain outcome. Never treat HTTP 200 as a receipt or automatically resubmit.
5. Record actual human help in input `humanAssistance[positionId] = { observedAt, reference }`. This annotates the existing attempt; it neither proves success nor authorizes a retry. Ordinary receipt inspection does not imply human assistance.

The implementation detects and safely continues verification; it is not a universal CAPTCHA solver. Use existing authorized verification assistance when needed. Do not claim an installed solver or third-party service unless one is actually configured and verified. Preserve the tab for the handoff. Do not extract or log CAPTCHA tokens.

While the same live `apply --workflow ... --live --resume` process is paused with its owned tab, use `verify inspect` to list visible hCaptcha frames. If an opaque enclave exposes no puzzle text, inspection saves an image of that exact visible frame and returns its local `visualObservation` path, pixel hash and time. This observation alone does not enable pointer actions or establish application success. `verify capture <frameIndex> <x> <y> <width> <height>` saves only a chosen rectangle within one active frame and returns a snapshot ID and local PNG path. For an opaque frame with a currently visible puzzle, use `verify capture-visual` with the same arguments, review the returned PNG, and issue `verify confirm <snapshotId> assistant|operator` with the actual reviewer only if the image clearly shows the live puzzle and intended pointer points. This records image review, not human completion or puzzle success. A visual snapshot refuses actions until explicitly confirmed. Coordinates here are relative to the iframe; the resulting `verify click <snapshotId> <x> <y>` or `verify drag <snapshotId> <fromX> <fromY> <toX> <toY>` coordinates are relative to that cropped rectangle. A snapshot expires in 60 seconds and permits one action. Any navigation, frame replacement/movement, changed pixels or out-of-bounds action fails closed; DOM snapshots additionally require accessible puzzle text. These commands never submit an application; use the ordinary `resume` path afterward to reconcile its receipt and existing continuation gate.

`verify solve <snapshotId>` is gated by workflow input `verification: { enabled: true, provider: "2captcha", positionId, approvedAt, approvalReference }` and `TWO_CAPTCHA_API_KEY`. The solver uses [2Captcha's DragAndDropTask](https://2captcha.com/api-docs/drag-and-drop) only when an injected extractor supplies actual provider-DOM background and movable-piece images at the snapshot's pixel scale. The shipped extractor reports unsupported for the opaque live enclave; it does not infer pieces from a full-page or arbitrary screenshot. Solver create intent is persisted once, so an uncertain provider response never triggers a blind second task.

## Current rules against saved descriptions

```powershell
npm run external:responses -- classify --refresh-saved --collection-run OLD --run NEW --db-stacks 2,3,5,7 --out logs/external-responses/scans/NEW/classified.json
```

Choose actual populated stack IDs. This writes a **new** run through the existing SQL pipeline, without recrawling or AI calls. Supported deterministic precheck changes are rerun; semantic decisions transfer only with proven compatible provenance, prose and stack policy. Changed prose/stack requirements or legacy unproven decisions remain explicitly pending. Review them through the existing bound `classify --assessments FILE` interface; never relabel old answers as a new review. Original observations/history remain intact. An attempted batch keeps its original immutable collection binding: reconciliation does not authorize rebinding or fresh submission.

## Verification and reporting

Local intercepted browser fixtures can explicitly use installed Chrome:

```powershell
$env:EXTERNAL_RESPONSES_TEST_DRIVER='patchright'
$env:EXTERNAL_RESPONSES_TEST_CHANNEL='chrome'
```

Core regressions: `answer-checkpoint`, `application-source-memory`, `application-status`, `refresh-saved`, `contracts`, `application-workflow`, `ats-continuation`, `ats-continuation-browser`, `captcha-browser`, `browser`, `postgres-pipeline`. No employer traffic or live profile is required.

Report captured successes, candidate-reported claims, blocked/uncertain outcomes and human assistance separately. Link the exact selected PDF and receipt. Diagnostics/screenshots alone are not confirmation. Reuse counters are measured locally; do not turn zero generator calls into an invented weekly-token saving percentage. Report exports omit private answer checkpoints; SQL retains them for resume.
