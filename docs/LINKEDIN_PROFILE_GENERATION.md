# LinkedIn Profile Generation

The local Admin Console can build a Profile Filler preview from the newest
confirmed English CV. Apply remains a separate manual action.

An administrator may instead upload the final EN CV directly as PDF or DOCX
(maximum 20 MB). This bypasses only Noco/Drive CV selection; authorization,
proxy-country checks, generation, validation, Preview, and manual Apply are unchanged.

## Flow

1. Read the newest `CV processing` row for the LinkedIn account's client.
2. Accept only `moved to filling` or `filled` with a non-empty `en_version_url`.
3. Export a Google Doc to PDF or download a PDF through the Drive service account.
4. Resolve the Dolphin proxy IP to a non-Russian country without persisting the IP.
5. Extract CV facts with an OpenAI strict Structured Output response and assign stable
   `exp_N` and `edu_N` IDs on the backend.
6. Generate only descriptions and attached Skills for every fact ID, plus Headline, About,
   Open to Work, and exactly 100 unique profile Skills.
7. Resolve generated Open to Work roles and optional catalog-backed identity values. Terra chooses
   distinct semantic matches only from supplied LinkedIn candidates.
8. Require every expected fact ID, then run deterministic guide, fact, schema, identity,
   and Unipile input validation.
9. Automatically build and persist Preview. An administrator reviews and applies it manually.

## Fixed contract

The guide registry is `generation/guide-rules.ts`. Its URL and revision are
updated manually together with tests. The generated sections are `headline`,
`about`, `skills`, `experience`, `education`, and `open_to_work`. Unsupported
guide sections and `experience.employment_type` are forbidden.

OpenAI receives `store: false`, no tools, and strict JSON schemas for every
request. The optional role-selection request receives only generated role names and bounded
LinkedIn catalog candidates. It cannot supply an ID outside that candidate list. A role without
a confident match is omitted. Preview uses one to five verified unique roles; when none can be
verified, the Open to Work step is skipped and Preview shows a warning. The PDF or DOCX is
uploaded as a transient OpenAI input file and deleted in
`finally`; the second request receives extracted facts, not the CV file. The
  deterministic validator blocks invented employers, roles, dates, education,
  metrics, or contacts. Company, role, dates, location, workplace type, school, degree,
  field of study, grade, and activities are copied from CV facts by the backend. Up to two
  bounded repair requests receive only missing or invalid fact IDs. Remaining fatal issues
  block Preview.

The payload validator mirrors the Unipile v2 MCP schema. Experience and Education creates require
their identity fields and `start_date`; edits require only `operation` and `id`. Edit payloads
  contain changed fields only. Existing Skills are retained. The backend normalizes names and adds
  only the number required to reach exactly 100; Unipile accepts Skills by name, so no Skill catalog
  lookup is performed. Generated Experience/Education Skills must occur in that same set.

Apply order is: headline, About, Experience updates/creates, Education updates/creates,
profile-level Skills, then Open to Work. Each write is followed by a fresh read-only check.
If a change is not visible, only read-back is retried after 5, 15, 30, and 60 minutes.
The backend resumes this schedule after restart without repeating PATCH. A job succeeds only
after full verification; otherwise it ends in `needs_expert_review` with exact sections.
If new Skills do not fit the shared 100-Skill limit, other fields remain applicable;
omitted names are retained as warnings and the final phase is `partially_completed`.
Dates preserve CV precision; missing mandatory months block creation rather than being invented.
Fact IDs prove enrichment coverage, not first-pass extraction accuracy: compare the source CV
with extracted records separately before live Apply.

Required catalog calls are serialized with a five-second minimum interval. A provider `Retry-After` is
never shortened or negatively jittered. Successful catalog results are saved in the job checkpoint,
so retry or backend restart continues without repeating resolved searches. Exhausted retries leave
the job in `waiting_retry`; Resume does not extract the CV or generate the profile again.

## Configuration

- `OPENAI_LINKEDIN_PROFILE_API_KEY` is required; generic and legacy keys are not used.
- `OPENAI_LINKEDIN_PROFILE_MODEL` is required.
- `GOOGLE_APPLICATION_CREDENTIALS` points to a Drive-readable service account JSON.
- OpenAI timeouts/output limits and Drive/geo limits are listed in `.env.example`.

## Logging

Each job writes JSONL events to `logs/linkedin-profile/<job-id>-<pid>.jsonl`.
Events cover runtime setup, CV selection/download/upload, proxy-country lookup,
both OpenAI responses, fact and profile validation, temporary-file cleanup,
stage persistence, and Preview. Completed and failed actions include duration;
OpenAI failures may include only safe HTTP status, request ID, error category,
schema field path, and token usage totals.

Do not log or persist the CV, prompts, model response, Drive URL, contacts,
proxy IP, credentials, or API keys. `linkedin_profile_jobs.plan_json` stores
only the resulting Preview and safe generation metadata. While waiting for a provider retry,
`checkpoint_json` contains only the validated normalized profile, validation issues, generation
metadata, safe non-Skill catalog `{id, name}` results, and retry timing. It never contains CV bytes,
extracted facts, prompts, or secrets.
For a manual upload, the CV revision is a SHA-256 hash; the original filename
and file bytes are not persisted.

Automated tests use mocks only. A live generation requires separate permission
for a named student; live Apply requires another explicit manual confirmation.
