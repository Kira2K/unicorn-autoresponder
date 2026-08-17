type EducationUpsert = import('./types.ts').EducationUpsert
type ExperienceUpsert = import('./types.ts').ExperienceUpsert
type LinkedInSessionInput = import('./types.ts').LinkedInSessionInput
type NamedParameter = import('./types.ts').NamedParameter
type OpenToWorkInput = import('./types.ts').OpenToWorkInput
type ProfileInput = import('./types.ts').ProfileInput
type ValidationIssue = import('./types.ts').ValidationIssue
type ValidationResult<T> = import('./types.ts').ValidationResult<T>
type YearMonth = import('./types.ts').YearMonth

type JsonObject = Record<string, unknown>

const WORKPLACE_TYPES = new Set(['ON_SITE', 'HYBRID', 'REMOTE'])
const EMPLOYMENT_TYPES = new Set(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY'])
const OPEN_TO_WORK_START_DATES = new Set(['IMMEDIATELY', 'FLEXIBLE'])
const OPEN_TO_WORK_VISIBILITY = new Set(['ALL', 'RECRUITERS_ONLY'])
const ALLOWED_PROFILE_FIELDS = new Set([
  'headline',
  'about',
  'skills',
  'experience',
  'education',
  'open_to_work'
])

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function addWarning(
  issues: ValidationIssue[],
  path: string,
  message: string,
  resolution?: string
): void {
  issues.push({ level: 'warning', path, message, resolution })
}

function addFatal(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ level: 'fatal', path, message })
}

function parseYearMonth(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): YearMonth | undefined {
  const text = nonEmptyString(value)
  const match = text?.match(/^(\d{4})-(0[1-9]|1[0-2])$/)
  if (!match) {
    if (value !== undefined && value !== null && value !== '') {
      addWarning(issues, path, 'Ожидалась дата в формате YYYY-MM.', 'Поле проигнорировано.')
    }
    return undefined
  }
  return { year: Number(match[1]), month: Number(match[2]) }
}

function uniqueStrings(value: unknown, path: string, issues: ValidationIssue[]): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    addWarning(issues, path, 'Ожидался массив строк.', 'Поле проигнорировано.')
    return []
  }

  const result: string[] = []
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const text = nonEmptyString(item)
    if (!text) {
      addWarning(issues, `${path}[${index}]`, 'Пустое или нестроковое значение.', 'Элемент пропущен.')
      return
    }
    const key = text.toLocaleLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    result.push(text)
  })
  return result
}

function parseNamedParameters(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): NamedParameter[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) {
      addWarning(issues, path, 'Ожидался массив названий или объектов {name, id}.', 'Поле проигнорировано.')
    }
    return []
  }

  const result: NamedParameter[] = []
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`
    const name = nonEmptyString(item) ?? (isObject(item) ? nonEmptyString(item.name ?? item.title) : undefined)
    const id = isObject(item) ? nonEmptyString(item.id) : undefined
    if (!name) {
      addWarning(issues, itemPath, 'Не найдено название.', 'Элемент пропущен.')
      return
    }
    const key = `${name.toLocaleLowerCase()}|${id ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    result.push({ name, id })
  })
  return result
}

function parseExperience(value: unknown, issues: ValidationIssue[]): ExperienceUpsert[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    addWarning(issues, 'profile.experience', 'Ожидался массив.', 'Раздел Experience пропущен.')
    return []
  }

  const result: ExperienceUpsert[] = []
  value.forEach((item, index) => {
    const path = `profile.experience[${index}]`
    if (!isObject(item)) {
      addWarning(issues, path, 'Ожидался объект.', 'Запись пропущена.')
      return
    }
    if (item.action !== undefined && item.action !== 'upsert') {
      addWarning(issues, `${path}.action`, 'V1 поддерживает только action="upsert".', 'Запись пропущена.')
      return
    }
    if (!isObject(item.data)) {
      addWarning(issues, `${path}.data`, 'Нет объекта data.', 'Запись пропущена.')
      return
    }

    const data = item.data
    const company = nonEmptyString(data.company)
    const jobTitle = nonEmptyString(data.job_title)
    const startDate = parseYearMonth(data.start_date, `${path}.data.start_date`, issues)
    if (!company || !jobTitle || !startDate) {
      addWarning(
        issues,
        path,
        'Для безопасного upsert нужны company, job_title и start_date.',
        'Эта запись Experience будет пропущена, остальные разделы можно продолжить.'
      )
      return
    }

    const rawSkills = uniqueStrings(data.skills, `${path}.data.skills`, issues)
    const skills = rawSkills.slice(0, 5)
    if (rawSkills.length > 5) {
      addWarning(
        issues,
        `${path}.data.skills`,
        `Передано ${rawSkills.length} навыков; Unipile рекомендует не больше пяти для одной позиции.`,
        'Будут использованы первые 5.'
      )
    }

    const workplace = nonEmptyString(data.workplace_type)?.toUpperCase()
    const workplaceType = workplace && WORKPLACE_TYPES.has(workplace)
      ? workplace as ExperienceUpsert['data']['workplaceType']
      : undefined
    if (workplace && !workplaceType) {
      addWarning(issues, `${path}.data.workplace_type`, 'Неизвестный workplace_type.', 'Поле проигнорировано.')
    }

    const match = isObject(item.match) ? item.match : {}
    result.push({
      match: {
        company: nonEmptyString(match.company) ?? company,
        jobTitle: nonEmptyString(match.job_title) ?? jobTitle,
        startDate: parseYearMonth(match.start_date, `${path}.match.start_date`, issues) ?? startDate
      },
      data: {
        company,
        jobTitle,
        employmentType: nonEmptyString(data.employment_type),
        location: nonEmptyString(data.location),
        workplaceType,
        startDate,
        endDate: parseYearMonth(data.end_date, `${path}.data.end_date`, issues),
        description: typeof data.description === 'string' ? data.description : undefined,
        sourceOfHire: nonEmptyString(data.source_of_hire),
        skills
      }
    })
  })
  return result
}

