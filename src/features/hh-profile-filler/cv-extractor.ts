import { profileFillerError } from './errors.ts'
import type { CvProfile, ProfileFillerMarket } from './types.ts'
import type { SourceDocument } from './drive-source.ts'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
type ExtractorClient = {
  upload(bytes: Buffer, fileName: string, mimeType: string): Promise<string>
  respond(input: unknown, schemaName: string, schema: unknown,
    instructions: string, maxOutputTokens?: number): Promise<any>
  remove(fileId: string): Promise<void>
}

const nullableString = { type: ['string', 'null'] }
const stringArray = { type: 'array', items: { type: 'string' } }
function strictObject(properties: Record<string, unknown>) {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties }
}

const CV_SCHEMA = strictObject({
  full_name: nullableString,
  first_name: nullableString,
  last_name: nullableString,
  middle_name: nullableString,
  birth_date: nullableString,
  location: nullableString,
  position: nullableString,
  contacts: strictObject({
    email: nullableString,
    phone: nullableString,
    telegram: nullableString,
    linkedin: nullableString,
    other: stringArray
  }),
  summary: nullableString,
  skill_groups: {
    type: 'array',
    items: strictObject({ category: nullableString, items: stringArray, source_text: nullableString })
  },
  skills: stringArray,
  experience: {
    type: 'array',
    items: strictObject({
      company: { type: 'string' }, title: { type: 'string' },
      start_date: nullableString, end_date: nullableString, current: { type: 'boolean' },
      location: nullableString, description: { type: 'string' }, technologies: stringArray,
      named_organizations: stringArray
    })
  },
  education: {
    type: 'array',
    items: strictObject({ institution: { type: 'string' }, degree: nullableString,
      specialization: nullableString, graduation_year: { type: ['integer', 'null'] },
      description: nullableString })
  },
  languages: {
    type: 'array',
    items: strictObject({ name: { type: 'string' }, level: { type: 'string' } })
  },
  named_organizations: stringArray
})

const EXTRACTION_INSTRUCTIONS = `Extract an HH resume profile from the attached final CV and optional
documents named Самопрезентация. Preserve the CV language, wording, dates, metrics, responsibilities,
skills and contacts. Never invent or improve facts. The summary must contain only the CV's about/summary
text, without contacts or the skills block. Preserve skill categories and their source wording.
Collect every explicitly named employer, brand owner, product organization, vendor, customer and partner
into named_organizations; include employers from experience. A product or brand name may be included when
it is explicitly named. Evidence is the attached files only.`

function optionalText(value: unknown): string | undefined {
  const result = String(value ?? '').trim()
  return result || undefined
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(optionalText).filter(Boolean) as string[] : []
}

function assertProfile(value: any, market: ProfileFillerMarket): CvProfile {
  if (!value || typeof value !== 'object' || !Array.isArray(value.experience) ||
    !Array.isArray(value.education) || !Array.isArray(value.skills)) {
    throw profileFillerError('profile_cv_extraction_invalid',
      'The CV extractor returned an invalid profile.', 'extract_cv')
  }
  return {
    language: market === 'Ru' ? 'ru' : 'en',
    fullName: optionalText(value.full_name), firstName: optionalText(value.first_name),
    lastName: optionalText(value.last_name), middleName: optionalText(value.middle_name),
    birthDate: optionalText(value.birth_date), location: optionalText(value.location),
    position: optionalText(value.position),
    contacts: {
      email: optionalText(value.contacts?.email), phone: optionalText(value.contacts?.phone),
      telegram: optionalText(value.contacts?.telegram), linkedin: optionalText(value.contacts?.linkedin),
      other: stringList(value.contacts?.other)
    },
    summary: optionalText(value.summary),
    skillGroups: Array.isArray(value.skill_groups) ? value.skill_groups.map((group: any) => ({
      category: optionalText(group.category), items: stringList(group.items),
      sourceText: optionalText(group.source_text)
    })).filter((group: any) => group.items.length || group.sourceText) : [],
    skills: stringList(value.skills),
    experience: value.experience.map((item: any) => ({
      company: optionalText(item.company) ?? '', title: optionalText(item.title) ?? '',
      startDate: optionalText(item.start_date), endDate: optionalText(item.end_date),
      current: Boolean(item.current), location: optionalText(item.location),
      description: optionalText(item.description) ?? '', technologies: stringList(item.technologies),
      namedOrganizations: stringList(item.named_organizations)
    })).filter((item: any) => item.company && item.title),
    education: value.education.map((item: any) => ({
      institution: optionalText(item.institution) ?? '', degree: optionalText(item.degree),
      specialization: optionalText(item.specialization),
      graduationYear: Number.isInteger(item.graduation_year) ? item.graduation_year : undefined,
      description: optionalText(item.description)
    })).filter((item: any) => item.institution),
    languages: Array.isArray(value.languages) ? value.languages.map((item: any) => ({
      name: optionalText(item.name) ?? '', level: optionalText(item.level) ?? ''
    })).filter((item: any) => item.name && item.level) : [],
    namedOrganizations: stringList(value.named_organizations)
  }
}

export function createCvExtractor(options: {
  apiKey?: string
  model?: string
  client?: ExtractorClient
} = {}) {
  const apiKey = options.apiKey ?? String(process.env.OPENAI_HH_PROFILE_API_KEY ??
    process.env.OPENAI_LINKEDIN_PROFILE_API_KEY ?? '').trim()
  const model = options.model ?? String(process.env.OPENAI_HH_PROFILE_MODEL ??
    process.env.OPENAI_LINKEDIN_PROFILE_MODEL ?? '').trim()
  if (!options.client && (!apiKey || !model)) {
    throw profileFillerError('profile_openai_config_missing',
      'OPENAI_HH_PROFILE_API_KEY/model (or LinkedIn fallbacks) are required.', 'extract_cv')
  }
  const client = options.client ?? (() => {
    const { createOpenAiHttp } = require(
      '../linkedin-automation/profile-filler/generation/openai-http.ts'
    ) as { createOpenAiHttp(options: any): ExtractorClient }
    return createOpenAiHttp({ apiKey, model,
      timeoutMs: Number(process.env.OPENAI_HH_PROFILE_TIMEOUT_MS ?? 180_000),
      maxOutputTokens: Number(process.env.OPENAI_HH_PROFILE_MAX_OUTPUT_TOKENS ?? 24_000) })
  })()

  async function extract(documents: SourceDocument[], market: ProfileFillerMarket): Promise<CvProfile> {
    if (!documents.some(document => document.source === 'cv')) {
      throw profileFillerError('profile_cv_not_ready', 'A final CV is required.', 'extract_cv')
    }
    const uploaded: string[] = []
    try {
      for (const document of documents) {
        uploaded.push(await client.upload(document.bytes, document.fileName, document.mimeType))
      }
      const content: any[] = uploaded.map(fileId => ({ type: 'input_file', file_id: fileId }))
      content.push({ type: 'input_text', text:
        `Extract the ${market === 'Ru' ? 'Russian' : 'English'} HH profile. ` +
        'Documents after the first one are Самопрезентация sources used for organization extraction.' })
      const value = await client.respond([{ role: 'user', content }],
        'hh_profile_cv', CV_SCHEMA, EXTRACTION_INSTRUCTIONS)
      return assertProfile(value, market)
    } finally {
      await Promise.all(uploaded.map(fileId => client.remove(fileId).catch(() => undefined)))
    }
  }

  return { extract }
}
