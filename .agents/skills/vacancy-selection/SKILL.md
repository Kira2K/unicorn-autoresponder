---
name: vacancy-selection
description: Apply shared vacancy-selection rules when collecting or classifying vacancies for external-responses. Use before saving accepted positions, without a student's CV. Does not submit applications or evaluate personal student restrictions.
---

# Vacancy selection rules

**Edit this file to change the rules for every vacancy and every stack.** Add rules as plain-language bullets below. The external-responses classifier reads this file automatically; no SQL rule configuration is needed.

## Deterministic title precheck

Recognize only the configured role families, then intersect their title routes with the existing populated SQL stacks selected for this run. An empty intersection is excluded before fetching details or requesting AI; it is not pending classification. Reject other posting titles with code before detail fetching or AI. Forward-deployed, AI product and other explicitly configured ambiguous engineering titles require description verification, not title-based acceptance. Routing is ordered: testing before operations/management, then FullStack/emerging and frontend, then explicit languages and generic engineering. All testers (including Python/Java QA, SDET, manual testing and automation engineers) are candidates for AQA stacks 13/18; fullstack, forward-deployed and AI engineering belong to FullStack 3. Frontend also routes to FullStack. SQL bindings are verified existing IDs, never invented stacks; descriptions remain required by campaign preflight. PHP/C++ have no configured stack and cannot fall back to generic engineering. Multiple languages within the same route group retain every selected match. A route is provisional, not eligibility: only full-description acceptance produces a canonical vacancy and final stack membership. Store provisional candidateStackIds in the existing collection audit, never a separate business table. Navigation controls are exempt only as links, never as posting titles. Shared seniority rules still apply.

