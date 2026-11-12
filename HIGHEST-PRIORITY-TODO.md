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

## P0: Validate HH supervised rollout on the VDS

The release provides the normal HH queue with isolated image-only Codex
recognition, English image selection, identity checks, bounded attempts,
provider preflight, accounting, cancellation and owned-profile cleanup.
Model default: `gpt-6.1-sol`. Installation and operation are documented in
[HH supervised deployment](./docs/hh-supervised-deployment.md) and the skill's
executable first-check resource.

Remaining rollout gates:

1. Confirm the actual Windows VDS user, database, Dolphin, bot destinations,
   pinned CLI authentication and first service check in its clean checkout.
2. Run one explicitly scoped real-HH CAPTCHA/application canary and verify
   acceptance, continuation, preserved history, delivery and cleanup.
3. Confirm schedule execution after RDP disconnect/restart and retire only the
   old HH task after successful cutover. Never run the same accounts on two hosts.

Synthetic model/browser fixtures and local unit tests are useful evidence but
must not be presented as real HH acceptance on another machine.

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
