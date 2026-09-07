export type CvExperienceFact = {
  fact_id?: string
  company: string
  job_title: string
  start_date: string | null
  end_date: string | null
  location: string | null
  workplace_type: 'ON_SITE' | 'HYBRID' | 'REMOTE' | null
  achievements: string[]
  responsibilities: string[]
  technologies: string[]
  evidence: string
}

export type CvEducationFact = {
  fact_id?: string
  school: string
  degree: string | null
  field_of_study: string | null
  start_date: string | null
  end_date: string | null
  grade: string | null
  activities: string | null
  evidence: string
  is_higher_education: boolean
}

export type CvFacts = {
  target_roles: string[]
  years_experience: number | null
  contact_email: string | null
  contact_phone: string | null
  industries: string[]
  skills: string[]
  experience: CvExperienceFact[]
  education: CvEducationFact[]
}

export type GenerationMetadata = {
  model: string
  guideRevision: string
  cvRevision: string
  proxyCountry: string
  generatedAt: string
}

export type GenerationCheckpoint = {
  version: 1
  stage: 'resolving_job_titles'
  profile: import('../input-types.ts').ProfileInput
  issues: import('../input-types.ts').ValidationIssue[]
  generation: GenerationMetadata
  catalogParameters?: import('../parameter-search.ts').ParameterSearchCache
  retry?: { provider: 'unipile'; attempt: number; nextRetryAt?: string }
}

export type JobTitleCandidate = { id: string; name: string }
export type JobTitleChoiceRequest = {
  index: number
  requested: string
  candidates: JobTitleCandidate[]
}
export type JobTitleChoice = { index: number; candidateId: string | null; confident: boolean }

export type CvDocument = {
  bytes: Buffer
  fileName: string
  mimeType: 'application/pdf' |
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  revision: string
}