```title-precheck-json
{
  "version": 1,
  "developmentStackIds": [
    "2",
    "3",
    "5",
    "7"
  ],
  "rules": [
    {
      "id": "advertised_level_below_middle",
      "reason": "The advertised position is explicitly junior, intern, trainee or graduate level.",
      "applicability": "all_stacks",
      "pattern": "^(?:(?:junior|jr\\.?|intern(?:ship)?|trainee|graduate)\\b(?!\\s*/\\s*(?:middle|mid(?:-level)?|senior)\\b)|(?:software|backend|front ?end|full ?stack|web|mobile|ios|android|java|python|go(?:lang)?|data)\\s+(?:engineer|developer)\\s+(?:intern|trainee))"
    },
    {
      "id": "advertised_level_above_senior",
      "reason": "The advertised position is explicitly above Senior or is engineering-management leadership.",
      "applicability": "all_stacks",
      "pattern": "^(?:(?:senior\\s+)?staff|principal|distinguished|lead|tech(?:nical)?\\s+lead|head\\s+of|director|vp\\b|chief)\\b|^(?:software|backend|front[ -]?end|full[ -]?stack|web|mobile|ios|android|java|python|go(?:lang)?|data|platform|cloud|devops|engineering|qa|sdet|aqa)(?:\\s+(?:software|engineering))?(?:\\s+(?:engineer|developer))?\\s+(?:tech(?:nical)?|team)\\s+lead\\b|^engineering\\s+manager\\b"
    },
    {
      "id": "training_course_not_vacancy",
      "reason": "This is an explicitly advertised training course or bootcamp, not a vacancy.",
      "applicability": "all_stacks",
      "pattern": "^(?:software\\s+qa\\s+engineering\\s+bootcamp|qa\\s+bundle:\\s*from\\s+zero\\s+to\\s+qa\\s+automation)\\s*$"
    }
  ],
  "families": [
    {
      "id": "development",
      "pattern": "^(?:(?:senior|sr\\.?|middle\\+?|mid[- ]?level|intermediate|junior\\s*/\\s*(?:middle\\s*/\\s*)?senior|junior\\s*/\\s*middle)\\s+)?(?:(?:software|back[ -]?end|front[ -]?end|full[ -]?stack|web|application|product|python|java(?:script)?|go(?:lang)?|typescript|node(?:\\.?js)?|react(?:\\.?js)?|\\.net|c\\+\\+|c#|ruby|rust|php|kotlin|scala)\\s*(?:/\\s*)?)+(?:engineer|developer|programmer)\\b|^(?:(?:senior|middle|mid-level)\\s+)?(?:developer|engineer)(?=$|\\s*[-(,/])"
    },
    {
      "id": "operations",
      "pattern": "^(?:(?:senior|sr\\.?|middle\\+?|mid[- ]?level|intermediate|junior\\s*/\\s*(?:middle\\s*/\\s*)?senior|junior\\s*/\\s*middle)\\s+)?(?:devops|sre|site\\s+reliability)(?:\\s+engineer)?\\b"
    },
    {
      "id": "testing",
      "pattern": "^(?:(?:senior|sr\\.?|middle\\+?|mid[- ]?level|intermediate)\\s+)?(?:(?:manual|software|full[ -]?stack|python|java|go(?:lang)?|automation)\\s+)*(?:qa|aqa|sdet|quality\\s+assurance|test\\s+automation|automation\\s+test|software\\s+test|tester|testers|testing|test)\\b|^(?:(?:senior|middle)\\s+)?(?:python|java)\\s+automation\\s+(?:engineer|tester)\\b"
    },
    {
      "id": "management",
      "pattern": "^(?:(?:senior|sr\\.?|middle\\+?|mid[- ]?level|intermediate|junior\\s*/\\s*(?:middle\\s*/\\s*)?senior|junior\\s*/\\s*middle)\\s+)?(?:technical\\s+)?(?:project|product)\\s+(?:manager|owner)\\b"
    },
    {
      "id": "emerging_engineering",
      "inspectDescription": true,
      "pattern": "^(?:(?:senior|sr\\.?|middle\\+?|mid[- ]?level|intermediate)\\s+)?(?:forward[ -]deployed(?:\\s+(?:software|ai))?|(?:applied\\s+)?ai(?:\\s*/\\s*(?:ml|llm)|[- ]enhanced)?(?:\\s+(?:product|software|platform|solutions|research))?|machine\\s+learning|ml|r&d|automation)\\s+(?:engineer|developer)\\b"
    }
  ],
  "navigationPattern": "^(?:view(?:\\s+(?:role|job|details|position))?|read\\s+more|learn\\s+more|apply(?:\\s+now)?|details|next(?:\\s+page)?|previous(?:\\s+page)?|show\\s+(?:more|all)|load\\s+more|more|\\d+|junior\\s+roles|team\\s+leads)$",
  "routing": [
    {
      "id": "testing",
      "rules": [
        {
          "pattern": "\\b(?:qa|aqa|sdet|tester|testers|testing|test|quality\\s+assurance|automation\\s+engineer)\\b",
          "stackIds": [
            "13",
            "18"
          ]
        }
      ]
    },
    {
      "id": "operations",
      "rules": [
        {
          "pattern": "\\b(?:devops|sre|site\\s+reliability)\\b",
          "stackIds": [
            "8"
          ]
        }
      ]
    },
    {
      "id": "management",
      "rules": [
        {
          "pattern": "\\b(?:project|product)\\s+(?:manager|owner)\\b",
          "stackIds": [
            "10"
          ]
        }
      ]
    },
    {
      "id": "fullstack_emerging",
      "rules": [
        {
          "pattern": "\\b(?:full[ -]?stack|forward[ -]deployed|ai|artificial\\s+intelligence|machine\\s+learning|ml)\\b|\\bproduct\\s+(?:engineer|developer)\\b",
          "stackIds": [
            "3"
          ]
        }
      ]
    },
    {
      "id": "frontend",
      "rules": [
        {
          "pattern": "\\b(?:front[ -]?end|react(?:\\.?js)?|vue(?:\\.?js)?|angular)\\b",
          "stackIds": [
            "3",
            "4"
          ]
        }
      ]
    },
    {
      "id": "explicit_language",
      "rules": [
        {
          "pattern": "\\bpython\\b",
          "stackIds": [
            "2"
          ]
        },
        {
          "pattern": "\\bjava\\b",
          "stackIds": [
            "5"
          ]
        },
        {
          "pattern": "\\bgo(?:lang)?\\b",
          "stackIds": [
            "7"
          ]
        },
        {
          "pattern": "\\b(?:javascript|typescript)\\b",
          "stackIds": [
            "3",
            "4",
            "11"
          ]
        },
        {
          "pattern": "\\bnode(?:\\.?js)?\\b",
          "stackIds": [
            "3",
            "11"
          ]
        },
        {
          "pattern": "\\brust\\b",
          "stackIds": [
            "12"
          ]
        },
        {
          "pattern": "\\bc#|\\.net\\b",
          "stackIds": [
            "6"
          ]
        },
        {
          "pattern": "\\b(?:php|ruby|kotlin|scala|swift|objective-c)\\b|\\bc\\+\\+|\\bc(?=\\s+(?:engineer|developer|programmer)\\b)",
          "stackIds": []
        }
      ]
    },
    {
      "id": "generic_backend",
      "rules": [
        {
          "pattern": "\\bback[ -]?end\\b",
          "stackIds": [
            "2",
            "5",
            "7",
            "6",
            "11",
            "12"
          ]
        }
      ]
    },
    {
      "id": "generic_software",
      "rules": [
        {
          "pattern": ".+",
          "stackIds": [
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "11",
            "12"
          ]
        }
      ]
    }
  ]
}
```

