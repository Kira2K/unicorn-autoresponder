# LinkedIn Profile JSON v1

The machine-readable canonical contract is
[`profile-input.schema.json`](../src/features/linkedin-automation/profile-filler/profile-input.schema.json).
It covers only fields that Profile Filler currently writes.

## Canonical shape

```json
{
  "schema_version": 1,
  "profile": {
    "headline": "Backend Engineer", "about": "Profile summary",
    "skills": { "add": ["Go"], "target_count": 100 },
    "experience": [{
      "action": "upsert",
      "match": { "company": "Acme", "job_title": "Engineer", "start_date": "2024-01" },
      "data": {
        "company": "Acme", "job_title": "Senior Engineer",
        "workplace_type": "REMOTE", "location": "Warsaw",
        "start_date": "2024-01", "skills": ["Go"]
      }
    }],
    "education": [{
      "action": "upsert", "match": { "school": "University", "start_date": "2020-09" },
      "data": { "school": "University", "degree": "Bachelor", "start_date": "2020-09" }
    }],
    "open_to_work": {
      "job_titles": [{ "name": "Backend Engineer" }],
      "workplace_types": ["REMOTE"], "locations": [{ "name": "Poland" }],
      "employment_types": ["FULL_TIME"], "start_date": "IMMEDIATELY",
      "visibility": "RECRUITERS_ONLY"
    }
  }
}
```

## Rules confirmed by Unipile v2 MCP

- `headline` and `about` are strings. `about` is sent as Unipile `bio`.
- Profile, Experience, and Education Skills are non-empty names. Existing profile
  Skills are not removed; Profile Filler adds only missing names.
- Experience requires `company` and `job_title`. A new entry also requires
  `start_date`; an existing uniquely matched entry can be edited without a date.
- Do not include `profile.experience[].data.employment_type`. Live Unipile v2
  currently rejects this Experience field even with an ID from its own catalog.
  The analyzer removes it with a warning. This rule does not apply to
  `profile.open_to_work.employment_types`.
- Experience `workplace_type` is `ON_SITE`, `HYBRID`, or `REMOTE`.
- Experience `source_of_hire` must use an enum listed in the JSON Schema.
- Education requires `school`. A new entry also requires `start_date`; an
  existing uniquely matched entry can be edited without a date.
- Open to Work requires job titles, workplaces, and visibility. Preview always
  resolves job titles with `JOB_TITLE` and locations with `LOCATION`.
- Input IDs are never trusted. Canonical JSON keeps names, and Preview always
  resolves fresh IDs for fields where Unipile requires them.
- Missing or ambiguous required catalog matches block Apply instead of silently
  dropping requested data.
- Dates use `YYYY-MM`. Profile Filler always sends `notify_network: false`.

## Product rules

- Only `upsert` is accepted; delete is intentionally unavailable.
- `target_count` is an internal safe range of 95-103, not a Unipile API limit.
- Open to Work cannot be disabled by this version.
- Extra fields are ignored by the tolerant analyzer and excluded from Preview;
  generators should emit the strict canonical schema above.
