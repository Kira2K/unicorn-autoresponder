# Board tokens

One JSON array of applicant-tracking-system org tokens per ATS. A token is the `<org>` in
`api.ashbyhq.com/posting-api/job-board/<org>`, `boards-api.greenhouse.io/v1/boards/<org>/jobs`,
`api.lever.co/v0/postings/<org>`.

These ship with the skill so that a sweep depends on nothing but the ATS APIs themselves.

| File | Tokens |
|---|---|
| `ashby_companies.json` | 3,175 |
| `greenhouse_companies.json` | 8,335 |
| `lever_companies.json` | 4,370 |
| `bamboohr_companies.json` | 11,316 |

Snapshot taken 2026-09-17. Provenance: the public dataset at
[Feashliaa/job-board-aggregator](https://github.com/Feashliaa/job-board-aggregator), merged with
tokens found by `scripts/discover_boards.py`.

**Both update paths merge and never shrink**, so an upstream that moves, renames or disappears
costs you new companies rather than your list:

```sh
python3 ../scripts/sweep_boards.py --refresh   # merge the upstream dataset
python3 ../scripts/discover_boards.py          # probe slugified company names from job feeds
```

`bamboohr_companies.json` is kept for completeness only. A full BambooHR sweep measured
11,316 boards → 46,363 postings → 1 role usable to an internationally-remote candidate;
it is the ATS of small domestic employers. See `../references/sourcing.md`.
