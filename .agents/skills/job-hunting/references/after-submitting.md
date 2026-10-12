# After submitting

A submitted application is not a finished one. Half the work of a job search happens after the
form closes, and it is the half an agent is most likely to drop — the run feels done, the counter
went up, and nobody is asking a question.

## Start every session by reading the mail, not the board

Before sourcing anything new, sweep what came back (`email.md` has the searches). Replies have
deadlines; postings don't. A scheduling link that expired while you were sweeping 16,000 boards
is a worse outcome than ten applications not sent.

Triage what you find into four piles:

| Reply | What to do |
|---|---|
| **Rejection** | Log it against the row with the reason they gave, if any. Don't re-apply; most companies cap repeats at 365 days. |
| **Recruiter question** | Answer only from `profile.md`. If the answer isn't there, it's a question for the candidate — don't improvise on their behalf. |
| **Scheduling link** | Surface it immediately with its expiry. Do not book a slot without being told which one. |
| **Take-home task** | Surface it. Whether to spend a weekend on it is entirely the candidate's call, and doing it for them is fraud. |

## What the log has to be able to answer

Three weeks after the fact, when a recruiter writes back, the candidate needs to know what was
said in their name. `applied-list.md` therefore carries, per row: company, exact role title,
geography, URL, date, status, and a pointer to the letter file. `cover-letters/<company>-<role>.md`
keeps the text itself.

Statuses worth distinguishing, because they mean different next actions:

- **sent** — submitted, no acknowledgement yet
- **blocked** — filled but not submitted, with the reason (captcha, code, ban on AI, missing answer)
- **rejected** — an employer rejected a submitted application, with their reason if given
- **replied** — a human wrote back; the candidate has it
- **not applied** — filtered out, with the reason
- **unknown** — submission may have succeeded; reconcile confirmation/mail before retrying

Use the table header in `SKILL.md`. The filter excludes submission history and unknown/legacy
statuses; `blocked` and `not applied` remain eligible. At session start, build a resume queue from
blocked rows, resolve their recorded blockers, then update the same row after submission. A row
becoming eligible in the filter does not itself resolve its blocker.

The reason field is not bookkeeping. A run that records "❌ not a fit" 200 times teaches nobody
anything; "❌ Java/Spring required" and "❌ must reside in the US" let the next session tighten the
filter and stop wasting the same ten minutes.

## Blocked applications are work, not waste

The blocked pile is the highest-value list in the whole run: these are roles that already passed
every filter, where the form is filled and only a mechanical obstacle stands in the way. Keep them
together with what specifically unblocks each:

- captcha that won't load → the candidate submits from their own browser, form already filled
- employer bans AI-written applications → hand over a facts sheet, they write it
- video or AI interview screen → their decision, not yours
- required question with no truthful answer → their decision, with the exact wording quoted

Present this list explicitly when you report. It is the shortest path from where the run stopped
to more applications out the door, and it is the part a candidate can finish in an evening.

## Don't re-apply, don't spray

- Companies cap repeat applications — commonly one per role per 365 days, and some cap total roles
  (2 per 6 months is a real example). **Check before spending a slot.**
- Five applications to one company is worse than one good one: it burns every slot and reads as
  indiscriminate.
- Match **submission history** on company + role title: URLs can change.
  `filter_postings.py --applied applied-list.md` does this. For new postings, the first pass
  removes repeated URLs; company/title deduplication waits until their bodies pass the filters.

## When the channel runs out

It will, after a couple of days — the worldwide-remote market is 60–120 applyable roles at a given
moment, not thousands. When the sweep stops producing, say so plainly rather than lowering the bar
and applying to things that fail the candidate's own criteria. What actually adds yield at that
point is in `sourcing.md`: the account-gated channels, contractor marketplaces, and direct email.
Re-running the sweep daily picks up genuinely new postings, and that is a small, steady number.
