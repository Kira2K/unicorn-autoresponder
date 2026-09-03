---
name: linkedin-dev
description: Develop, diagnose, test, review, or explain the LinkedIn automation direction in the Unicorn unicorn-autoresponder repository and its related worktrees. Use for LinkedIn account connection, profile filling, connection invitations, comment monitoring, LinkedIn Web Console, Unipile adapters, or directly linked Noco schemas. Do not use for general LinkedIn advice or unrelated projects and features.
metadata:
  short-description: LinkedIn development context for Unicorn
---

# LinkedIn Dev

## Purpose

- In the first user-facing commentary update after this skill is selected, explicitly state that you are using `$linkedin-dev`.
- Use this skill as a stable context anchor for LinkedIn development in Unicorn.
- Let the current repository state override any historical assumption in this skill.
- Read only as much context as the request needs; do not turn a simple explanation into a full repository audit.

## Scope

- The primary checkout is normally `D:\Unicorn\unicorn-autoresponder`; `D:\Unicorn` itself is only a parent directory.
- LinkedIn domain code belongs under `src/features/linkedin-automation`.
- Provider-facing LinkedIn API code belongs under `src/integrations/unipile`.
- Include directly related Web Console and Noco schema code only when the requested LinkedIn behavior crosses those boundaries.
- Do not inspect, run, test, edit, or refactor unrelated product areas as part of a LinkedIn task.
- If a required shared change could affect unrelated behavior, stop before editing it and explain the dependency to the user.

## Refresh Current Context

For implementation, diagnosis, or review:

1. Resolve the actual Git checkout or worktree before running repository commands.
2. Inspect the current branch, HEAD, remote, worktree status, relevant diff, and untracked files.
3. Preserve all existing user changes. Never reset, discard, overwrite, or silently include them.
4. Read the current architecture and source for the affected LinkedIn component.
5. Read the current `package.json` before selecting commands or tests.

Never treat a remembered branch, commit, PR, dirty-file list, package script, service status, limit, or previous run result as current without checking it.

## Sources Of Truth

Use the narrowest relevant sources, usually in this order:

- `docs/ARCHITECTURE.md` for repository boundaries;
- `src/features/linkedin-automation/ARCHITECTURE.md` for the LinkedIn system map;
- the affected component's architecture, source, and tests;
- `src/integrations/unipile/ARCHITECTURE.md` for provider boundaries;
- the current `package.json` for runnable checks;
- the actual Git diff for the change under review.

For Unipile contract work, verify the current `Unipile API` V2 specification and do not use the older duplicate `Unipile API (1)` as authority.

## Engineering Context

- Use the project-local runtime under `D:\Unicorn\tools\node-v24.20.0-win-x64` without replacing the system Node installation or changing global PATH.
- Keep business behavior in the LinkedIn feature, provider request details in the Unipile integration, and browser UI behind backend-owned operations.
- Treat NocoDB as the live source for LinkedIn cards and bindings; Google Sheets data is legacy or advisory unless the current task explicitly establishes otherwise.
- Serialize mutations for one LinkedIn account through the existing operation boundary.
- After an external mutation, require read-back where the current contract supports it. Treat a lost or ambiguous result as `uncertain`, not as permission for a blind retry.
- Never print or retain `.env` values, cookies, API keys, proxy credentials, exact user agents, or unnecessary full provider responses.

## Adapt To The Request

- For an explanation, answer from the relevant current code and documentation without changing files.
- For diagnosis, establish the cause and evidence; do not implement a fix unless the request includes fixing it.
- For development, implement the requested local change, add focused regression coverage when useful, and verify it proportionally.
- For review, inspect the diff, contracts, tests, architecture boundaries, regressions, and unsupported claims without mutating the checkout.
- Select targeted checks from the current `package.json`; add typecheck, build, or wider LinkedIn checks when shared boundaries change.
- Update architecture documentation only when the implemented contract or behavior changes.

## Authorization And Evidence

- Local code edits, tests, builds, and read-only diagnostics are within an explicit development request.
- Obtain separate explicit authorization immediately before any LinkedIn write, live writer run, Noco apply/write, Dolphin state change, live deployment action, commit, push, or pull-request mutation.
- Before starting a live-connected local process, verify that no competing deployment is operating on the same accounts.
- Passing tests or configuration checks prove only what they directly exercised. Do not present them as live LinkedIn proof.

Finish in the user's language with short, separate statements for:

- done;
- locally verified;
- live or runtime behavior not verified;
- remaining manual actions or permissions.

Keep this skill compact. Add a new permanent rule only after a repeated real failure that current repository inspection would not prevent.
