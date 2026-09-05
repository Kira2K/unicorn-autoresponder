import type { ValidationIssue } from '../input-types.ts'
import { finalizeGeneratedOutput } from './clean-output.ts'
import { educationFactId, experienceFactId } from './fact-ids.ts'
import { reconcileSkillCandidates } from './skill-candidates.ts'
import type { CvFacts } from './types.ts'
import { indexEntries, normalizedEntries } from './entry-additions.ts'

const contractIssues = new WeakMap<object, ValidationIssue[]>()
const rawOutputs = new WeakMap<object, any>()

const date = (value: string | null) => value ?? undefined
const text = (value: unknown) => typeof value === 'string' ? value : undefined
const skills = (value: unknown) => Array.isArray(value)
  ? value.filter(item => typeof item === 'string') as string[] : []

export function materializeGeneratedProfile(raw: any, facts: CvFacts) {
  const cleaned = finalizeGeneratedOutput(structuredClone(raw)) as any
  const generatedProfile = cleaned?.profile ?? {}
  const generatedEntries = [
    ...normalizedEntries(generatedProfile.experience),
    ...normalizedEntries(generatedProfile.education)
  ]
  const profile = {
    ...generatedProfile,
    skills: generatedProfile.skills && typeof generatedProfile.skills === 'object'
      ? { ...generatedProfile.skills,
        add: reconcileSkillCandidates(generatedProfile.skills.add,
          generatedEntries.map(entry => entry.skills)) }
      : generatedProfile.skills
  }
  const reconciledRaw = { ...cleaned, profile }
  const experienceIds = new Set(facts.experience.map((item, index) => experienceFactId(index, item)))
  const educationFacts = facts.education
  const educationIds = new Set(educationFacts.map((item, index) =>
    item.fact_id ?? educationFactId(index, item)))
  const experience = indexEntries(normalizedEntries(profile.experience), experienceIds,
    'profile.experience')
  const education = indexEntries(normalizedEntries(profile.education), educationIds,
    'profile.education')
  const document = { schema_version: 1, profile: {
    headline: profile.headline,
    about: profile.about,
    skills: profile.skills,
    experience: facts.experience.map((fact, index) => {
      const addition = experience.result.get(experienceFactId(index, fact))
      return { action: 'upsert', match: {
        company: fact.company, job_title: fact.job_title, start_date: date(fact.start_date)
      }, data: {
        company: fact.company, job_title: fact.job_title, location: text(fact.location),
        workplace_type: fact.workplace_type ?? undefined, start_date: date(fact.start_date),
        end_date: date(fact.end_date), description: text(addition?.description),
        skills: skills(addition?.skills)
      } }
    }),
    education: educationFacts.map((fact, index) => {
      const addition = education.result.get(fact.fact_id ?? educationFactId(index, fact))
      return { action: 'upsert', match: {
        school: fact.school, start_date: date(fact.start_date)
      }, data: {
        school: fact.school, degree: text(fact.degree), field_of_study: text(fact.field_of_study),
        start_date: date(fact.start_date), end_date: date(fact.end_date), grade: text(fact.grade),
        activities: text(fact.activities), description: text(addition?.description),
        skills: skills(addition?.skills)
      } }
    }),
    open_to_work: profile.open_to_work
  } }
  contractIssues.set(document, [...experience.issues, ...education.issues])
  rawOutputs.set(document, structuredClone(reconciledRaw))
  return document
}

export function generatedContractIssues(value: unknown) {
  return value && typeof value === 'object' ? contractIssues.get(value as object) ?? [] : []
}

export function rawGeneratedOutput(value: unknown) {
  return value && typeof value === 'object' ? rawOutputs.get(value as object) : undefined
}
