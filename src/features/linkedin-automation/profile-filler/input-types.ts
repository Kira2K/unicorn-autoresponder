export type JsonObject = Record<string, unknown>

export type ValidationIssue = {
  level: 'warning' | 'fatal'
  path: string
  message: string
  resolution?: string
  suggestion?: string
  suggestions?: string[]
  autoFixed?: boolean
}

export type YearMonth = { year: number; month: number }
export type NamedParameter = { name: string; id?: string }

export type ExperienceData = {
  company: string
  jobTitle: string
  employmentType?: string
  location?: string
  workplaceType?: 'ON_SITE' | 'HYBRID' | 'REMOTE'
  startDate?: YearMonth
  endDate?: YearMonth
  description?: string
  sourceOfHire?: string
  skills: string[]
}

export type ExperienceUpsert = {
  match: { company: string; jobTitle: string; startDate?: YearMonth }
  data: ExperienceData
}

export type EducationData = {
  school: string
  degree?: string
  fieldOfStudy?: string
  startDate?: YearMonth
  endDate?: YearMonth
  grade?: string
  activities?: string
  description?: string
  skills: string[]
}

export type EducationUpsert = {
  match: { school: string; startDate?: YearMonth }
  data: EducationData
}

export type OpenToWorkInput = {
  jobTitles: NamedParameter[]
  workplaceTypes: Array<'ON_SITE' | 'HYBRID' | 'REMOTE'>
  locations: NamedParameter[]
  startDate?: 'IMMEDIATELY' | 'FLEXIBLE'
  employmentTypes: Array<'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERNSHIP' | 'TEMPORARY'>
  visibility: 'ALL' | 'RECRUITERS_ONLY'
}

export type ProfileInput = {
  schemaVersion: 1
  headline?: string
  about?: string
  skills: { add: string[]; targetCount: number }
  experience: ExperienceUpsert[]
  education: EducationUpsert[]
  openToWork?: OpenToWorkInput
}

export type ValidationResult = { value?: ProfileInput; issues: ValidationIssue[]; normalized?: JsonObject }
