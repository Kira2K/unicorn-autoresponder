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

function text(value: unknown): string { return String(value ?? '').normalize('NFKC').trim() }
function lower(value: unknown): string { return text(value).toLowerCase() }

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

const RECRUITER = /(?:\b(?:recruit(?:er|ment|ing)?|talent\s+acquisition|talent\s+partner|sourc(?:er|ing)|staffing)\b|рекрутер|подбор\s+персонала)/i
const TECHNICAL = /(?:\b(?:developer|engineer|engineering|qa|quality\s+assurance|tester|testing|automation|architect|analyst|data\s+scientist)\b|разработчик|инженер|тестировщик|аналитик)/i

function stackTokens(stack: string): string[] {
  const normalized = lower(stack)
  const aliases: Record<string, string[]> = {
    frontend: ['frontend', 'front-end', 'react', 'javascript', 'typescript', 'фронтенд'],
    react: ['react', 'frontend', 'front-end', 'javascript', 'typescript'],
    fullstack: ['fullstack', 'full-stack', 'full stack', 'javascript', 'typescript'],
    python: ['python', 'django', 'fastapi', 'питон'], java: ['java', 'spring', 'джава'],
    go: ['golang', 'go engineer', 'go developer'], qa: ['qa', 'quality assurance', 'tester', 'testing'],
    data: ['data', 'analytics', 'analyst', 'data scientist', 'machine learning']
  }
  const compact = normalized.replace(/[^a-z0-9]+/g, '')
  return [...new Set([normalized, ...(aliases[compact] ?? [])])].filter(Boolean)
}

export function evaluateCandidate(candidate: ParsedCandidate, template: ConnectionSearchTemplate,
  stack: string | undefined, safeRecruiterOnly = false): { eligible: boolean; reasonCode: string } {
  if (!candidate.personId) return { eligible: false, reasonCode: 'missing_person_id' }
  if (!candidate.name || !candidate.headline || !candidate.location) {
    return { eligible: false, reasonCode: 'incomplete_profile' }
  }
  if (candidate.distance === undefined) {
    return { eligible: false, reasonCode: 'network_distance_unverified' }
  }
  if (candidate.distance !== 2) {
    return { eligible: false, reasonCode: 'not_second_degree' }
  }
  if (relationBlocks(candidate.raw)) return { eligible: false, reasonCode: 'existing_relation' }
  if (!lower(candidate.location).includes(lower(template.city))) {
    return { eligible: false, reasonCode: 'city_mismatch' }
  }
  if (template.audience === 'recruiter') {
    return RECRUITER.test(candidate.headline)
      ? { eligible: true, reasonCode: safeRecruiterOnly ? 'safe_recruiter_match' : 'recruiter_match' }
      : { eligible: false, reasonCode: 'role_mismatch' }
  }
  if (safeRecruiterOnly) return { eligible: false, reasonCode: 'safe_mode_technical_disabled' }
  if (!TECHNICAL.test(candidate.headline)) return { eligible: false, reasonCode: 'role_mismatch' }
  if (!stack || !stackTokens(stack).some(token => lower(candidate.headline).includes(token))) {
    return { eligible: false, reasonCode: 'stack_mismatch' }
  }
  return { eligible: true, reasonCode: 'technical_match' }
}

export function audienceOf(value: unknown): value is SearchAudience {
  return value === 'recruiter' || value === 'technical'
}
