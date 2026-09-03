export type ProfileFillerMarket = 'Ru' | 'En'

export type ProfileFillerJobStatus =
  | 'pending'
  | 'dry_run_passed'
  | 'completed'
  | 'failed'
  | 'exhausted'
  | 'cancelled'

export type ObservedClientState = {
  status: string
  updatedAt?: string
}

export type ProfileFillerJob = {
  id: string
  clientId: number
  clientName: string
  market: ProfileFillerMarket
  transitionAt: string
  createdAt: string
  updatedAt: string
  status: ProfileFillerJobStatus
  attemptCount: number
  nextAttemptAt?: string
  lastErrorCode?: string
  lastErrorMessage?: string
  dryRunArtifact?: string
  resultArtifact?: string
}

export type ProfileFillerState = {
  version: 1
  watermark: string
  initializedAt?: string
  observedClients: Record<string, ObservedClientState>
  jobs: ProfileFillerJob[]
}

export type ContactData = {
  email?: string
  phone?: string
  telegram?: string
  linkedin?: string
  other: string[]
}

export type CvExperience = {
  company: string
  title: string
  startDate?: string
  endDate?: string
  current: boolean
  location?: string
  description: string
  technologies: string[]
  namedOrganizations: string[]
}

export type CvEducation = {
  institution: string
  degree?: string
  specialization?: string
  graduationYear?: number
  description?: string
}

export type CvLanguage = {
  name: string
  level: string
}

export type CvSkillGroup = {
  category?: string
  items: string[]
  sourceText?: string
}

export type CvProfile = {
  language: 'ru' | 'en'
  fullName?: string
  firstName?: string
  lastName?: string
  middleName?: string
  birthDate?: string
  location?: string
  position?: string
  contacts: ContactData
  summary?: string
  skillGroups: CvSkillGroup[]
  skills: string[]
  experience: CvExperience[]
  education: CvEducation[]
  languages: CvLanguage[]
  namedOrganizations: string[]
}

export type ResolvedClient = {
  clientId: number
  clientName: string
  currentStatus: string
  market: ProfileFillerMarket
  stack: string
  dolphinProfileId: number
  cvUrl: string
  cvRevision: string
  studentFolderUrl?: string
  contacts: ContactData
  fallbacks: {
    fullName?: string
    firstName?: string
    lastName?: string
    birthDate?: string
    location?: string
    education?: string
    englishLevel?: string
  }
  credentials: {
    login?: string
    password?: string
  }
}

export type EmployerCandidate = {
  name: string
  sources: string[]
}

export type PreparedProfile = {
  client: ResolvedClient
  cv: CvProfile
  titles: string[]
  about: string
  employerCandidates: EmployerCandidate[]
  preparedAt: string
}

export type ProfileFillerResult = {
  ok: boolean
  dryRun: boolean
  jobId?: string
  clientId: number
  clientName: string
  market: ProfileFillerMarket
  dolphinProfileId?: number
  stage: string
  code?: string
  message: string
  attempt?: number
  artifactDir?: string
  createdResumeTitles?: string[]
  deletedResumeIds?: string[]
  stopList?: {
    added: string[]
    existing: string[]
    skipped: Array<{ name: string; reason: string }>
  }
}
