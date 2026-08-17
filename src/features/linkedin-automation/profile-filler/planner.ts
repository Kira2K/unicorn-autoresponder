type EducationData = import('./types.ts').EducationData
type ConnectedAccount = import('../core/account/connected-account.ts').ConnectedAccount
type ExperienceData = import('./types.ts').ExperienceData
type NamedParameter = import('./types.ts').NamedParameter
type PlanStep = import('./types.ts').PlanStep
type ProfileInput = import('./types.ts').ProfileInput
type ProfilePlan = import('./types.ts').ProfilePlan
type ValidationIssue = import('./types.ts').ValidationIssue
type YearMonth = import('./types.ts').YearMonth

type JsonObject = Record<string, unknown>
type ParameterResolver = (
  type: 'JOB_TITLE' | 'LOCATION',
  value: NamedParameter
) => Promise<{ id: string; name: string } | undefined>

type PlannerOptions = {
  resolveParameter?: ParameterResolver
  skillBatchSize?: number
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function nameValue(value: unknown): string | undefined {
  if (typeof value === 'string') return stringValue(value)
  if (!isObject(value)) return undefined
  return stringValue(value.name ?? value.title)
}

function apiYearMonth(value: unknown): YearMonth | undefined {
  const text = stringValue(value)
  if (!text) return undefined
  let match = text.match(/^(\d{4})-(0?[1-9]|1[0-2])(?:-\d{2})?$/)
  if (match) return { year: Number(match[1]), month: Number(match[2]) }
  match = text.match(/^(0?[1-9]|1[0-2])\/\d{1,2}\/(\d{4})$/)
  if (match) return { year: Number(match[2]), month: Number(match[1]) }
  return undefined
}

function yearMonthEquals(left?: YearMonth, right?: YearMonth): boolean {
  if (!left || !right) return left === right
  return left.year === right.year && left.month === right.month
}

function comparableYearMonth(value?: YearMonth): string | undefined {
  return value ? `${value.year}-${String(value.month).padStart(2, '0')}` : undefined
}

function warning(path: string, message: string, resolution?: string): ValidationIssue {
  return { level: 'warning', path, message, resolution }
}

function getSpecifics(profile: JsonObject): JsonObject {
  return isObject(profile.specifics) ? profile.specifics : {}
}

function getSection(profile: JsonObject, name: string): JsonObject[] {
  const value = getSpecifics(profile)[name]
  return Array.isArray(value) ? value.filter(isObject) : []
}

function getThrottledSections(profile: JsonObject): Set<string> {
  const raw = Array.isArray(profile.throttled_sections)
    ? profile.throttled_sections
    : Array.isArray(getSpecifics(profile).throttled_sections)
      ? getSpecifics(profile).throttled_sections as unknown[]
      : []
  return new Set(raw.filter((item): item is string => typeof item === 'string'))
}

function linkedInPayload(field: string, value: unknown): Record<string, unknown> {
  return { specifics: { linkedin: { [field]: value } } }
}

function apiDate(value: YearMonth): { year: number; month: number } {
  return { year: value.year, month: value.month }
}

function buildExperiencePayload(data: ExperienceData, operation: 'create' | 'edit', id?: string): JsonObject {
  return {
    operation,
    ...(id ? { id } : {}),
    notify_network: false,
    job_title: { name: data.jobTitle },
    company: { name: data.company },
    ...(data.employmentType ? { employment_type: data.employmentType } : {}),
    ...(data.location ? { location: { name: data.location } } : {}),
    ...(data.workplaceType ? { workplace_type: data.workplaceType } : {}),
    start_date: apiDate(data.startDate),
    ...(data.endDate ? { end_date: apiDate(data.endDate) } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.sourceOfHire ? { source_of_hire: data.sourceOfHire } : {}),
    ...(data.skills.length ? { skills: data.skills.map(name => ({ name })) } : {})
  }
}

function buildEducationPayload(data: EducationData, operation: 'create' | 'edit', id?: string): JsonObject {
  return {
    operation,
    ...(id ? { id } : {}),
    notify_network: false,
    school: { name: data.school },
    ...(data.degree ? { degree: { name: data.degree } } : {}),
    ...(data.fieldOfStudy ? { field_of_study: { name: data.fieldOfStudy } } : {}),
    start_date: apiDate(data.startDate),
    ...(data.endDate ? { end_date: apiDate(data.endDate) } : {}),
    ...(data.grade ? { grade: data.grade } : {}),
    ...(data.activities !== undefined ? { activities: data.activities } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.skills.length ? { skills: data.skills.map(name => ({ name })) } : {})
  }
}

function normalizeExperience(item: JsonObject): JsonObject {
  return {
    company: nameValue(item.company),
    job_title: nameValue(item.job_title),
    employment_type: stringValue(item.employment_type),
    location: nameValue(item.location),
    workplace_type: stringValue(item.workplace_type),
    start_date: comparableYearMonth(apiYearMonth(item.started_on ?? item.start_date)),
    end_date: comparableYearMonth(apiYearMonth(item.ended_on ?? item.end_date)),
    description: typeof item.description === 'string' ? item.description : undefined,
    skills: Array.isArray(item.skills) ? item.skills.map(nameValue).filter(Boolean) : []
  }
}

function normalizeDesiredExperience(data: ExperienceData): JsonObject {
  return {
    company: data.company,
    job_title: data.jobTitle,
    employment_type: data.employmentType,
    location: data.location,
    workplace_type: data.workplaceType,
    start_date: comparableYearMonth(data.startDate),
    end_date: comparableYearMonth(data.endDate),
    description: data.description,
    skills: data.skills
  }
}

function normalizeEducation(item: JsonObject): JsonObject {
  return {
    school: nameValue(item.school),
    degree: nameValue(item.degree),
    field_of_study: nameValue(item.field_of_study),
    start_date: comparableYearMonth(apiYearMonth(item.started_on ?? item.start_date)),
    end_date: comparableYearMonth(apiYearMonth(item.ended_on ?? item.end_date)),
    grade: stringValue(item.grade),
    activities: typeof item.activities === 'string' ? item.activities : undefined,
    description: typeof item.description === 'string' ? item.description : undefined,
    skills: Array.isArray(item.skills) ? item.skills.map(nameValue).filter(Boolean) : []
  }
}

function normalizeDesiredEducation(data: EducationData): JsonObject {
  return {
    school: data.school,
    degree: data.degree,
    field_of_study: data.fieldOfStudy,
    start_date: comparableYearMonth(data.startDate),
    end_date: comparableYearMonth(data.endDate),
    grade: data.grade,
    activities: data.activities,
    description: data.description,
    skills: data.skills
  }
}

function differs(current: JsonObject, desired: JsonObject): boolean {
  for (const [key, value] of Object.entries(desired)) {
    if (value === undefined) continue
    if (JSON.stringify(current[key]) !== JSON.stringify(value)) return true
  }
  return false
}

function experienceMatches(item: JsonObject, match: ProfileInput['experience'][number]['match']): boolean {
  const currentCompany = nameValue(item.company)?.toLocaleLowerCase()
  const currentTitle = nameValue(item.job_title)?.toLocaleLowerCase()
  if (currentCompany !== match.company.toLocaleLowerCase()) return false
  if (currentTitle !== match.jobTitle.toLocaleLowerCase()) return false
  if (match.startDate && !yearMonthEquals(apiYearMonth(item.started_on ?? item.start_date), match.startDate)) return false
  return true
}

function educationMatches(item: JsonObject, match: ProfileInput['education'][number]['match']): boolean {
  const currentSchool = nameValue(item.school)?.toLocaleLowerCase()
  if (currentSchool !== match.school.toLocaleLowerCase()) return false
  if (match.startDate && !yearMonthEquals(apiYearMonth(item.started_on ?? item.start_date), match.startDate)) return false
  return true
}

async function resolveOpenToWork(
  profile: ProfileInput,
  resolveParameter: ParameterResolver | undefined,
  issues: ValidationIssue[]
): Promise<JsonObject | undefined> {
  const input = profile.openToWork
  if (!input) return undefined
  if (!resolveParameter) {
    issues.push(warning('profile.open_to_work', 'Не настроен поиск параметров LinkedIn.', 'Open to Work пропущен.'))
    return undefined
  }

  const titles: Array<{ title: string; id: string }> = []
  for (const value of input.jobTitles) {
    const resolved = await resolveParameter('JOB_TITLE', value)
    if (!resolved) {
      issues.push(warning(
        'profile.open_to_work.job_titles',
        `Не удалось однозначно определить должность "${value.name}".`,
        'Open to Work пропущен.'
      ))
      return undefined
    }
    titles.push({ title: resolved.name, id: resolved.id })
  }

  const locationIds: string[] = []
  for (const value of input.locations) {
    const resolved = await resolveParameter('LOCATION', value)
    if (!resolved) {
      issues.push(warning(
        'profile.open_to_work.locations',
        `Не удалось однозначно определить локацию "${value.name}".`,
        'Open to Work пропущен.'
      ))
      return undefined
    }
    locationIds.push(resolved.id)
  }

  return {
    job_title: titles,
    workplace: input.workplaceTypes.map(type => ({ type, location: locationIds })),
    ...(input.startDate ? { start_date: input.startDate } : {}),
    ...(input.employmentTypes.length ? { employment_type: input.employmentTypes } : {}),
    visibility: input.visibility
  }
}

async function buildProfilePlan(
  account: ConnectedAccount,
  desired: ProfileInput,
  currentProfile: JsonObject,
  initialIssues: ValidationIssue[] = [],
  options: PlannerOptions = {}
): Promise<ProfilePlan> {
  const issues = [...initialIssues]
  const steps: PlanStep[] = []
  const throttled = getThrottledSections(currentProfile)
  const specifics = getSpecifics(currentProfile)
  const identity = {
    displayName: stringValue(currentProfile.display_name) ?? 'Unknown LinkedIn account',
    profileUrl: stringValue(currentProfile.profile_url),
    headline: stringValue(currentProfile.description)
  }

  if (desired.headline !== undefined && desired.headline !== String(currentProfile.description ?? '')) {
    steps.push({
      id: 'headline',
      section: 'headline',
      action: 'update',
      summary: 'Изменить Headline',
      before: currentProfile.description ?? null,
      after: desired.headline,
      payload: linkedInPayload('headline', desired.headline),
      verification: { kind: 'headline', expected: desired.headline }
    })
  }

  if (desired.about !== undefined && desired.about !== String(currentProfile.bio ?? '')) {
    steps.push({
      id: 'about',
      section: 'about',
      action: 'update',
      summary: 'Изменить About',
      before: currentProfile.bio ?? null,
      after: desired.about,
      payload: { bio: desired.about },
      verification: { kind: 'about', expected: desired.about }
    })
  }

  if (throttled.has('linkedin_experience')) {
    issues.push(warning('profile.experience', 'LinkedIn временно не вернул полный Experience.', 'Experience пропущен, чтобы не создать дубликаты.'))
  } else {
    const currentExperience = getSection(currentProfile, 'experience')
    desired.experience.forEach((entry, index) => {
      const matches = currentExperience.filter(item => experienceMatches(item, entry.match))
      if (matches.length > 1) {
        issues.push(warning(
          `profile.experience[${index}]`,
          `Найдено несколько совпадений для ${entry.match.company} / ${entry.match.jobTitle}.`,
          'Запись пропущена.'
        ))
        return
      }
      const existing = matches[0]
      const existingId = existing ? stringValue(existing.id) : undefined
      if (existing && !existingId) {
        issues.push(warning(`profile.experience[${index}]`, 'У найденной записи нет id.', 'Запись пропущена.'))
        return
      }
      const desiredComparable = normalizeDesiredExperience(entry.data)
      if (existing && !differs(normalizeExperience(existing), desiredComparable)) return
      const operation = existing ? 'edit' : 'create'
      steps.push({
        id: `experience-${index + 1}`,
        section: 'experience',
        action: existing ? 'update' : 'create',
        summary: `${existing ? 'Обновить' : 'Создать'} Experience: ${entry.data.company} — ${entry.data.jobTitle}`,
        before: existing ? normalizeExperience(existing) : null,
        after: desiredComparable,
        payload: linkedInPayload('experience', buildExperiencePayload(entry.data, operation, existingId)),
        verification: { kind: 'experience', id: existingId, expected: entry.data }
      })
    })
  }

  if (throttled.has('linkedin_education')) {
    issues.push(warning('profile.education', 'LinkedIn временно не вернул полный Education.', 'Education пропущен, чтобы не создать дубликаты.'))
  } else {
    const currentEducation = getSection(currentProfile, 'education')
    desired.education.forEach((entry, index) => {
      const matches = currentEducation.filter(item => educationMatches(item, entry.match))
      if (matches.length > 1) {
        issues.push(warning(
          `profile.education[${index}]`,
          `Найдено несколько совпадений для ${entry.match.school}.`,
          'Запись пропущена.'
        ))
        return
      }
      const existing = matches[0]
      const existingId = existing ? stringValue(existing.id) : undefined
      if (existing && !existingId) {
        issues.push(warning(`profile.education[${index}]`, 'У найденной записи нет id.', 'Запись пропущена.'))
        return
      }
      const desiredComparable = normalizeDesiredEducation(entry.data)
      if (existing && !differs(normalizeEducation(existing), desiredComparable)) return
      const operation = existing ? 'edit' : 'create'
      steps.push({
        id: `education-${index + 1}`,
        section: 'education',
        action: existing ? 'update' : 'create',
        summary: `${existing ? 'Обновить' : 'Создать'} Education: ${entry.data.school}`,
        before: existing ? normalizeEducation(existing) : null,
        after: desiredComparable,
        payload: linkedInPayload('education', buildEducationPayload(entry.data, operation, existingId)),
        verification: { kind: 'education', id: existingId, expected: entry.data }
      })
    })
  }

  if (throttled.has('linkedin_skills')) {
    issues.push(warning('profile.skills', 'LinkedIn временно не вернул полный список Skills.', 'Skills пропущены, чтобы не превысить целевой диапазон.'))
  } else {
    const currentSkills = getSection(currentProfile, 'skills')
    const currentNames = currentSkills.map(item => nameValue(item)).filter((name): name is string => Boolean(name))
    const currentKeys = new Set(currentNames.map(name => name.toLocaleLowerCase()))
    if (currentNames.length > 103) {
      issues.push(warning('profile.skills', `В профиле уже ${currentNames.length} навыков.`, 'Удаление не поддерживается; Skills не изменяются.'))
    } else {
      const room = Math.max(0, desired.skills.targetCount - currentNames.length)
      const missing = desired.skills.add.filter(name => !currentKeys.has(name.toLocaleLowerCase())).slice(0, room)
      const batchSize = Math.max(1, Math.min(25, options.skillBatchSize ?? 10))
      for (let offset = 0; offset < missing.length; offset += batchSize) {
        const batch = missing.slice(offset, offset + batchSize)
        steps.push({
          id: `skills-${Math.floor(offset / batchSize) + 1}`,
          section: 'skills',
          action: 'add',
          summary: `Добавить Skills (${batch.length}): ${batch.join(', ')}`,
          before: { count: currentNames.length + offset },
          after: { count: currentNames.length + offset + batch.length, added: batch },
          payload: linkedInPayload('skills', batch.map(name => ({ name }))),
          verification: { kind: 'skills', expected: batch }
        })
      }
      const projectedCount = currentNames.length + missing.length
      if (projectedCount < 95 && desired.skills.add.length) {
        issues.push(warning(
          'profile.skills.add',
          `После добавления доступных навыков ожидается ${projectedCount}, а требуется минимум 95.`,
          'Заполнение продолжится, но нужно дополнить исходный список.'
        ))
      }
    }
  }

  const openToWorkPayload = await resolveOpenToWork(desired, options.resolveParameter, issues)
  if (openToWorkPayload) {
    steps.push({
      id: 'open-to-work',
      section: 'open_to_work',
      action: 'update',
      summary: 'Включить или обновить Open to Work',
      before: {
        is_open_to_work: specifics.is_open_to_work,
        open_to_work: specifics.open_to_work
      },
      after: openToWorkPayload,
      payload: linkedInPayload('open_to_work', openToWorkPayload),
      verification: { kind: 'open_to_work' }
    })
  }

  return { account, identity, steps, issues }
}

module.exports = {
  apiYearMonth,
  buildEducationPayload,
  buildExperiencePayload,
  buildProfilePlan,
  differs,
  educationMatches,
  experienceMatches,
  normalizeEducation,
  normalizeExperience
}
