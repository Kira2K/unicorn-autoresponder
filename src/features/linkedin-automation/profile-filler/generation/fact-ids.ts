import type { CvFacts } from './types.ts'

export function assignFactIds(facts: CvFacts): CvFacts {
  return {
    ...facts,
    experience: facts.experience.map((item, index) => ({ ...item, fact_id: `exp_${index + 1}` })),
    education: facts.education.map((item, index) => ({ ...item, fact_id: `edu_${index + 1}` }))
  }
}

export function experienceFactId(index: number, value?: { fact_id?: string }) {
  return value?.fact_id ?? `exp_${index + 1}`
}

export function educationFactId(index: number, value?: { fact_id?: string }) {
  return value?.fact_id ?? `edu_${index + 1}`
}
