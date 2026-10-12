# Sourcing

Where postings actually come from, and which channels are a waste of a day.

## Company discovery in this repository

Company discovery is supported separately from collecting vacancies at already configured companies. Start from the shipped ATS token lists, an explicit company-name list, or a bounded public feed/web search allowed by the user's scope. `discover_boards.py` harvests company names and probes Ashby/Greenhouse/Lever; `sweep_boards.py` then reads vacancies at known boards. These are different capabilities.

For a bounded company probe, use `python scripts/discover_boards.py --names names.txt --workers 3 --dry-run`. This avoids the helper's unscoped feed harvest, default 12 workers and dataset mutation. Never use its bare defaults in this project: the current feed list includes deferred Himalayas. Himalayas, HiringCafe/hiring.cafe, Wantapply and Hirefy remain deferred; LinkedIn/lnkd.in are always forbidden, including redirects. Public-feed reads must explicitly select allowed endpoints. Do not launch a whole vendored sweep just to verify company discovery.

Treat a successful token probe as a lead. Verify the official employer/career link and a structured ATS response before associating it with a company; HTTP 200 or a slug match alone does not prove employer identity. Return company name, official URL/board token, discovery URL/time and verification/access evidence. Record empty listings separately from an inaccessible board.

Before a new SQL campaign, pass verified sources through the existing company/source registry's reviewed import path, then freeze the manifest. Never append discoveries to an already running/frozen batch. The external `job-hunting` adapter currently requires an explicit `boards` list and does not automatically harvest companies or onboard them into SQL; that integration remains TODO. Standalone company discovery itself does not need SQL or a student CV and cannot send applications.

## The shape of the problem

Job boards (LinkedIn, Indeed, Wellfound, RemoteOK…) are a search interface over a small,
stale, heavily-duplicated slice of the market, and most of them fight scraping. The
applicant-tracking systems underneath them expose **public, unauthenticated JSON** listing
every open role at every company that uses them. Go to the source.

Historical sweeps covered thousands of boards. Those measurements are not current coverage, completeness or an allowed concurrency setting. Use a bounded manifest and at most three active actions as required by this project; the shared coordinator is still pending. Reuse the collected descriptions across the selected stacks/students.

## ATS endpoints

Public JSON listing endpoints, mostly GET; Workday below uses POST. Verify availability per source rather than treating this reference as a current health check.

