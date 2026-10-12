# Manual approval of token-use rules

The user explicitly requires manual verification and approval of every token-related rule before activation/change. This concerns LLM/API usage and cost behavior, not ATS board IDs or authentication tokens.

Present one concrete versioned policy covering:

- AI-enabled stages, including extraction, classification, local rule evaluation, answering and tailoring.
- Providers/models, prompts and any fallback/escalation.
- Input/output limits, excerpt selection, truncation, summaries and chunking.
- Call budgets, retries, ambiguous-result recovery and stop conditions.
- Cache keys/reuse/invalidation, batching, concurrency and delegated workers.
- Overall usage/cost limits and handling of unknown upstream usage.

Do not invent approved defaults or treat general authorization to apply as approval of unspecified token rules. Record the policy version/hash, approving user, time and confirmation reference. Explicit approval remains valid for the identical reviewed version; do not ask again for each vacancy.

An unchanged approved policy with remaining allowance continues across fixes, batches and turns within its authorized scope. An intermediate report or a stopped monitor is not budget exhaustion: refresh or restart the existing guard, preserving its original baseline and limits. Missing/stale readings and actual budget thresholds still stop dependent work; never reset the budget or introduce unapproved paid calls.

If approval is missing, ask for review of the concrete policy and continue deterministic/SQL/report work that does not depend on it. Do not start the affected API calls or delegated work. Material changes, including truncation or a supposedly cheaper model, require renewed approval.

Use observed token usage where the provider returns it. For an opaque tailoring endpoint, disclose unknown token usage and enforce only the request/call limits actually supported. Never claim a downstream token ceiling or zero usage without evidence.

The workflow order is: checkpoint discovered text → evaluate shared rules/stacks → persist accepted full descriptions in the canonical SQL catalog → reuse that text for student decisions and tailoring jobRequirements. Rejected/review-only discoveries remain audit data, not vacancy rows. Storing full text does not imply permission to send unbounded prompts; token policy governs inference inputs, and must not silently remove material requirements.

No policy values or API spending are approved by this reference itself.

## Guarded Codex benchmark implementation

An explicitly approved campaign stores its original weekly window, baseline, thresholds and execution policy in campaign files. The independent App Server watchdog polls every five seconds, stops new AI admission at its buffer threshold and cancels owned work at the hard threshold. Missing/stale/invalid readings pause; resume never rebases. Root/coordinator, worker, failed and repair work all share the account-wide allowance. Token totals are separate measured diagnostics, never a conversion to weekly quota. Delayed provider accounting can overshoot; report it.

The current approved experiment uses one fresh-context Sol worker, medium assessment/high investigation, full assessment packets of 64/128 KiB and investigation packets of 32/64 KiB (one expansion). Baseline investigation packets may reach 128 KiB. These are evidence-packet limits, not total Codex context limits. No automatic model fallback or separate paid API. Keep unknown diagnostics unknown; omitted evidence must not become an empty-result claim. This paragraph records the current explicitly approved experiment, not permission for a future campaign.
