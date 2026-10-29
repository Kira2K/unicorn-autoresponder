# HH text captcha supervision

The normal orchestrator and its concurrency queue remain the entry point. No
second autoresponder, profile cleaner or scheduling mechanism is introduced.

`browser-runtime.js` holds the current browser operation while a visible text
captcha is present. The vacancy watchdog does not navigate away from the
challenge. Captcha time is excluded from form/confirmation timeouts; waiting
is bounded to 120 seconds, then the existing `captcha_detected` outcome ends
only that client. STOP cancels waiting. The normal response quota still applies.

`solve.ts` takes capture, image-storage, recognition, input and submission
adapters. It saves each image before recognition, checks its SHA-256 identity
again before input and submission, and bounds repeated challenges by attempts
and time. An uncertain adapter/submit failure is returned without retrying the
business action. `playwright-adapter.ts` supplies the HH DOM operations through
the profile's CDP connection. Its English selection comes from branch
`hh-captha-solver`, commit `61ee360f873009b907dc9e41ab72adb612dcbd69`;
Russian modal text is not treated as proof that the image stayed Russian.

Recognition is a required injected dependency, with no browser access. There
is no default OCR provider, API key or paid service. The production browser
waits for an operator/adapter to resolve the challenge; this PR does not claim
unattended recognition has been validated. Save images locally and review the
recognizer's output before wiring it into a live supervisor.

Related protections requested for the same run:

- Preserve confirmed vacancy IDs from existing HH tabs into the existing
  `hh_ar_v2_processed_ids` local-storage key before opening a new scenario.
  Session-only skips, including a real visibility rejection, remain retryable.
  Other origins and tabs are never inspected. Existing history/manual lists
  are not cleared automatically.
- A collapsed HH `hidden-resume-warning` with height 0 does not block an
  application. Only an actually visible warning is acted upon. Resume privacy
  is not changed by the responder.
- The existing idle deadline also bounds time without any growth in confirmed
  responses, even when URLs and parser logs keep changing.
- HH reports use the existing typed Telegram Bot API facade. API rejections and
  uncertain outcomes are failures, not successful deliveries or resend triggers.

## Validation

Run the feature tests and the shared Telegram integration tests, then typecheck.
Unit regressions cover repeated/stale challenges, timeout/cancellation, confirmed
history across tabs, visibility skips, and report errors. Live confirmation of
the visibility predicate used the collapsed HH warning and an enabled submit
button, with the original privacy restored and without sending another application.

The requested remaining-profile cycle has not run: the configured Dolphin cloud
token returns HTTP 401, so the normal automation tag/status locks are unavailable.
The preflight must pass before a live concurrency-3 cycle or end-to-end captcha
claim. Local start/stop availability alone does not satisfy that preflight.
