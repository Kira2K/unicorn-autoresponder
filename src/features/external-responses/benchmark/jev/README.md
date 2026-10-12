# Isolated Jev compatibility experiment

**Deferred (2026-10-02):** further integration and live testing are TODO at the operator's request. Use the existing Sol workflow with `gpt-6-sol`. Keep this prototype and its evidence for a future explicitly approved comparison; no production command selects it. See [remaining work](../../IMPLEMENTATION_TODO.md#deferred-jev-integration).

Status: local adapter compatibility gate PASSED after repair (2026-10-01); loopback
origins only. Not a production engine or a working model-driven Jev benchmark. The
original popup/redirect/cleanup regressions and expanded negative scenarios pass.
No activation or SQL changes. Preserve the initial failure evidence in
logs/external-responses/jev-pilot-20261001; repaired evidence is in
logs/external-responses/jev-repair-20261001. All redirect fixtures now use loopback
destinations. Never use a real forbidden website as a test destination.

`browser-adapter.ts` takes a caller-owned Patchright Page, a hash-verified upstream
Jev DOM snapshot, explicit allowed origins/controls, cancellation and action limits.
It returns observe/fresh/act/close. Actions refer only to a current issued snapshot.
Unknown/stale/consumed/tampered/cross-tab observations fail. Stored observation copies
are authoritative, not caller-supplied action fields. Uncertain actions latch the entire
adapter; even a fresh observation cannot authorize blind retries. Concurrent actions
are rejected. Concurrent close callers await the same cleanup promise.
The host supplies the allowed selectors, not the model. This restriction is suitable
for compatibility fixtures; automatic investigation must still implement a reviewed
host control-admission policy before it can navigate unfamiliar websites.

Only the provided tab is closed. The parent owns Dolphin/profile locking and context
lifecycle. `network-guard.ts` owns request admission and a response-stage Fetch session
on the owned tab. Redirect Location headers are checked before Chromium follows them,
including redirect chains and XHR redirects. Approved redirects retain their real final
URL; requests remain in Chromium rather than being reissued by a Node HTTP client.
Popup/unattributed requests fail closed; known unrelated pages fall through to existing
routes. Writes and attachment downloads are blocked. The pilot blocks POST listing APIs
too; supporting them requires host-reviewed exceptions. Cleanup removes only this guard.
No viewport/focus emulation or second browser connection is installed. The additional
protocol session handles Fetch responses, not JavaScript execution; normal actions and
DOM observations still use Patchright. No claim of unchanged anti-bot behavior is made.

Boundary: local fixtures use serviceWorkers: block. Service-worker/WebSocket/custom
protocol traffic, arbitrary hostile pages, and actual Dolphin sessions are NOT validated.
Unknown-frame requests in a shared context fail closed and may affect a concurrently
created unrelated tab; use an exclusive isolated context for future benchmark tests.
Production/profile activation remains disabled until those boundaries are addressed.

The MIT-licensed upstream snapshot is pinned in vendor/provenance.json. Its text is
a navigation excerpt, not a complete job description. Keep the existing full-body
extractor and completeness checks. Frames/shadow roots remain upstream limitations.

Run: `node --experimental-strip-types --test src/features/external-responses/benchmark/jev/browser-adapter.test.ts`

These tests use a loopback HTTP fixture and actual Patchright Chromium with scripted
choices. No model, company, SQL or student profile is accessed. Fourteen scenarios verify
typing, selection, dynamic listings, pagination, unchanged viewport, stale/forged/duplicate
or modified actions, write/popup/redirect restrictions, allowed redirects, redirect chains,
XHR, concurrency, invalid input, overlays, cancellation during pacing, idempotent cleanup,
unrelated tabs/routes, pre-aborted sessions, configuration and uncertain logging outcomes.
The test runner also counts the enclosing test (15 passing entries). Existing browser,
collection and mocked Dolphin ownership suites are run separately as regression checks.

Remaining live prerequisites: TypeSafe/text-provider credentials, approved API policy
and dollar/call budget, persistent Python policy-worker bridge (without Browser Harness),
host admission for newly discovered controls, shared quota cancellation, frozen four-source
A/B manifest and independent coverage verification. Codex's percentage budget does not
bound TypeSafe spending. Do not describe these prerequisites as implemented.

Compare current versus Jev investigations with identical source/rule/browser state and
separate caches; then replay validated recipes without model navigation. Retain failed
attempts, coverage gaps, requests, actual API cost (unknown if unavailable), and separate
development/runtime effort. Neither DONE nor fixture success establishes live coverage.
