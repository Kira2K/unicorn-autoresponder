import type { JsonObject } from './input-types.ts'
import { normalizeEducation, normalizeExperience, name, section, specifics } from './profile-data.ts'

const groups = ['experience', 'education', 'skills', 'open_to_work']
const pick = (source: JsonObject, keys: string[]) => Object.fromEntries(keys.filter(key =>
  Object.hasOwn(source, key)).map(key => [key, structuredClone(source[key])]))

// Private, bounded Preview input; never a provider-response cache or an Apply preflight.
export function planningSnapshot(profile: JsonObject, previous?: JsonObject, refreshed?: string[]): JsonObject {
  const raw = specifics(profile), previousRaw = previous ? specifics(previous) : {}
  const selected = refreshed ?? groups
  const data = { ...previousRaw }
  for (const key of selected) {
    delete data[key]
    if (!Object.hasOwn(raw, key)) continue
    if (key === 'experience' || key === 'education') {
      const normalize = key === 'experience' ? normalizeExperience : normalizeEducation
      data[key] = Array.isArray(raw[key]) ? section(profile, key).map(item => ({ id: item.id, ...normalize(item) })) : null
    } else if (key === 'skills') {
      data.skills = Array.isArray(raw.skills) ? section(profile, key).map(name).filter(Boolean).map(name => ({ name })) : null
    } else if (raw.open_to_work && typeof raw.open_to_work === 'object') {
      data.open_to_work = pick(raw.open_to_work as JsonObject,
        ['job_title', 'workplace', 'start_date', 'employment_type', 'visibility'])
    }
  }
  const throttled = (value: unknown) => Array.isArray(value) ? value.map(item => String(item).replace(/^linkedin_/, '')) : []
  data.throttled_sections = [...new Set([
    ...throttled(previousRaw.throttled_sections).filter(key => !selected.includes(key)),
    ...throttled(profile.throttled_sections), ...throttled(raw.throttled_sections)
  ])]
  const retained = ['provider_id', 'id', 'display_name', 'name', 'profile_url',
    ...(!selected.includes('headline') ? ['description'] : []), ...(!selected.includes('about') ? ['bio'] : [])]
  return { ...pick(previous ?? {}, retained),
    ...pick(profile, ['provider_id', 'id', 'display_name', 'name', 'profile_url', 'description', 'bio']), specifics: data }
}