function parseEducation(value: unknown, issues: ValidationIssue[]): EducationUpsert[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    addWarning(issues, 'profile.education', 'Ожидался массив.', 'Раздел Education пропущен.')
    return []
  }

  const result: EducationUpsert[] = []
  value.forEach((item, index) => {
    const path = `profile.education[${index}]`
    if (!isObject(item)) {
      addWarning(issues, path, 'Ожидался объект.', 'Запись пропущена.')
      return
    }
    if (item.action !== undefined && item.action !== 'upsert') {
      addWarning(issues, `${path}.action`, 'V1 поддерживает только action="upsert".', 'Запись пропущена.')
      return
    }
    if (!isObject(item.data)) {
      addWarning(issues, `${path}.data`, 'Нет объекта data.', 'Запись пропущена.')
      return
    }

    const data = item.data
    const school = nonEmptyString(data.school)
    const startDate = parseYearMonth(data.start_date, `${path}.data.start_date`, issues)
    if (!school || !startDate) {
      addWarning(
        issues,
        path,
        'Для безопасного upsert Education нужны school и start_date.',
        'Эта запись Education будет пропущена, остальные разделы можно продолжить.'
      )
      return
    }

    const match = isObject(item.match) ? item.match : {}
    result.push({
      match: {
        school: nonEmptyString(match.school) ?? school,
        startDate: parseYearMonth(match.start_date, `${path}.match.start_date`, issues) ?? startDate
      },
      data: {
        school,
        degree: nonEmptyString(data.degree),
        fieldOfStudy: nonEmptyString(data.field_of_study),
        startDate,
        endDate: parseYearMonth(data.end_date, `${path}.data.end_date`, issues),
        grade: nonEmptyString(data.grade),
        activities: typeof data.activities === 'string' ? data.activities : undefined,
        description: typeof data.description === 'string' ? data.description : undefined,
        skills: uniqueStrings(data.skills, `${path}.data.skills`, issues).slice(0, 5)
      }
    })
  })
  return result
}

function parseEnumArray<T extends string>(
  value: unknown,
  allowed: Set<string>,
  path: string,
  issues: ValidationIssue[]
): T[] {
  const raw = uniqueStrings(value, path, issues)
  const result: T[] = []
  raw.forEach(item => {
    const normalized = item.toUpperCase()
    if (!allowed.has(normalized)) {
      addWarning(issues, path, `Неизвестное значение "${item}".`, 'Значение пропущено.')
      return
    }
    result.push(normalized as T)
  })
  return result
}

