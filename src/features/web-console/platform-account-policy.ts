export const PLATFORM_ACCOUNT_FIELDS = [
  'login',
  'phone',
  'email',
  'nickname',
  'linkedInUrl',
  'foreignNumber',
  'recoveryCodes',
  'password',
  'emailPassword'
] as const

export type PlatformAccountField = typeof PLATFORM_ACCOUNT_FIELDS[number]

export type PlatformAccountPolicy = {
  fields: readonly PlatformAccountField[]
  requiredFields: readonly PlatformAccountField[]
}

export const PLATFORM_ACCOUNT_POLICIES: Readonly<Record<string, PlatformAccountPolicy>> = {
  email_en: {
    fields: ['login', 'password'],
    requiredFields: ['login', 'password']
  },
  email_ru: {
    fields: ['login', 'password'],
    requiredFields: ['login', 'password']
  },
  hh_en: {
    fields: ['login', 'phone', 'password'],
    requiredFields: ['login', 'phone', 'password']
  },
  hh_ru: {
    fields: ['login', 'phone', 'password'],
    requiredFields: ['login', 'phone', 'password']
  },
  telegram_en: {
    fields: ['login', 'nickname'],
    requiredFields: ['login', 'nickname']
  },
  telegram_ru: {
    fields: ['login', 'nickname'],
    requiredFields: ['login', 'nickname']
  },
  linkedin: {
    fields: ['login', 'password', 'linkedInUrl', 'recoveryCodes'],
    requiredFields: ['login', 'password', 'linkedInUrl']
  },
  github: {
    fields: ['linkedInUrl'],
    requiredFields: ['linkedInUrl']
  },
  phone_en: {
    fields: ['phone'],
    requiredFields: ['phone']
  }
}

export const CANONICAL_EMAIL_RU_PLATFORM_ID = 27

export const PLATFORM_ACCOUNT_LABEL_BY_ID: Readonly<Record<number, string>> = {
  10: 'hh_en',
  11: 'hh_ru',
  16: 'linkedin',
  23: 'telegram_en',
  24: 'telegram_ru',
  25: 'email_en',
  26: 'email_ru',
  27: 'email_ru',
  28: 'phone_en',
  29: 'github'
}

export function normalizePlatformAccountLabel(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

export function platformAccountPolicy(value: unknown): PlatformAccountPolicy | undefined {
  return PLATFORM_ACCOUNT_POLICIES[normalizePlatformAccountLabel(value)]
}

export function platformAccountLabelFromId(value: unknown): string | undefined {
  const id = Number(value)
  return Number.isFinite(id) ? PLATFORM_ACCOUNT_LABEL_BY_ID[id] : undefined
}

export function isSupportedPlatformAccount(value: unknown): boolean {
  return Boolean(platformAccountPolicy(value))
}

export function isPlatformAccountFieldAllowed(platform: unknown, field: unknown): field is PlatformAccountField {
  return platformAccountPolicy(platform)?.fields.includes(field as PlatformAccountField) ?? false
}
