import type { CvEducation, CvProfile, EmployerCandidate, PreparedProfile,
  ResolvedClient } from './types.ts'
import { titlesForStack } from './stack-titles.ts'
import { profileFillerError } from './errors.ts'

function first<T>(...values: Array<T | undefined | null>): T | undefined {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '') ?? undefined
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter(value => {
    const key = value.trim().toLowerCase().replace(/ё/g, 'е')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function nocoEducation(value?: string): CvEducation[] {
  if (!value) return []
  try {
    const rows = JSON.parse(value)
    if (Array.isArray(rows)) return rows.flatMap(row => {
      const institution = String(row?.uni ?? row?.institution ?? '').trim()
      if (!institution) return []
      const year = Number(row?.yearOfEnd ?? row?.graduationYear)
      return [{ institution,
        degree: String(row?.grade ?? row?.degree ?? '').trim() || undefined,
        specialization: String(row?.faculty ?? row?.specialization ?? '').trim() || undefined,
        graduationYear: Number.isInteger(year) && year > 1900 ? year : undefined }]
    })
  } catch {
    // Fall back to the human-readable Noco field without inventing structure.
  }
  const yearMatch = value.match(/(?:19|20)\d{2}/)
  const parts = value.split(',').map(item => item.trim()).filter(Boolean)
  return [{ institution: parts[0] || value.trim(),
    specialization: parts.slice(1).filter(item => !/(?:19|20)\d{2}/.test(item)).join(', ') || undefined,
    graduationYear: yearMatch ? Number(yearMatch[0]) : undefined }]
}

function contactsLine(profile: CvProfile): string {
  return [profile.contacts.email, profile.contacts.phone,
    profile.contacts.telegram && (/^@/.test(profile.contacts.telegram)
      ? `tg: ${profile.contacts.telegram}` : profile.contacts.telegram),
    profile.contacts.linkedin, ...profile.contacts.other, profile.location]
    .filter(Boolean).join(' | ')
}

function skillsBlock(profile: CvProfile): string {
  if (profile.skillGroups.length) {
    return profile.skillGroups.map(group => group.sourceText ||
      `${group.category ? `${group.category}: ` : ''}${group.items.join(', ')}`).join('\n')
  }
  return profile.skills.join(', ')
}

function buildAbout(profile: CvProfile): string {
  const ru = profile.language === 'ru'
  const sections: string[] = []
  const contacts = contactsLine(profile)
  if (contacts) sections.push(`${ru ? 'Контакты' : 'Contacts'}\n${contacts}`)
  if (profile.summary) sections.push(`${ru ? 'О себе' : 'Summary'}\n${profile.summary}`)
  const skills = skillsBlock(profile)
  if (skills) sections.push(`${ru ? 'Навыки' : 'Skills'}\n${skills}`)
  return sections.join('\n\n')
}

function employers(profile: CvProfile): EmployerCandidate[] {
  const sources = new Map<string, { name: string; sources: Set<string> }>()
  const add = (name: string, source: string) => {
    const key = name.trim().toLowerCase().replace(/ё/g, 'е')
    if (!key) return
    const existing = sources.get(key) ?? { name: name.trim(), sources: new Set<string>() }
    existing.sources.add(source)
    sources.set(key, existing)
  }
  for (const item of profile.experience) {
    add(item.company, 'cv:experience')
    for (const name of item.namedOrganizations) add(name, 'cv:experience-context')
  }
  for (const name of profile.namedOrganizations) add(name, 'cv-or-self-presentation')
  return [...sources.values()].map(item => ({ name: item.name, sources: [...item.sources] }))
}

export function buildPreparedProfile(client: ResolvedClient, extracted: CvProfile,
  now = new Date().toISOString()): PreparedProfile {
  const profile: CvProfile = {
    ...extracted,
    fullName: first(extracted.fullName, client.fallbacks.fullName),
    firstName: first(extracted.firstName, client.fallbacks.firstName),
    lastName: first(extracted.lastName, client.fallbacks.lastName),
    birthDate: first(extracted.birthDate, client.fallbacks.birthDate),
    location: client.market === 'En' ? 'Tbilisi, Georgia' :
      first(extracted.location, client.fallbacks.location),
    contacts: {
      email: first(extracted.contacts.email, client.contacts.email),
      phone: first(extracted.contacts.phone, client.contacts.phone),
      telegram: first(extracted.contacts.telegram, client.contacts.telegram),
      linkedin: first(extracted.contacts.linkedin, client.contacts.linkedin),
      other: unique([...extracted.contacts.other, ...client.contacts.other])
    },
    education: extracted.education.length ? extracted.education :
      nocoEducation(client.fallbacks.education),
    languages: extracted.languages.some(item => /english|англий/i.test(item.name)) ||
      !client.fallbacks.englishLevel ? extracted.languages : [...extracted.languages, {
        name: extracted.language === 'ru' ? 'Английский' : 'English',
        level: client.fallbacks.englishLevel
      }]
  }
  const prepared = {
    client,
    cv: profile,
    titles: titlesForStack(client.stack, client.market),
    about: buildAbout(profile),
    employerCandidates: employers(profile),
    preparedAt: now
  }
  if (!profile.contacts.email) {
    throw profileFillerError('profile_email_missing',
      `No email is available for ${client.clientName}.`, 'prepare_profile')
  }
  if (!profile.summary || !prepared.about) {
    throw profileFillerError('profile_about_missing',
      `The final CV has no About/Summary for ${client.clientName}.`, 'prepare_profile')
  }
  if (!profile.experience.length) {
    throw profileFillerError('profile_experience_missing',
      `The final CV has no employment history for ${client.clientName}.`, 'prepare_profile')
  }
  return prepared
}
