# Running applications in parallel

Yes — but the cut is **parallel drafting, serial submission**. Splitting the run into "one agent
per vacancy, each driving a browser" is the obvious design and it is the wrong one.

## Why one-agent-per-vacancy fails

- **One browser.** The Playwright server is one process with one focused page. Two agents issuing
  commands interleave on the same tab. Several servers are possible but they share an IP, each
  needs its own mail login, and the configuration is harness-specific.
- **One IP.** Ashby flags a board as spam after a few submissions in quick succession — a burst of
  parallel submits is exactly the pattern it looks for.
- **Greenhouse codes are per company and each new submit invalidates the previous code.** Two
  agents applying to the same company at once cancel each other's codes.
- **One log.** Two writers on `applied-list.md` race, and a lost write is a duplicate application
  next session — the thing the whole log exists to prevent.
- **Clicking isn't the bottleneck.** Filling a form is two minutes. Writing answers worth sending
  is ten. Parallelise the ten.

## The pipeline

```
sweep ─▶ filter ─▶ form_questions.py ─▶ [drafter × N] ─▶ drafts/ ─▶ [submitter × 1] ─▶ log
        (threads)   (threads, no browser)  (agents, no browser)         (one browser)
```

### 1. Read the forms without opening them

`scripts/form_questions.py` pulls every field, its required flag and its options from the
Greenhouse API and flags the likely gates. That is ~8,000 boards where "country you reside in",
"authorised to work in …" and "years of X with no zero option" are visible from curl. Ashby and
Lever don't expose their forms; for those, one browser reads each form (~20 s, read-only) and
saves the field list next to the posting before drafting starts.

### 2. Draft in parallel

One agent per vacancy, or one per batch of three to five. Each gets:

- `profile.md` (both halves)
- the posting body (from `fetch_postings.py`)
- the form's questions (from step 1)
- `templates/draft.md` and `references/answering.md`

and writes `drafts/<company>-<role>.md`. A drafter has **no browser, no mailbox, no log** — it
cannot submit anything, so it cannot cause harm in parallel. It can produce two outcomes:

- `status: ready` — every required field has a truthful answer, letter and essays written
- `status: blocked` — with the exact wording of the field that has no truthful answer

Drafters must not resolve blocks by choosing the least-bad option. That decision belongs to the
candidate and comes back through the batched question, not through the draft.

**Dispatch prompt shape** (what each drafter is told, in this order): who the candidate is
(`profile.md`, complete); the posting; the form questions; the draft template; the rule that a
missing truthful answer is a `blocked` status, never a guess; the output path. Nothing about the
other vacancies — a drafter that sees five postings starts writing one generic letter.

### 3. Submit serially

Run this stage only in the `apply` mode authorized in `profile.md`. A draft's `status: ready`
means its answers are complete; it does not authorize submission. In `draft` mode, return the files.

One agent, one browser, walks `drafts/` in an order that **interleaves employers** — never two
roles on the same Ashby board back to back. Per draft: open the form, scan it against the draft's
field list (forms change; a new required field is a stop), type the answers, attach the CV, pull
the code if asked, confirm the success state, write the log row, next.

The submitter does not write prose. If a draft is incomplete, it marks it `blocked: draft
incomplete — <field>` and moves on; the drafter fixes it, not the submitter at the keyboard.

### 4. Batch the blocked pile

When the drafts are in, every `blocked` reason goes to the candidate in one message, quoted
verbatim. Their answers update `profile.md` (append-only section), the affected drafts are
regenerated, and the submitter picks them up on its next pass.

## What this buys

Ten drafts in the time of one. Submission drops to mechanics at roughly two minutes a form, which
for a day's shortlist of 30–60 roles is an hour or two of browser time instead of a day. The
constraint that remains is the real one — how many truthful, specific applications the
candidate's history can support — and no amount of parallelism changes it.

## Measured

Three drafters dispatched at once against three real Greenhouse postings, with one deliberately
plausible match (a payments backend role) and two deliberately wrong ones, from a synthetic profile.
All three came back in about a minute; all three returned `blocked`, each quoting the exact field —
a location multi-select with no option for the candidate's country, a required French-level dropdown
whose lowest option was A1, a "years of Java and Spring Boot" dropdown whose minimum was "less than
3 years" for a candidate with none. None chose a least-bad option. Each still delivered every other
field, a cover letter in the `answering.md` shape (partial stack match stated first, one number, one
failure, practical block with the timezone translated into the employer's cities), and submitter
notes — so an unblock is a one-line edit, not a re-draft.

One gap it exposed in intake: two forms asked about **on-call willingness**, which the profile
template only covers under "anything they refuse outright". Ask it explicitly.