## Deterministic publication precheck

Apply this configuration before loading details when reliable listing publication evidence exists, and again before using a decision or saving a vacancy. Missing dates continue; ambiguous dates require inspection. Never treat updated/crawled timestamps as publication.

```publication-date-precheck-json
{
  "version": 1,
  "maxAgeUtcDays": 15,
  "rules": {
    "expired": {
      "id": "publication_older_than_15_utc_days",
      "reason": "The explicit publication date is older than 15 UTC calendar days."
    },
    "inspectionRequired": {
      "id": "publication_date_requires_inspection",
      "reason": "The supplied publication date is ambiguous, contradictory, invalid or in the future; inspect before deciding."
    }
  }
}
```

## Deterministic salary precheck

Use stated compensation and explicit salary text, without AI. Compare the upper bound after monthly gross USD normalization. Minimum-only offers cannot prove a below-floor upper bound. Missing salaries pass this check. Missing currency/period, net-to-gross basis, working hours or dated FX stay explicit data-review outcomes; never ask AI to invent them. Dated exchange rates can be injected into classification and are included in decision cache identity.

```salary-precheck-json
{"version":1,"minimumGrossMonthlyUsd":3000}
```

## Deterministic geography precheck

Executable country/region configuration for the geography rule below. Exact outside-area employee locations are excluded by code; unresolved restrictions remain reviewable. Missing employee geography passes when `missingGeography` is `allow`; this is a policy allowance, not verified worldwide availability. Passing this check never establishes stack eligibility. Country names come from local CLDR data.

```geography-precheck-json
{"version":1,"allowedCountryCodes":["AD","AL","AM","AT","AX","AZ","BA","BE","BG","BY","CH","CY","CZ","DE","DK","EE","ES","FI","FO","FR","GB","GE","GG","GI","GR","HR","HU","IE","IM","IS","IT","JE","KG","KZ","LI","LT","LU","LV","MC","MD","ME","MK","MT","NL","NO","PL","PT","RO","RS","RU","SE","SI","SJ","SK","SM","TJ","TM","TR","UA","UZ","VA","XK"],"allowedRegions":["Europe","European Region","European Union","European Economic Area","EU","EEA","CIS"],"excludedRegions":["North America","Northern America","Latin America","South America","Oceania","Africa"],"worldwideLabels":["Worldwide","Global","Anywhere in the world"],"countryAliases":{"USA":"US","United States of America":"US","UK":"GB","Great Britain":"GB","Turkey":"TR","Türkiye":"TR","Russian Federation":"RU","Republic of Moldova":"MD","Czech Republic":"CZ","South Korea":"KR","North Korea":"KP","UAE":"AE"},"missingGeography":"allow","unspecifiedLocationLabels":["Remote","Fully remote","Remote only","100% remote"]}
```

## Rules

