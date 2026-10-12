# Standalone single-candidate search

Use only when the user explicitly selects a local, non-campaign search. SQL-backed student campaigns follow `global-selection.md` and `student-position.md` instead. The single-candidate filters and file history below must not override shared SQL selection or the existing restriction loader. Follow the mode, LinkedIn prohibition, truthfulness and token-policy requirements in the parent skill. Paths such as `scripts/` and `templates/` below are relative to the job-hunting skill root.

For form answers, [application-answer-policy.md](application-answer-policy.md) takes precedence over the older generic honesty/gate advice below for its covered questions. Operator defaults remain separately auditable; do not record them as confirmed candidate facts or reinterpret them as search criteria.

## Workflow for standalone single-candidate searches

0. **If resuming** — read `applied-list.md` and `profile.md` first, then sweep application mail if access is authorized. The log is the
   only record of what has already been sent; a session that skips it re-applies to the same jobs. And
   replies have deadlines while postings don't — a scheduling link that expired while you swept 16,000
   boards is a worse outcome than ten applications not sent. See `references/after-submitting.md`.
1. **Intake** — fill `templates/profile.md`: what we're looking for, then who the candidate is.
2. **Source** — `scripts/sweep_boards.py`. Channels and measured yields in `references/sourcing.md`.
3. **Filter** — `scripts/filter_postings.py` on titles and locations, fetch bodies for the survivors,
   filter again. Then check the form itself for gates before filling it.
4. **Deliver for the chosen mode** — `search`: ranked links; `draft`: local drafts using `references/answering.md`;
   `apply`: submit using `references/ats-playbook.md`. Review every `manual-review` row before applying.
5. **Log** — every outcome, including rejections with reasons. Write the row as each one lands.

```sh
python3 scripts/sweep_boards.py --out rows.json
python3 scripts/filter_postings.py rows.json --profile profile.md --applied applied-list.md --out pass1.json
python3 -c "import json;print('\n'.join(r['url'] for r in json.load(open('pass1.json'))))" > links.txt
python3 scripts/fetch_postings.py links.txt --out bodies.json
python3 scripts/filter_postings.py rows.json --profile profile.md --applied applied-list.md \
        --bodies bodies.json --out shortlist.json --rejects rejects.json
```

Create `applied-list.md` with the Logging table header before using `--applied`, or omit that flag
on a first search with no application history. A partial sweep is incomplete coverage; retry failed
boards before concluding there are no more roles. A fully failed ATS exits without replacing the output.

## Step 1: Intake

Copy `templates/profile.md` into the working directory and fill it. Search needs the criteria half;
collect personal details only for drafting or applying. Both halves are needed before applying.

### Half one — what we're looking for

Ask this **first**. Every hour of sourcing against the wrong criteria is wasted, and these constraints are discovered painfully if you don't ask: in one run "remote only", "no US-timezone overlap", "not DevOps", "no client-facing roles", "exclude this specific employer" and "no video interviews" each surfaced *after* applications had already gone out to roles that violated them.

Roles and titles wanted · titles refused · stack · stacks they won't work in · remote / hybrid / on-site · acceptable timezones · countries they can actually be hired in · employers to exclude outright · salary floor.

This half lives in a fenced ```criteria``` block that `filter_postings.py` parses directly, so it is both the brief and the filter. One trap worth repeating: **never put the word `remote` in `geo_in`** — several boards append the workplace type to the location string, so it matches everything and silently disables the geography check.

### Half two — who the candidate is

Ask **once, as a single batch**, for what forms demand and résumés never contain. Don't dribble these out one at a time.

Phone and city · citizenship, residence and work authorisation · legal form (employee / sole proprietor / company) · salary with currency and period · notice period · links · EEO answers · pronouns · relocation · hard limits · whether to answer "reason for leaving" · street address (**never invent one without asking**). The full questionnaire, with the facts worth collecting once for essays, is the second half of `templates/profile.md`.

Write answers to `profile.md` and re-read it at the start of every session. Its last section is append-only: every constraint the candidate reveals mid-run goes there, dated, because that is what a resumed session reads instead of asking the same question again.

**The résumé itself.** Get the actual file and attach that same file everywhere. Don't rewrite it per application — a tailored cover letter earns its time, a tailored CV doesn't, and two CVs that disagree become a problem in an interview. Name it `<Firstname>_<Lastname>_CV.pdf`; some ATS show the filename to the reviewer. If they have no PDF, ask for one rather than generating a document that claims to be their CV.

## Step 2: Filter before you open

Opening a form costs ~10 minutes. Filtering costs seconds. Check in this order and stop at the first failure:

1. **Title** — is it the role type they want? Reject infra/QA/sales/design titles unless asked for.
2. **Geography** — does the location admit where they live?
3. **Stack** — fetch the posting body and grep for their actual stack. A posting that never names their language is not their job, however good the title looks.
4. **Gates inside the form** — see below.

Steps 1–3 are `scripts/filter_postings.py`, run twice: once on the sweep (title and location only, which removes ~99% of a 130k corpus) and again with `--bodies` once you've fetched the survivors. It writes every rejection **with its reason** — a rejection log you can't audit is how a good role gets dropped for the wrong reason and nobody notices.