| ATS | Listings | Single job |
|---|---|---|
| Ashby | `api.ashbyhq.com/posting-api/job-board/<org>?includeCompensation=true` | in the list (`descriptionHtml`) |
| Greenhouse | `boards-api.greenhouse.io/v1/boards/<org>/jobs` | `…/jobs/<id>` → `content` |
| Lever | `api.lever.co/v0/postings/<org>?mode=json` | in the list (`description` + `lists[]`) |
| Workable | `apply.workable.com/api/v1/widget/accounts/<token>?details=true` | in the list |
| Recruitee | `<org>.recruitee.com/api/offers/` | `…/offers/<id>` |
| Teamtailor | `<org>.teamtailor.com/jobs.json` | in the list |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/<org>/postings` | `…/postings/<id>` |
| BambooHR | `<org>.bamboohr.com/careers/list` | `…/careers/<id>/detail` |
| Workday | `POST <tenant>.wd<N>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs` | `…/job/<path>` |

Greenhouse and Lever have EU-hosted boards (`job-boards.eu.greenhouse.io`, `jobs.eu.lever.co`).
Lever's EU API host is `api.eu.lever.co`; **Greenhouse has no EU API host** — `boards-api.greenhouse.io`
already serves EU boards.

## Getting the list of org tokens

**The skill ships with them.** `data/<ats>_companies.json` holds ~27,000 board tokens
(ashby 3,175 · greenhouse 8,335 · lever 4,370 · bamboohr 11,316), so a sweep needs nothing but
the ATS APIs themselves. Two ways to grow the list, neither of which can shrink it:

- `sweep_boards.py --refresh` merges the upstream dataset
  (`raw.githubusercontent.com/Feashliaa/job-board-aggregator/HEAD/data/<ats>_companies.json`)
  into the local file. If that repo moves or dies you lose *new* companies, not your list.
- `discover_boards.py` finds boards no dataset has. Remote-job aggregators publish company
  **names** freely even when they publish nothing else useful, and a board token is almost always
  the company name lowercased with punctuation stripped. Harvest names → slugify → probe the three
  board APIs → keep the 200s. Measured: 296 harvested names → 120 live boards → 18 that the
  vendored lists didn't have, including Bybit, Kraken, Qonto and Doctolib.

A third way is an official careers-page inspection for links, embeds or listing requests to an ATS. Some employers use their own forms or inaccessible pages, so absence of an ATS link is not proof that they have no vacancies.

## Aggregator feeds worth reading directly

Small compared to a sweep (hundreds, not 130k), but they surface *companies* that no token list has,
and a few carry a genuine worldwide flag. Feed them to `discover_boards.py --names` or read directly.

| Feed | Endpoint | Notes |
|---|---|---|
| We Work Remotely | `weworkremotely.com/categories/<cat>.rss` | The RSS carries a `<region>` tag — `Anywhere in the World` is a real filter, not a hope. Categories: `remote-programming-jobs`, `remote-back-end-programming-jobs`, `remote-front-end-programming-jobs`, `remote-full-stack-programming-jobs` |
| Hacker News "Who is hiring" | `hnhiring.com/locations/remote` | Small, but these are direct-to-founder and often reply by email |
| Jobicy | `jobicy.com/api/v2/remote-jobs?count=50&geo=europe&industry=dev` | `geo` filter actually works |
| Remotive | `remotive.com/api/remote-jobs?category=software-dev` | Thin but live |
| Himalayas | Not queried in this project | Deferred by the user |
| Working Nomads | `workingnomads.com/api/exposed_jobs/` | Mostly contractor marketplaces |
| Arbeitnow | `arbeitnow.com/api/job-board-api` | EU, mostly on-site |
| RemoteOK | `remoteok.com/api` | Noisy, but a good source of company names |
| NoDesk | `nodesk.co/remote-jobs/index.xml` | ~10 postings |

## Channels that need the candidate's own account

You cannot register on someone's behalf. Flag these early so the candidate can decide whether to
open them, because a couple are the only channels with a *continuous* flow rather than a snapshot:

- **LinkedIn Easy Apply** — forbidden in this project, even with an existing login. Store/report supplied links without opening them.
- **Djinni** (`djinni.co/jobs/?primary_keyword=Node.js&exp_level=5y&employment=remote`) — RU/UA-speaking
  market, many B2B contracts. Browser-rendered; applying needs their account.
- **Contractor marketplaces** — Lemon.io, Proxify, A.Team, Toptal, Braintrust. One profile plus their
  interview, then a project stream. The only channel that keeps producing after the sweep is exhausted.
- **Telegram job channels** — not readable without their account.
- **YC Work at a Startup**, **Otta / Welcome to the Jungle**, **Wellfound** — login-gated.

## Channels confirmed dead or not worth it

- **hh.ru API** — 403 without a Russian-facing IP.
- **Getro** (a16z / Sequoia portfolio talent boards) — public API closed, 404.
- **Wellfound (AngelList)** — 403 unauthenticated.
- **remote3.co, cryptocurrencyjobs.co, arc.dev, aijobs.net, justremote** — HTML only, needs browser
  scraping for a small yield.
- **Guessing Workable tokens** — 60 guessed company tokens produced 2 live boards and 0 matches.
  Slug-probing pays off on Ashby/Greenhouse/Lever; it does not on Workable.

## Channel verdicts (measured, not guessed)

- **Ashby / Greenhouse / Lever** — where internationally-remote engineering actually lives. Apply directly, no account.
- **Workday** — 12,884 boards → 24,300 postings → **0 usable**. Two reasons: applying requires
  creating an account per company, and the location field lies (a posting tagged "Worldwide" said
  "must reside in the United States" in the body). Use for discovery only, if at all.
- **BambooHR** — 11,316 boards → 46,363 postings → **1 usable**. It is the ATS of small domestic
  employers. Almost no international remote.
- **iCIMS** — same profile as the two above. Skip unless you have a specific company in mind.
- **HiringCafe/hiring.cafe** — deferred by the user; do not browse it during this project's current milestone.
- **LinkedIn** — forbidden; this is a navigation restriction, not a yield recommendation.

## Filtering: the geography test that works

This section is for explicitly standalone single-candidate searches only. SQL campaigns inherit company/feed markets and use shared selection plus the existing student restriction loader. Do not paste these example keyword filters into the shared pipeline.

The naive filter — "posting says Remote" — is wrong more often than right. "Remote" almost
always means "remote *within* the country or bloc we can employ you in".

**Search for the candidate's country or city inside the posting's list of hiring locations.**
That list is the only place a company commits to a geography. Phrases like "remote (non-EU)" are
usually about *tax residence in a specific country*, not about you.

Cheap pre-filters that cost nothing and remove most of the corpus:

```python
# substitute the candidate's own exclusions and their country/city into these
TITLE_OUT = r'devops|sre|site reliab|platform|infrastructur|security|release|manager|director|sales|recruit'
GEO_OUT   = r'\b(us|u\.s\.|united states|usa|canada|emea only|uk only)\b.{0,40}(only|based|resident|eligib)'
GEO_IN    = r'<their country>|<their city>|worldwide|anywhere|global|any timezone'
```

Then read the body. A body that never names a country, and never names a timezone band narrower
than the candidate's, is the good case.

## What a sweep actually yields

Measured on one real run: 15,880 boards → ~130,000 postings (Lever alone: 4,368 boards →
59,103 postings). After filtering for one specific candidate — senior backend/fullstack,
non-EU resident, worldwide remote, $100k — that came down to roughly **60–120 applyable roles**.

This was one historical candidate-specific sample, not a measurement of the whole market or proof that another source is exhausted. Report current coverage, failed reads and the selected scope explicitly.
