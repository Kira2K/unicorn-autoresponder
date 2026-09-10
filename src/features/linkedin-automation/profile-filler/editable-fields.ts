import { MCP_ENUMS } from './mcp-contract.ts'

export const editableFields: Record<string, string[]> = {
  headline: ['headline'], about: ['about'], skills: ['add'],
  experience: ['company', 'job_title', 'start_date', 'end_date', 'location', 'workplace_type', 'description', 'skills', 'source_of_hire'],
  education: ['school', 'degree', 'field_of_study', 'start_date', 'end_date', 'grade', 'activities', 'description', 'skills'],
  open_to_work: ['job_titles', 'locations', 'workplace_types', 'employment_types', 'start_date', 'visibility']
}
export const fieldChoices: Record<string, string[]> = {
  workplace_type: [...MCP_ENUMS.workplaceType], workplace_types: [...MCP_ENUMS.workplaceType],
  employment_types: [...MCP_ENUMS.employmentType], visibility: [...MCP_ENUMS.visibility],
  source_of_hire: [...MCP_ENUMS.sourceOfHire]
}
export const listFields = new Set(['add', 'skills', 'job_titles', 'locations', 'workplace_types', 'employment_types'])
export function editableField(path: string) {
  const match = /^profile\.(experience|education)\[(\d+)\]\.data\.([a-z_]+)$/.exec(path) ??
    /^profile\.(headline|about|skills|open_to_work)(?:\.([a-z_]+))?$/.exec(path)
  if (!match) return undefined
  const section = match[1]
  const indexed = section === 'experience' || section === 'education'
  const key = indexed ? match[3] : match[2] ?? section
  if (['headline', 'about'].includes(section) && match[2]) return undefined
  if (!editableFields[section]?.includes(key)) return undefined
  return { section, key, index: indexed ? Number(match[2]) : undefined }
}
