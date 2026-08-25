import { nullableString, nullableWorkplace, strictObject, stringList, yearMonth } from './schema-helpers.ts'

const experience = strictObject({
  company: { type: 'string' },
  job_title: { type: 'string' },
  start_date: yearMonth,
  end_date: yearMonth,
  location: nullableString,
  workplace_type: nullableWorkplace,
  achievements: stringList,
  responsibilities: stringList,
  technologies: stringList,
  evidence: { type: 'string', maxLength: 500 }
})
const education = strictObject({
  school: { type: 'string' },
  degree: nullableString,
  field_of_study: nullableString,
  start_date: yearMonth,
  end_date: yearMonth,
  grade: nullableString,
  activities: nullableString,
  evidence: { type: 'string', maxLength: 500 },
  is_higher_education: { type: 'boolean' }
})

export const CV_FACTS_SCHEMA = strictObject({
  target_roles: stringList,
  years_experience: { type: ['number', 'null'], minimum: 0, maximum: 80 },
  contact_email: nullableString,
  contact_phone: nullableString,
  industries: stringList,
  skills: stringList,
  experience: { type: 'array', items: experience },
  education: { type: 'array', items: education }
})
