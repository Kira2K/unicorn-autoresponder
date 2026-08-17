# Profile JSON V1

`profile.json` describes the desired state of supported LinkedIn profile
sections. It never contains Unipile API keys, LinkedIn cookies, proxy
credentials, account IDs, timing ranges, or execution instructions.

Only the top-level `profile` object is required. Omitted sections are not
changed. Unknown and invalid optional fields produce warnings and are skipped;
the administrator confirms the normalized preview before any mutation.

```json
{
  "schema_version": 1,
  "profile": {
    "headline": "QA Engineer",
    "about": "Profile summary",
    "skills": {
      "add": ["Python", "Pytest"],
      "target_count": 100
    },
    "experience": [
      {
        "action": "upsert",
        "match": {
          "company": "Example Company",
          "job_title": "QA Engineer",
          "start_date": { "year": 2023, "month": 1 }
        },
        "data": {
          "company": "Example Company",
          "job_title": "QA Engineer",
          "employment_type": "FULL_TIME",
          "workplace_type": "REMOTE",
          "start_date": { "year": 2023, "month": 1 },
          "description": "Responsibilities and results",
          "skills": ["Python", "Pytest"]
        }
      }
    ],
    "education": [
      {
        "action": "upsert",
        "match": {
          "school": "Example University",
          "start_date": { "year": 2018, "month": 9 }
        },
        "data": {
          "school": "Example University",
          "degree": "Bachelor",
          "field_of_study": "Computer Science",
          "start_date": { "year": 2018, "month": 9 },
          "end_date": { "year": 2022, "month": 6 },
          "skills": []
        }
      }
    ],
    "open_to_work": {
      "job_titles": [{ "name": "QA Engineer" }],
      "workplace_types": ["REMOTE"],
      "locations": [{ "name": "Europe" }],
      "start_date": "IMMEDIATELY",
      "employment_types": ["FULL_TIME"],
      "visibility": "RECRUITERS_ONLY"
    }
  }
}
```

Safety rules:

- Experience requires `company`, `job_title`, and `start_date`.
- Education requires `school` and `start_date`.
- `match` defaults to the corresponding values from `data`.
- At most five skills are used inside one Experience or Education entry.
- Skills are add-only; `target_count` must be 95–103 and defaults to 100.
- Open to Work can be enabled or updated but is not disabled by V1.
- Names, profile location/postal code, photo, cover, and unsupported sections
  are ignored with a warning.
