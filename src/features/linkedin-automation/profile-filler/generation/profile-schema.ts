import { nullableString, strictObject, stringList } from './schema-helpers.ts'

const experience = strictObject({
  fact_id: { type: 'string', pattern: '^exp_[1-9][0-9]*$' },
  description: nullableString,
  skills: { ...stringList, minItems: 5, maxItems: 15 }
})

const education = strictObject({
  fact_id: { type: 'string', pattern: '^edu_[1-9][0-9]*$' },
  description: nullableString,
  skills: { ...stringList, minItems: 5, maxItems: 15 }
})

const openToWork = strictObject({
  job_titles: {
    type: 'array', minItems: 5, maxItems: 5,
    items: strictObject({ name: { type: 'string', minLength: 1 } })
  },
  workplace_types: {
    type: 'array', minItems: 3, maxItems: 3,
    items: { type: 'string', enum: ['REMOTE', 'HYBRID', 'ON_SITE'] }
  },
  locations: {
    type: 'array', minItems: 1, maxItems: 1,
    items: strictObject({ name: { type: 'string', minLength: 1 } })
  },
  start_date: { type: 'string', const: 'IMMEDIATELY' },
  employment_types: {
    type: 'array', minItems: 3, maxItems: 3,
    items: { type: 'string', enum: ['FULL_TIME', 'CONTRACT', 'PART_TIME'] }
  },
  visibility: { type: 'string', const: 'ALL' }
})

export const GENERATED_PROFILE_SCHEMA = strictObject({
  schema_version: { type: 'integer', const: 1 },
  profile: strictObject({
    headline: { type: 'string', maxLength: 220 },
    about_blocks: { type: 'array', minItems: 4, maxItems: 5,
      items: { type: 'string', minLength: 1, maxLength: 1000 } },
    skills: strictObject({
      add: { ...stringList, minItems: 100, maxItems: 100 },
      target_count: { type: 'integer', const: 100 }
    }),
    experience: { type: 'array', items: experience },
    education: { type: 'array', items: education },
    open_to_work: openToWork
  })
})
