# Highest Priority TODO

This file is the first queue for work that should be visible before ordinary
feature TODOs. Keep only the current highest-priority items here. Link out to
deeper TODOs, playbooks, or source files instead of copying large plans.

## Related TODOs And Context

- [Telegram Resume Bot Performance TODO](./TG-RESUME-BOT-PERFORMANCE-TODO.md)
- [Dolphin profile normalization TODO](./src/integrations/dolphin/profileAssigner/normalizeProfiles/TODO.md)
- [Existing-profile proxy repair/adoption TODO](./src/integrations/dolphin/proxyProvider/provideProxy/TODO.md)
- [Real E2E proxy deleting TODO](./src/integrations/dolphin/proxyProvider/real-e2e-proxy-deleting/TODO.md)
- [HH autoresponses playbook](./docs/hh-autoresponses-skill-playbook.md)
- [Agent context](./docs/AGENT_CONTEXT.md)
- [Full AI context](./docs/AI_CONTEXT_FULL.md)

## P0: Add Captcha Solver To HH

Existing issue context:
[HH autoresponses playbook captcha handling](./docs/hh-autoresponses-skill-playbook.md)
and [orchestrator expected failure semantics](./src/features/hh-responses/orchestrator/README.md).

Current baseline:

- HH response automation can already identify captcha as a typed state.
- Captcha currently stops the affected client/profile and requires human
  action.

Required work:

1. Teach the HH response script to switch from RU captcha to EN captcha before
   solving when HH presents the Russian variant.
2. Add reusable token-based service infrastructure and architecture. This does
   not exist as an enabled path today, and it must not be captcha-only because
   future tasks will also need shared token accounting, limits, secrets,
   provider adapters, and validation flows.
3. Submit the solved captcha through the active HH browser/profile session.
4. Validate that captcha was accepted before continuing.
5. Resume the normal HH responses process after successful validation.
6. Preserve typed failure behavior when captcha solving fails, token balance is
   unavailable, HH changes the captcha UI, or validation cannot prove success.

Implementation notes:

- Start in `src/features/hh-responses/hh-auth` for detection and validation.
- Continue through `src/features/hh-responses/orchestrator` so captcha solving
  integrates with per-client run state instead of blocking the whole run.
- Design token usage as a reusable internal capability: provider adapters,
  token balance checks, reservation/consume semantics, retry policy, typed
  errors, redacted logging, and per-feature integration points should be
  separable from HH captcha specifics.
- The first implementation may be driven by HH captcha, but the architecture
  should also fit future paid/tokenized tasks without duplicating token
  management in each feature.
- Keep secrets and captcha-service tokens out of logs, reports, and committed
  files.

## P0: Harness For AI-Driven Development

Goal: create a reusable development harness for safe AI-assisted coding across
the repo, inspired by Karpathy-style practical AI workflow principles but
adapted for Codex and this project.

Required work:

1. Define principles and guardrails that let both professional and junior
   developers vibe-code safely.
2. Make the harness reusable across domains. It must not be task-specific; it
   should fit work such as Dolphin proxy management and bot quiz development.
3. Define required context packets: docs to read, files to inspect, tests to
   run, safety checks to perform, and handoff notes to leave.
4. Decide how work areas should be managed:
   - harness only;
   - dedicated agents;
   - harness plus task-specific agents;
   - no agents for sensitive/live-production areas.
5. Capture the questions that must be answered before introducing agents, such
   as ownership, allowed actions, approval boundaries, logging, test gates, and
   rollback expectations.
6. Link the harness from [Agent context](./docs/AGENT_CONTEXT.md) and
   [Full AI context](./docs/AI_CONTEXT_FULL.md) once the first version exists.

Open design question:

- Which task areas should be managed by the harness alone, and which should get
  dedicated agents or agent-assisted workflows?
