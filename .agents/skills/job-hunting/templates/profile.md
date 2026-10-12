# Profile

Everything the search needs about the candidate, in one file. Built during intake, re-read at the
start of every session, appended to whenever a new constraint surfaces mid-run.

Two halves. The first is **who the candidate is** — it fills forms. The second is **what we're
looking for** — `scripts/filter_postings.py` parses it into filters, so it has a strict format.

---

## Search criteria

Mode: `search` / `draft` / `apply` — record the user's request authorizing it and its scope here.
Default to `search` when submission has not been requested; retain explicit authorization on resume.

Machine-read. Format is one `key: comma, separated, values` per line — not YAML, no nesting,
no quotes, no regex. Each value is matched case-insensitively as a **whole word** (`go` does not
match "going"; `.net` still matches "ASP.NET"). Delete a key to disable that check; an empty key
is treated as "no opinion", not "reject all".

**The block below is an EXAMPLE for one specific candidate — a senior Node/TypeScript engineer
in Tbilisi. Replace every line.** A profile that still says `georgia, tbilisi` filters for someone else.

```criteria
titles_in: software engineer, backend, back-end, full-stack, fullstack, product engineer, senior engineer, staff engineer, principal engineer, web developer
titles_out: junior, intern, graduate, devops, sre, site reliability, infrastructure engineer, security engineer, release engineer, qa, quality assurance, data engineer, data scientist, machine learning, android, ios, mobile, solutions engineer, solutions architect, forward deployed, sales, account executive, support, manager, director, head of, designer, recruiter, marketing, analyst, firmware, embedded, technical writer, developer advocate, consultant
stack_in: node, nodejs, typescript, nestjs, next.js, react, postgres, mongodb, redis, rabbitmq, graphql
stack_out: java developer, c#, .net, ruby on rails, php, laravel, drupal, wordpress, salesforce, unity, abap
geo_in: worldwide, anywhere, global, emea, europe, cet, gmt, asia, apac, georgia, tbilisi
geo_out: us only, united states only, must reside in the united states, authorized to work in the united states, us-based candidates only, located within the u.s, eu citizen required, right to work in the eu, uk only, canada only
timezone: GMT+4
workplace: remote
relocation_ok: UAE, Dubai
exclude_employers: 
hard_limits: video interview, record a short video, one-way video, asynchronous video, video introduction
salary_min_usd: 100000
```

**What each key does.** `timezone`, `workplace`, `relocation_ok` and `salary_min_usd` are read
by *you*, not by the filter — they steer how you judge a posting and fill a form. The rest drive
`filter_postings.py`: `titles_in` — at least one must appear in the job title. `titles_out` — any
match rejects. `stack_in` — at least one must appear in the body (this is the strongest filter;
a posting that never names the candidate's language is not their job however good the title looks).
`stack_out` — rejects a match in the title; body mentions go to manual review to establish whether
the technology is actually required. `geo_out` — a phrase that
means the candidate can't be hired; any match rejects. `geo_in` — at least one must appear in the
location field or the first part of the body. `hard_limits` — phrases in the body that the candidate
has ruled out entirely. `exclude_employers` — companies to skip, whatever they post.

Fill `geo_in` with the candidate's own country and city. **Never put the word `remote` in
`geo_in`.** Several boards append the workplace type to the location string — Lever renders
"Seattle, Washington remote" — so a `geo_in` containing "remote" matches every posting on earth
and silently disables the geography check. "Remote" nearly always means "remote *within* the
country we can employ you in"; the only geography signal that holds up is the candidate's own
country appearing in the list of hiring locations. Workplace type belongs in `workplace:`.

---

## Who the candidate is

For `draft` or `apply`, ask for the missing details **in one batch** after reading the résumé. These are the things every form
demands and no résumé contains.

| Field | Value |
|---|---|
| Full name | |
| Email | |
| Phone (with country code) | |
| City, country | |
| Timezone | |
| Street address + postcode | *never invent one — ask, or ask whether a placeholder is acceptable* |
| Citizenship | |
| Country of residence + legal basis | |
| Work authorisation — which countries, without sponsorship | |
| Legal form — employee / sole proprietor / company | |
| Salary expectation + currency + period | |
| Notice period / availability | |
| LinkedIn | |
| GitHub | |
| Portfolio / personal site | *ask whether it may be used at all* |
| X / Twitter | |
| Résumé file + where it lives | |
| Gender | |
| Race / ethnicity | |
| Veteran status | |
| Disability status | |
| Pronouns | |
| Willing to relocate? Where? | |
| Reason for leaving last role — answer or leave blank when optional? | |
| On-call rota — willing? any experience? | forms ask this directly; "not stated" blocks a draft |
| Anything they refuse outright | video interviews, AI screens, client-facing roles, specific employers |

## Facts worth having ready

Forms and essays ask for these repeatedly. Collect once.

- **Education** — institution, exact degree name, dates, grades if the transcript is to hand
  (Canonical and a few others ask for school grades, seriously).
- **Employment history** — company, exact title, start/end month, one-line description.
- **Three concrete results with numbers** — the ones that go in every cover letter.
- **One real failure** worth telling — the credibility purchase in any essay.
- **Calibrated skill levels** — for anything adjacent to their stack, the honest word:
  "Node — advanced, libuv — no, DHT — read not implemented, C++ — beginner."

## Constraints learned mid-run

Append-only. Every entry here was discovered by hitting it. Date them.

- 
