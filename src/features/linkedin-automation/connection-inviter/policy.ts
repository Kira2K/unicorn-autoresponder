import type { ConnectionSearchTemplate, SearchAudience } from './catalog.ts'
import { networkDistance, relationBlocks } from './relation-policy.ts'

export type ParsedCandidate = {
  personId: string
  name: string
  headline: string
  location: string
  profileUrl?: string
  distance?: number
  raw: any
}

export type CandidateRoleCategory = 'recruiting' | 'hr_people' | 'technical' | 'non_matching'
export type CandidatePolicyEvaluation = {
  decision: 'eligible' | 'skip'
  eligible: boolean
  reasonCode: string
  hardReasons: string[]
  softSignals: string[]
  roleCategory: CandidateRoleCategory
  evidence: {
    locationMatch: 'exact' | 'alias' | 'outside' | 'missing'
    stackEvidence: 'not_applicable' | 'headline' | 'search_only'
    hasName: boolean
    hasHeadline: boolean
    networkDistance?: number
  }
}

const text = (value: unknown) => String(value ?? '').normalize('NFKC').trim()
const lower = (value: unknown) => text(value).toLocaleLowerCase('und')
const folded = (value: unknown) => lower(value).normalize('NFKD')
  .replace(/\p{M}+/gu, '').replace(/[\u2019']/g, "'")

export function parseConnectionCandidate(value: any): ParsedCandidate {
  const personId = text(value?.provider_id ?? value?.user_id ?? value?.id ?? value?.member_id)
  const name = text(value?.display_name ?? value?.name ??
    [value?.first_name, value?.last_name].filter(Boolean).join(' '))
  const headline = text(value?.headline ?? value?.occupation ?? value?.current_position?.title)
  const location = text(value?.location ?? value?.location_name ?? value?.geo_location)
  const profileUrl = text(value?.profile_url ?? value?.public_profile_url) || undefined
  const distance = networkDistance(value?.network_distance ?? value?.connection_degree ?? value?.distance)
  return { personId, name, headline, location, profileUrl,
    ...(distance ? { distance } : {}), raw: value }
}

const RECRUITING = /(?:\b(?:recruit(?:er|ment|ing)?|talent(?:\s+(?:acquisition|partner|management|development))?|sourc(?:er|ing)|staffing|headhunt(?:er|ing)?)\b|\u0440\u0435\u043a\u0440\u0443\u0442(?:\u0435\u0440|\u0438\u043d\u0433)?|\u043f\u043e\u0434\u0431\u043e\u0440\s+\u043f\u0435\u0440\u0441\u043e\u043d\u0430\u043b\u0430|\u0441\u043f\u0435\u0446\u0438\u0430\u043b\u0438\u0441\u0442\s+\u043f\u043e\s+\u043f\u043e\u0434\u0431\u043e\u0440\u0443|\u043f\u0456\u0434\u0431\u0456\u0440\s+\u043f\u0435\u0440\u0441\u043e\u043d\u0430\u043b\u0443|recrutement|recrutador|recrutamento|reclutamiento|reclutador|selecci[o\u00f3]n\s+de\s+personal|rekrutacj[ai]|rekruter|personalbeschaffung)/iu
const HR_PEOPLE = /(?:\b(?:hr|hrbp|human\s+resources|hr\s+business\s+partner|people\s+(?:partner|operations|ops)|people\s*(?:&|and)\s*culture|(?:head|chief)\s+of\s+people|chief\s+people\s+officer)\b|\u044d\u0439\u0447\u0430\u0440|\u0443\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438[\u0435\u044f]\s+\u043f\u0435\u0440\u0441\u043e\u043d\u0430\u043b\u043e\u043c|\u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440\s+\u043f\u043e\s+\u043f\u0435\u0440\u0441\u043e\u043d\u0430\u043b\u0443|\u043a\u0430\u0434\u0440\u043e\u0432(?:\u044b\u0439|\u0438\u043a|\u043e\u0435)|\u043b\u044e\u0434\u0438\s+\u0438\s+\u043a\u0443\u043b\u044c\u0442\u0443\u0440\u0430|recursos\s+humanos|ressources\s+humaines|personalwesen|risorse\s+umane)/iu
const TECHNICAL = /(?:\b(?:developer|engineer|engineering|qa|quality\s+assurance|tester|testing|automation|architect|analyst|data\s+scientist)\b|\u0440\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u0447\u0438\u043a|\u0438\u043d\u0436\u0435\u043d\u0435\u0440|\u0442\u0435\u0441\u0442\u0438\u0440\u043e\u0432\u0449\u0438\u043a|\u0430\u043d\u0430\u043b\u0438\u0442\u0438\u043a|\u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u043e\u0440|\u043f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u0438\u0441\u0442)/iu

function roleCategory(headline: string, audience: SearchAudience): CandidateRoleCategory {
  if (audience === 'recruiter') {
    if (RECRUITING.test(headline)) return 'recruiting'
    if (HR_PEOPLE.test(headline)) return 'hr_people'
    return 'non_matching'
  }
  return TECHNICAL.test(headline) ? 'technical' : 'non_matching'
}

function stackTokens(stack: string): string[] {
  const normalized = folded(stack)
  const aliases: Record<string, string[]> = {
    frontend: ['frontend', 'front-end', 'react', 'javascript', 'typescript', '\u0444\u0440\u043e\u043d\u0442\u0435\u043d\u0434'],
    react: ['react', 'frontend', 'front-end', 'javascript', 'typescript'],
    fullstack: ['fullstack', 'full-stack', 'full stack', 'javascript', 'typescript'],
    python: ['python', 'django', 'fastapi', '\u043f\u0438\u0442\u043e\u043d'],
    java: ['java', 'spring', '\u0434\u0436\u0430\u0432\u0430'],
    go: ['golang', 'go engineer', 'go developer'],
    qa: ['qa', 'quality assurance', 'tester', 'testing'],
    data: ['data', 'analytics', 'analyst', 'data scientist', 'machine learning']
  }
  const compact = normalized.replace(/[^a-z0-9]+/g, '')
  return [...new Set([normalized, ...(aliases[compact] ?? [])])].filter(Boolean)
}

const CITY_ALIASES: Record<string, string[]> = {
  moscow: ['moskva', '\u043c\u043e\u0441\u043a\u0432\u0430'],
  vienna: ['wien'], munich: ['munchen', 'muenchen', 'm\u00fcnchen'], prague: ['praha'],
  kyiv: ['kiev', '\u043a\u0438\u0457\u0432', '\u043a\u0438\u0435\u0432'],
  beijing: ['\u5317\u4eac'], tokyo: ['\u6771\u4eac'], seoul: ['\uc11c\uc6b8'],
  bangalore: ['bengaluru'], chisinau: ['chi\u0219in\u0103u', 'kishinev', '\u043a\u0438\u0448\u0438\u043d\u0451\u0432'],
  yerevan: ['\u0435\u0440\u0435\u0432\u0430\u043d'], tbilisi: ['\u0442\u0431\u0438\u043b\u0438\u0441\u0438'],
  almaty: ['\u0430\u043b\u043c\u0430\u0442\u044b']
}

function locationMatch(location: string, city: string): CandidatePolicyEvaluation['evidence']['locationMatch'] {
  if (!location) return 'missing'
  const normalizedLocation = folded(location)
  const normalizedCity = folded(city)
  if (normalizedLocation.includes(normalizedCity)) return 'exact'
  const aliases = CITY_ALIASES[normalizedCity] ?? []
  return aliases.some(alias => normalizedLocation.includes(folded(alias))) ? 'alias' : 'outside'
}

const stablePersonId = (value: string) => value.length >= 3 && !/\s|https?:\/\//iu.test(value)
const meaningfulHeadline = (value: string) => (value.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2

export function evaluateCandidate(candidate: ParsedCandidate, template: ConnectionSearchTemplate,
  stack: string | undefined, safeRecruiterOnly = false): CandidatePolicyEvaluation {
  const hardReasons: string[] = []
  const softSignals: string[] = []
  const matchedRole = roleCategory(candidate.headline, template.audience)
  const location = locationMatch(candidate.location, template.city)

  if (!stablePersonId(candidate.personId)) hardReasons.push('missing_person_id')
  if (!candidate.name || !meaningfulHeadline(candidate.headline)) hardReasons.push('incomplete_profile')
  if (candidate.distance !== undefined && candidate.distance !== 2) hardReasons.push('not_second_degree')
  if (candidate.distance === undefined) softSignals.push('network_distance_unverified')
  if (relationBlocks(candidate.raw)) hardReasons.push('existing_relation')
  if (location === 'exact') softSignals.push('city_exact')
  else if (location === 'alias') softSignals.push('city_alias')
  else if (location === 'missing') softSignals.push('location_missing')
  else softSignals.push('city_outside_target')

  if (safeRecruiterOnly && template.audience === 'technical') {
    hardReasons.push('safe_mode_technical_disabled')
  } else if (matchedRole === 'non_matching') {
    hardReasons.push('role_mismatch')
  }

  let stackEvidence: CandidatePolicyEvaluation['evidence']['stackEvidence'] = 'not_applicable'
  if (template.audience === 'technical') {
    const headline = folded(candidate.headline)
    stackEvidence = stack && stackTokens(stack).some(token => headline.includes(folded(token)))
      ? 'headline' : 'search_only'
    softSignals.push(stackEvidence === 'headline' ? 'stack_in_headline' : 'stack_search_only')
  }

  const eligible = hardReasons.length === 0
  return {
    decision: eligible ? 'eligible' : 'skip', eligible,
    reasonCode: hardReasons[0] ?? (safeRecruiterOnly ? 'safe_recruiter_match' :
      template.audience === 'technical' ? 'technical_match' : `${matchedRole}_match`),
    hardReasons, softSignals, roleCategory: matchedRole,
    evidence: { locationMatch: location, stackEvidence,
      hasName: Boolean(candidate.name), hasHeadline: meaningfulHeadline(candidate.headline),
      ...(candidate.distance !== undefined ? { networkDistance: candidate.distance } : {}) }
  }
}

export function audienceOf(value: unknown): value is SearchAudience {
  return value === 'recruiter' || value === 'technical'
}
