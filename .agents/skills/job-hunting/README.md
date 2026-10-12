# job-hunting

An [Agent Skill](https://agentskills.io/specification) that lets a coding agent run a job search
end to end on your behalf: intake your résumé, source openings straight from applicant-tracking
systems, filter them, fill in the application forms, and keep an auditable log of everything it did.

It is not tied to a role, a stack, or a country. You drop in a résumé; the agent asks once for the
handful of things forms demand and résumés never contain, and then works through the queue.

## Why

Job boards are a stale, deduplicated-badly slice of the market and most of them fight scraping.
The applicant-tracking systems underneath them — Ashby, Greenhouse, Lever and friends — expose
**public, unauthenticated JSON** listing every open role at every company that uses them. A full
sweep is ~16,000 boards and ~130,000 postings in about twenty minutes.

Everything in here was written from actually doing it: ~150 applications over two days, including
the submissions that silently failed and why.

## Install

Skills live in your agent's skills directory — `~/.claude/skills/` for Claude Code,
`~/.agents/skills/` works as a cross-runtime alias for Codex, Copilot CLI and Gemini CLI.

```sh
git clone https://github.com/Natashkinsasha/job-hunting-skill ~/.claude/skills/job-hunting
```

Then just ask: *"find me remote backend roles and apply"*.

"Find vacancies" runs in `search` mode and returns links. "Prepare applications" creates local
drafts. Uploading a résumé and submitting forms require `apply` mode, authorized once for the
agreed search; the skill does not ask again for each matching vacancy.

## What's in it

| File | Contents |
|---|---|
| `SKILL.md` | The workflow: intake, autonomy rules, filtering order, hidden gates, honesty rules, logging |
| `references/sourcing.md` | Every channel with measured yield — ATS endpoints, aggregator feeds, what's account-gated, what's dead |
| `references/ats-playbook.md` | Per-ATS form mechanics and the bugs that silently eat submissions |
| `references/answering.md` | Cover letters, essay questions, geography and salary wording, AI-ban forms |
| `references/email.md` | Verification codes, applying by email, driving Gmail, the privacy line |
| `references/after-submitting.md` | Replies, statuses, the blocked pile, what to do when the channel runs out |
| `templates/profile.md` | The intake questionnaire, and the criteria block the filter reads |
| `data/*_companies.json` | ~27,000 board tokens, shipped with the skill |
| `scripts/sweep_boards.py` | Sweep every Ashby/Greenhouse/Lever board → one row per posting |
| `scripts/filter_postings.py` | Cut a sweep to a shortlist using the profile, with audited rejections |
| `scripts/fetch_postings.py` | Resolve arbitrary job links to title / location / body text |
| `scripts/form_questions.py` | Read a Greenhouse application form and flag its gates — no browser |
| `references/parallel.md` | Parallel drafting, serial submission — and why one-agent-per-vacancy fails |
| `templates/draft.md` | One file per application, ready or blocked, consumed by the submitter |
| `scripts/discover_boards.py` | Find boards no token list has, by probing slugified company names |

All scripts are stdlib-only Python 3 — no dependencies, no API keys, no accounts.

```sh
python3 scripts/sweep_boards.py --out rows.json
python3 scripts/filter_postings.py rows.json --profile profile.md --applied applied-list.md --out pass1.json
python3 -c "import json;print('\n'.join(r['url'] for r in json.load(open('pass1.json'))))" > links.txt
python3 scripts/fetch_postings.py links.txt --out bodies.json
python3 scripts/filter_postings.py rows.json --profile profile.md --applied applied-list.md --bodies bodies.json --out shortlist.json
python3 scripts/discover_boards.py                       # grow the board list
```

Initialize `applied-list.md` with the table header in `SKILL.md`, or omit `--applied` when no
history exists. Its named `Status` column distinguishes sent applications from blocked work.

`fetch_postings.py` emits `[url, title, location, body_text, extraction_status]`. Status is
`verified` for a nonempty ATS description, `unverified` for generic HTML, or `failed` for a failed
fetch/empty description. The filter accepts old four-column rows as unverified: re-fetch or review
them manually. Only verified descriptions drive body-based rejection. `stack_out` body mentions
produce `manual-review` rows, since a mention does not establish a mandatory requirement.

A sweep reports successful and failed boards per ATS. If any selected ATS has no successful
response, it exits nonzero and leaves the previous output unchanged. Partial failures produce a
warning; an incomplete sweep does not establish that the market has no more roles.

Run the offline regression tests with `python3 -m unittest discover -s tests -v`.

Measured on one real run: 59,103 Lever postings → 34 survivors on title and location → 19 after
reading the bodies. Every rejection is written out with its reason, because a rejection log you
can't audit is how a good role gets dropped for the wrong reason and nobody notices.

### Parallel, where it helps

Greenhouse exposes its whole application form through the public API — every field, required flag
and dropdown option — so `form_questions.py` sees the gate ("country you reside in", "authorised to
work in …", "years of X" with no zero option) before anyone opens a browser. Drafting is then
embarrassingly parallel: N agents, no browser, no mailbox, one `drafts/<company>-<role>.md` each,
`ready` or `blocked` with the field quoted. One submitter walks the drafts through the single
browser. One-agent-per-vacancy is the obvious design and the wrong one: shared IP, per-company
verification codes that cancel each other, one log.

### Self-contained on purpose

The board tokens ship in `data/`, so a sweep talks to nothing but the ATS APIs themselves. Both
update paths — `sweep_boards.py --refresh` (merges a public dataset) and `discover_boards.py`
(probes company-name slugs harvested from job feeds) — **merge and never shrink the list**, and a
missing token file is a loud exit rather than a sweep that quietly returns zero jobs. An upstream
that moves or disappears costs you new companies, not your list.

## A few things it knows that cost a failed submission to learn

- On **Ashby**, setting an input's `.value` from JavaScript does not reach React state. The form
  looks filled and reports "Missing entry for required field". You have to actually type.
- On **Lever**, the email input carries a `pattern` attribute whose regex is invalid in current
  browsers. `checkValidity()` throws, submit silently does nothing, and **no error appears**.
- **Greenhouse** answering HTTP 428 means it wants an emailed verification code — which is why the
  skill asks for mail access up front rather than round-tripping to you for every code.
- "Remote" on a posting nearly always means "remote *within* the country we can employ you in".
  The only geography signal that holds up is your country appearing in the list of hiring locations.
- A "Cover Letter" field is sometimes a **file input**, not a textarea. Typing into one opens a file
  dialog per keystroke; 39 dialogs deep the tab has to be closed. Letters live in files for a reason.
- The worldwide-remote market is smaller than it looks: ~130,000 postings filtered down to 60–120
  applyable roles for one candidate. It runs out, and then only account-gated channels add yield.

## Honesty

The skill's hard constraint is that it never invents anything about you — no technology you haven't
used, no year counts, no address, no work-authorisation status. Where a required field has no
truthful answer, it stops and asks instead of picking the least-bad option. Where an employer bans
AI-written applications, it hands the application back to you with a facts sheet.

## License

MIT