Deduplicate only retained rows. The first pass removes repeated URLs; company/title deduplication
waits until bodies pass all checks, so an office listing or an unsuitable stack cannot hide a suitable
alternative. Failed, unverified and legacy descriptions remain for manual review. A `stack_out` mention
in the body also requires context review: distinguish mandatory experience from a bonus, a negation,
or a migration away from that technology. `manual-review` is not clearance to apply.

Roughly half of postings that look perfect by title and location still fail on stack or a hidden gate.

## Step 3: Hidden gates

**The disqualifying question is usually not in the job description. It is in the form.** Load the form and scan its field labels *before* writing any answers. Recurring gates:

- "Do you have the legal right to work in \<country\>?"
- "Are you located in \<region\>? We hire only there."
- "This role requires overlap with \<US timezone\>. Are you comfortable?"
- "How many years with \<technology\>?" — with **no zero option**
- A video interview or AI-interview step disclosed only in a consent checkbox
- Compensation as a bare number field with no stated period

When a required field has **no truthful answer**, stop. Report the exact wording to the candidate and let them decide. Do not pick the least-bad option on their behalf.

## Honesty rules

These are not style preferences. Breaking them produces a candidate who gets caught in an interview.

- **Use the form policy for covered technology questions.** Concrete year counts, credentials and project details still come from SQL/CV/saved answers; a Boolean default does not establish them.
- **Write positively and relevantly.** Do not add unsolicited gaps or a mandatory failure story to each answer.
- **Separate facts from operator defaults.** Existing SQL/CV data and explicit student answers retain their provenance; use only the configured fallback scope for unknown location/authorization questions.
- **Geography and question polarity** follow [application-answer-policy.md](application-answer-policy.md). A default for office willingness is not a claim of current residence, and it cannot defeat an explicit student restriction.

## Writing answers

Free-text answers are where applications are won. Aim for specific, verifiable, and unflattering-where-true.

- Lead with the concrete thing that matches their posting's hardest sentence.
- Use numbers from the candidate's real work.
- Name one real limitation. It makes everything else credible.
- State location, timezone in *their* frame, work-authorisation reality and salary as plain facts — even unprompted.
- Never restate the job description back at them.

Draft cover letters as files under `cover-letters/`, never in the browser: some "Cover Letter" fields are file inputs, and typing into one opens a file dialog per keystroke.

Full guidance — letter structure, essay questions, "years of X" with no zero option, geography wording, salary, AI-ban forms: `references/answering.md`.

## Logging

For this explicitly standalone workflow, maintain these two files:

- `applied-list.md` — one row per posting: number, company, role, geography, URL, status. Rejections get a **reason**: "❌ Java/Spring required", not "❌ not a fit".
- `session-log.md` — sourcing numbers, new gotchas, blocked applications and what unblocks them.

Use this table layout; `Status` must be a named column (date and letter may follow it):

```markdown
| # | Company | Role | Geography | URL | Status | Date | Letter |
|---|---|---|---|---|---|---|---|
```

Use `sent`, `replied`, `rejected` (employer rejection), `blocked: <reason>` (not submitted), or
`not applied: <reason>` (filtered out). Update the existing row as its state changes. If submission
may have succeeded, use `unknown` and reconcile against confirmation/mail before retrying.

The log is how a resumed session knows what's already been tried. Never skip it to save time.

### Never apply to the same posting twice

A duplicate application is not a harmless retry. It reaches a human as evidence the candidate
is not paying attention, some ATSes treat it as spam (Ashby blocks the whole board after a few),
and one employer — RevenueCat — bars re-application to the same role for **365 days**. You cannot
un-send it.

So the log is not documentation, it is the deduplication index, and it is the only memory you have:
a new session starts with none of the last one's context.

**Before sourcing and before every application, check the log.** `filter_postings.py --applied
applied-list.md` matches on **company + role title**, not URL — the same role is reachable at several
URLs and boards rewrite them — and compares company names by containment, because the log holds a
human name ("Holepunch (Tether)") while the sweep holds an ATS token ("holepunch").

- **Sent, replied or rejected → skip it.** Missing or unknown statuses also block a retry until reconciled.
- **Blocked → resume queue.** At session start, collect these rows with their blockers and work on
  those now unblocked before sourcing. `--applied` leaves them eligible; it does not mean the blocker is resolved.
- **Not applied → re-evaluate against current criteria.** These rows are not submission history.
- **Same company, different role → allowed, but space it out.** Several roles at one company are
  normal and often smart; several *in a row on one Ashby board* trip the spam filter. Interleave
  other employers between them.
- Check submission history and repeated URLs *before* fetching bodies. Defer company/title
  deduplication within the new shortlist until the bodies have passed their checks.

Write the row the moment a submission confirms, not at the end of the batch. A crash, a context
limit or a closed laptop between submit and log turns a sent application into an invisible one,
and the next session re-sends it.

## Red flags — stop and ask

These pause the affected application within the authorized mode; continue independent work.

- A required field has no truthful option — including an address, ID number or salary history you weren't given
- A video or AI interview is required, or any other stated hard limit is triggered
- You're about to answer "yes" to a work-authorisation or residency question you can't verify
- Anything outward-facing in the candidate's name *beyond the application itself*: sending an email, booking an interview slot, accepting a take-home. Draft it, show it, wait.

