export const MCP_ENUMS = {
  workplaceType: ['ON_SITE', 'HYBRID', 'REMOTE'],
  employmentType: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY'],
  startDate: ['IMMEDIATELY', 'FLEXIBLE'],
  visibility: ['ALL', 'RECRUITERS_ONLY'],
  sourceOfHire: ['INDEED', 'LINKEDIN', 'COMPANY_WEBSITE', 'OTHER_JOB_SITES',
    'REFERRAL', 'CONTACTED_BY_RECRUITER', 'STAFFING_AGENCY', 'OTHER']
} as const

export const ENTRY_FIELDS = {
  experience: {
    company: ['company_name', 'employer'], job_title: ['jobTitle', 'title', 'position'],
    location: ['city'], workplace_type: ['workplaceType', 'presence'], description: ['summary'],
    source_of_hire: ['sourceOfHire']
  },
  education: {
    school: ['university', 'institution'], degree: ['degree_name'],
    field_of_study: ['fieldOfStudy', 'field'], grade: [],
    activities: ['activities_and_societies'], description: ['summary']
  }
} as const

export const PAYLOAD_FIELDS = {
  experience: ['operation', 'id', 'notify_network', 'job_title', 'company', 'location',
    'workplace_type', 'start_date', 'end_date', 'description',
    'source_of_hire', 'skills'],
  education: ['operation', 'id', 'notify_network', 'school', 'degree', 'field_of_study',
    'start_date', 'end_date', 'grade', 'activities', 'description', 'skills']
} as const

export const CATALOG_TYPES = ['LOCATION', 'COMPANY', 'SCHOOL', 'JOB_TITLE', 'SKILL'] as const
export type CatalogType = typeof CATALOG_TYPES[number]

export const REQUIRED_ID_FIELDS = {
  openToWorkJobTitle: 'JOB_TITLE',
  openToWorkLocation: 'LOCATION'
} as const satisfies Record<string, CatalogType>

export const MCP_ENTRY_REQUIRED = {
  experience: { create: ['operation', 'job_title', 'company', 'start_date'], edit: ['operation', 'id'] },
  education: { create: ['operation', 'school', 'start_date'], edit: ['operation', 'id'] }
} as const

export const MCP_PROFILE_SKILLS_LIMIT = 100

export const MCP_WRITE_ORDER = [
  'headline', 'about', 'experience-update', 'experience-create',
  'education-update', 'education-create', 'skills', 'open_to_work'
] as const