- Decide from the vacancy description and explicit employer/source facts. Never use a student's CV, experience, contacts or personal preferences for this shared decision.
- Reject clear rule violations. Missing framework names, absent optional requirements and unclear workload percentages alone do not require review: accept an otherwise suitable role. Missing substantive descriptions, contradictory facts or an unavailable assessment still require review.
- Require a substantive job description. A title or an unverified snippet alone is insufficient.
- If a publication date is provided, reject postings older than 15 calendar days at assessment time; exactly 15 days old still passes this rule. Compare UTC dates. No publication date alone is not a reason to reject or require review. Use an explicit publication date/datePosted or a posted-age label anchored to its original observation date, never an update, crawl or last-seen timestamp as publication. Ambiguous or contradictory supplied dates require review rather than an invented date. Recalculate date eligibility with code as time advances. Reuse unchanged semantic assessments only when all relevant metadata, rules, stack descriptions, extraction and assessment policy still match; a new day alone does not require AI.
- Do not invent additional restrictions. Stack-specific requirements come from the existing stack descriptions and are evaluated separately after these shared rules pass.
- If neither the posting location nor the full description specifies employee work/residence geography, pass the geography filter. A bare Remote/Fully remote/Remote only/100% remote label specifies work mode, not geography, so it also passes unless the description restricts location. Do not require location evidence, ask a location question or defer the vacancy solely because geography is missing. This does not assert worldwide hiring permission or waive other selection rules. Unrecognized supplied locations and explicit ambiguous/contradictory restrictions are not missing information and still require review.
- Allowed employee work/residence geography is geographical Europe plus Cyprus, Armenia, Turkey (Türkiye), Georgia and the CIS region. For this search policy, explicitly allow Armenia, Azerbaijan, Belarus, Kazakhstan, Kyrgyzstan, Moldova, Russia, Tajikistan, Turkmenistan and Uzbekistan, as well as Georgia, Turkey and Ukraine; this is an operational country allowlist, not a claim about current formal CIS membership. Exclude a vacancy only when its mandatory employee work/residence location is restricted entirely outside this allowed area, whether remote, hybrid or on-site. Europe means the continent, not EU membership; the named countries are explicit additions regardless of continent. Yerevan, Istanbul, Tbilisi and Almaty pass geography. US-only remote, India-only and Singapore-only work still fail. Worldwide remote work passes even when the employer is headquartered outside the allowed area. Where several alternative locations are allowed, an explicit allowed-area or worldwide option passes. Company background/headquarters and time-zone overlap do not by themselves impose employee-location restrictions; a generic remote label does not prove worldwide availability or an exclusion. Ambiguous mandatory geography requires review. Passing geography does not waive stack, salary, date, seniority or other shared rules.
- An explicit stored rule for a particular student may override only this default geography filter for that student. Keep default geography exclusions in the audit so they can be reconsidered in a separately scoped exception review; do not silently admit them to the default shared pool. An override does not waive other shared/stack rules or establish that the student meets the employer's actual location/work-authorization requirements. Generic positive-answer defaults are not a geography override.
- Never open LinkedIn or lnkd.in, including redirects. A LinkedIn-only source cannot supply a verified posting.
- Retain only vacancies that pass these rules and match at least one selected existing stack with students. Save their complete text without image/video payloads. Rejected and review-only findings belong in the audit, not the vacancy table.
- Reject stated compensation only when its comparable upper bound is below USD 3,000 gross per month. A USD 2,500–4,000/month range passes because its upper bound reaches the floor. No stated salary does not reject a role.
- Normalize annual gross pay by dividing by 12; weekly pay by multiplying by 52/12; hourly/daily pay using stated working hours/days and 52/12. Convert non-USD currencies with a recorded dated exchange rate. Use the salary arithmetic helper when structured values are available. Do not invent working hours, currency rates or a net-to-gross tax rate; an unresolvable stated amount is review, not a guessed exclusion or pass.
- Reject positions whose own level is junior, intern, trainee or equivalent. Mentoring junior engineers, working with interns, or describing teammates does not make the advertised position junior. If the posting does not specify such a level, do not reject solely for that reason.
- Exclude AQA, SDET and test-automation/QA positions from the Java/Python development stacks. A developer's ordinary responsibility to write tests does not make the position AQA.
- Missing framework names are allowed for otherwise suitable Java/Python backend roles. Enforce explicit framework conflicts and exclusions from the DB descriptions, including Django-heavy work.
- Estimate workload from responsibilities; never require percentages in the posting. Unclear proportions alone pass without review. Python ML-focused titles (ML/Machine Learning Engineer, Data Scientist or equivalent) are excluded; clear violations of the configured backend/ML limits remain exclusions.
- Market belongs to the vacancy description: English means Global; Russian means Ru. Company jurisdiction, domain, founder nationality and work location cannot override description language. Other/ambiguous languages remain explicit rather than inheriting the old company default.
- Senior is the maximum allowed level. Reject positions above Senior during collection, including Staff, Senior Staff, Principal, Distinguished, Lead/Tech Lead and engineering-management leadership roles. Do not save them to the vacancy table or defer their rejection to student matching; retain exclusions only in the audit. This replaces the previous higher-title exception: a student's CV or seniority permission does not override this shared ceiling. Judge the advertised position's own level, not mentions of senior colleagues, mentoring or leading an individual project. Middle and unlevelled roles remain subject to the selected stack's rules.