function parseOpenToWork(value: unknown, issues: ValidationIssue[]): OpenToWorkInput | undefined {
  if (value === undefined) return undefined
  if (!isObject(value)) {
    addWarning(issues, 'profile.open_to_work', 'Ожидался объект.', 'Open to Work пропущен.')
    return undefined
  }
  if (value.enabled === false) {
    addWarning(
      issues,
      'profile.open_to_work.enabled',
      'Штатное отключение Open to Work не поддерживается.',
      'Open to Work пропущен.'
    )
    return undefined
  }

  const jobTitles = parseNamedParameters(value.job_titles ?? value.job_title, 'profile.open_to_work.job_titles', issues)
  const locations = parseNamedParameters(value.locations, 'profile.open_to_work.locations', issues)
  const workplaceTypes = parseEnumArray<OpenToWorkInput['workplaceTypes'][number]>(
    value.workplace_types,
    WORKPLACE_TYPES,
    'profile.open_to_work.workplace_types',
    issues
  )
  const employmentTypes = parseEnumArray<OpenToWorkInput['employmentTypes'][number]>(
    value.employment_types ?? value.employment_type,
    EMPLOYMENT_TYPES,
    'profile.open_to_work.employment_types',
    issues
  )
  const startDateText = nonEmptyString(value.start_date)?.toUpperCase()
  const startDate = startDateText && OPEN_TO_WORK_START_DATES.has(startDateText)
    ? startDateText as OpenToWorkInput['startDate']
    : undefined
  if (startDateText && !startDate) {
    addWarning(issues, 'profile.open_to_work.start_date', 'Неизвестный start_date.', 'Поле проигнорировано.')
  }
  const visibilityText = nonEmptyString(value.visibility)?.toUpperCase()
  const visibility = visibilityText && OPEN_TO_WORK_VISIBILITY.has(visibilityText)
    ? visibilityText as OpenToWorkInput['visibility']
    : undefined

  if (!jobTitles.length || !workplaceTypes.length || !visibility) {
    addWarning(
      issues,
      'profile.open_to_work',
      'Нужны job_titles, workplace_types и visibility.',
      'Open to Work пропущен, остальные разделы можно продолжить.'
    )
    return undefined
  }

  return {
    jobTitles,
    workplaceTypes,
    locations,
    startDate,
    employmentTypes,
    visibility
  }
}

function validateSessionFile(input: unknown): ValidationResult<LinkedInSessionInput> {
  const issues: ValidationIssue[] = []
  if (!isObject(input)) {
    addFatal(issues, '$', 'session.json должен содержать JSON-объект.')
    return { issues }
  }
  if (input.provider !== undefined && input.provider !== 'linkedin') {
    addFatal(issues, 'provider', 'session.json должен иметь provider="linkedin".')
  }

  const credentials = isObject(input.credentials) ? input.credentials : undefined
  const accessToken = nonEmptyString(credentials?.access_token)
  const userAgent = nonEmptyString(input.user_agent)
  if (!accessToken) addFatal(issues, 'credentials.access_token', 'Не найден обязательный li_at/access_token.')
  if (!userAgent) addFatal(issues, 'user_agent', 'Не найден обязательный User-Agent.')
  if (issues.some(issue => issue.level === 'fatal') || !accessToken || !userAgent) {
    return { issues }
  }

  if (credentials && 'premium_access_token' in credentials) {
    addWarning(
      issues,
      'credentials.premium_access_token',
      'li_a/premium_access_token не используется в этой версии.',
      'Поле проигнорировано.'
    )
  }

  return {
    value: {
      schemaVersion: 1,
      capturedAt: nonEmptyString(input.captured_at),
      accessToken,
      userAgent,
      accountId: nonEmptyString(input.account_id)
    },
    issues
  }
}

function validateProfileFile(input: unknown): ValidationResult<ProfileInput> {
  const issues: ValidationIssue[] = []
  if (!isObject(input)) {
    addFatal(issues, '$', 'profile.json должен содержать JSON-объект.')
    return { issues }
  }
  if (!isObject(input.profile)) {
    addFatal(issues, 'profile', 'Не найден объект profile.')
    return { issues }
  }

  const profile = input.profile
  for (const key of Object.keys(profile)) {
    if (!ALLOWED_PROFILE_FIELDS.has(key)) {
      addWarning(issues, `profile.${key}`, 'Поле не поддерживается ограниченной V1.', 'Поле проигнорировано.')
    }
  }

  const skillsObject = isObject(profile.skills) ? profile.skills : {}
  const rawTargetCount = Number(skillsObject.target_count ?? 100)
  const targetCount = Number.isInteger(rawTargetCount) && rawTargetCount >= 95 && rawTargetCount <= 103
    ? rawTargetCount
    : 100
  if (skillsObject.target_count !== undefined && targetCount !== rawTargetCount) {
    addWarning(
      issues,
      'profile.skills.target_count',
      'Целевое количество должно быть от 95 до 103.',
      'Используется значение 100.'
    )
  }

  const value: ProfileInput = {
    schemaVersion: 1,
    headline: typeof profile.headline === 'string' ? profile.headline.trim() : undefined,
    about: typeof profile.about === 'string' ? profile.about : undefined,
    skills: {
      add: uniqueStrings(skillsObject.add, 'profile.skills.add', issues),
      targetCount
    },
    experience: parseExperience(profile.experience, issues),
    education: parseEducation(profile.education, issues),
    openToWork: parseOpenToWork(profile.open_to_work, issues)
  }

  if (!value.headline && value.about === undefined && !value.skills.add.length &&
      !value.experience.length && !value.education.length && !value.openToWork) {
    addWarning(issues, 'profile', 'После безопасной нормализации нет применимых изменений.')
  }

  return { value, issues }
}

module.exports = {
  isObject,
  parseYearMonth,
  validateProfileFile,
  validateSessionFile
}
