# Answering forms and writing cover letters

First read [application-answer-policy.md](application-answer-policy.md). Use relevant SQL/CV data and the configured defaults for covered questions, without asking again; explicit student rules/answers override them. The policy controls factual provenance and question polarity. The writing guidance below cannot silently cancel a configured default or promote it to a verified fact.

## The one rule

**Optimize for an interview invitation: relevant, specific and positive.** Lead with the student's strongest relevant experience and concrete results. Do not volunteer unrelated gaps or force a negative example into every answer. Use SQL/CV/explicit answers for detailed claims; a Boolean policy default does not create a project story or numeric experience history.

Never restate the job description back at them. They wrote it.

## Cover letter structure

Five short blocks. Under 400 words. No "I am writing to express my interest."

1. **Stack match, one sentence.** Name the technologies from their posting that the candidate
   actually uses, in the candidate's words. If the overlap is partial, say which part.
2. **The hardest thing in their posting, answered.** Find the sentence in the posting that most
   applicants can't satisfy — the domain, the scale, the specific failure mode — and answer that
   one. This is the whole letter; the rest is context.
3. **One concrete result with a number.** From real work. "Migrated production to k3s without a
   maintenance window, ~60% lower monthly spend at equal deploy latency." Not "improved
   infrastructure efficiency."
4. **One more relevant strength or lesson.** Include a real limitation/failure only when the question asks for it or it materially explains the achievement.
5. **Practical block, when requested.** Location, timezone in their terms, legal form, salary expectation and availability. Use the form policy for covered questions; distinguish assumptions in the internal audit.

Do not add unrelated eligibility disclosures or unrequested personal details to every letter.

Example of the domain paragraph earning its place, for a payments role:

> I have built money-adjacent flows where "the API returned 200" is not the same as "the money
> moved" — idempotency on retries, reconciliation, webhooks from providers that lie, and audit
> trails that still make sense during a dispute months later.

That is one sentence that a person who hasn't done it cannot write.

## Long-form essay questions

Some forms (Linear, Chainstack, VRChat, Canonical) ask three to six real essays. They are worth
the time — few applicants answer them well — but they need structure, not prose:

- **Answer the question that was asked**, in its first sentence. Not a preamble.
- **Architecture questions want the failure mode.** Describe the system, then name what actually
  broke and how you found it. "Stale features silently producing confident-but-wrong offers"
  is the answer; the component diagram is the setup.
- **"How do you use AI?" wants specifics and boundaries.** What you delegate, what you review
  yourself always (anything touching money, auth, migrations, infrastructure), and how output
  is verified mechanically rather than by vibes.
- **Product questions want a real story**, including one where the candidate's own call was wrong.
- **If the candidate doesn't use the product, say so** and analyse what you can from outside.
  Pretending to be a user is the fastest way to be caught.

Draft these in a file under `cover-letters/`, not in the browser. See the Ziina trap below.

## Answering "how many years of X" with no zero option

Use the student's SQL/CV or a saved numeric answer. The affirmative technology default covers knowledge/experience questions, not an invented duration. If no supported duration fits a required option, the question is outside the configured default and needs a saved answer/handoff.

For an open-ended technology answer, lead with relevant SQL/CV examples. Do not append an unsolicited inventory of weaknesses. Keep unsupported numerical tenure distinct from the configured affirmative knowledge answer.

## Geography, timezone and work authorisation

Use [application-answer-policy.md](application-answer-policy.md) for current operator choices, question polarity, student overrides and fallback precedence. Never label a timezone fallback as verified residence or feed it into restriction matching. Willingness to attend/relocate is distinct from already residing near the office. Give practical details when requested; avoid repeating assumptions as extra facts throughout the cover letter.

## Salary

Give a number, in their currency if they state one, with the period spelled out. "USD 100,000 per
year, open to discussion." A blank or a range that starts at zero reads as either evasive or junior.
If the form is a bare number field with no period label, put the annual figure and repeat the period
in the nearest free-text field.

## Application limits are real

Some companies cap how many roles you may apply to (Scribe: 2 per 6 months; many: one repeat per
365 days per role). **Check before spending a slot.** Spray-applying to five roles at one company
is worse than choosing one — it spends every slot and signals nothing.

## When the employer bans AI-written applications

Several do, in the form itself ("obviously AI-generated responses will result in your application
being declined"). **Stop.** Write the candidate a facts sheet — the posting's hard requirements,
the matching pieces of their history, the numbers, the links — and let them write it. Paraphrasing
your way around the rule is the one failure mode that can't be recovered from.

## Two traps that cost real time

- **A "Cover Letter" field that is a file input, not a textarea.** Typing into it opens a file
  dialog per keystroke — 39 dialogs deep, the page is unusable and the tab has to be closed.
  Always check `type` before typing. This is why letters live in files: write once, attach anywhere.
- **Greenhouse required questions are sometimes `<textarea>`, not `<input>`.** A selector like
  `input[id^=question_]` silently misses them, and the form rejects with no visible error.
  Select `input, textarea, select` together, always.

## Logging what you said

Keep every letter as a file, named by company and role. When a recruiter replies three weeks later,
the candidate needs to know what was claimed on their behalf — and the next application to a similar
company starts from the closest existing letter rather than a blank page.
