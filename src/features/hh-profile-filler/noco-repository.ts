import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createNocoClient } = require('../../integrations/noco/core/client.ts') as {
  createNocoClient(options?: unknown): {
    fetchRecords(tableId: string, limit?: number): Promise<NocoRecord[]>
  }
}
const { TABLES } = require('../../integrations/noco/core/schema.ts') as {
  TABLES: Record<string, { id: string }>
}

import { ProfileFillerError, profileFillerError } from './errors.ts'
import { marketForStatus } from './state-store.ts'
import type { ContactData, ProfileFillerMarket, ResolvedClient } from './types.ts'

type NocoRecord = Record<string, any> & { Id: number }

const FINAL_CV_STATUSES = new Set(['moved to filling', 'filled'])
const HH_PLATFORM_IDS: Record<ProfileFillerMarket, number> = { Ru: 11, En: 10 }

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function normalized(value: unknown): string {
  return text(value).toLowerCase().replace(/ё/g, 'е').replace(/[_·]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function linkedRecords(value: unknown): NocoRecord[] {
  if (!value || typeof value !== 'object') return []
  return (Array.isArray(value) ? value : [value]) as NocoRecord[]
}

function linkedId(value: unknown): number | undefined {
  const row = linkedRecords(value)[0]
  const parsed = Number(row?.Id ?? row?.id ?? value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function clientId(row: NocoRecord, relation: string): number | undefined {
  const parsed = linkedId(row[relation]) ?? linkedId(row.clients_id) ?? linkedId(row.client)
  return parsed && Number.isFinite(parsed) ? parsed : undefined
}

function recordTimestamp(row: NocoRecord): number {
  return Date.parse(text(row.UpdatedAt ?? row.updated_at ?? row.CreatedAt ?? row.created_at)) || 0
}

function platformId(row: NocoRecord): number | undefined {
  return linkedId(row.rel_platformAccounts_platform) ?? linkedId(row.platforms_id)
}

function accountLabel(row: NocoRecord): string {
  return normalized([
    row.account_label,
    row.platform,
    linkedRecords(row.rel_platformAccounts_platform)[0]?.name,
    linkedRecords(row.rel_platformAccounts_platform)[0]?.label
  ].filter(Boolean).join(' '))
}

function accountValue(row: NocoRecord, ...fields: string[]): string | undefined {
  for (const field of fields) {
    const value = text(row[field])
    if (value) return value
  }
  return undefined
}

function uniqueAccount(accounts: NocoRecord[], predicate: (row: NocoRecord) => boolean,
  kind: string, required = false): NocoRecord | undefined {
  const matches = accounts.filter(predicate)
  if (matches.length > 1) {
    throw profileFillerError('profile_noco_account_ambiguous',
      `Multiple ${kind} Noco accounts were found: ${matches.map(item => item.Id).join(', ')}.`,
      'resolve_noco')
  }
  if (required && matches.length === 0) {
    throw profileFillerError('profile_noco_account_missing',
      `The ${kind} Noco account was not found.`, 'resolve_noco')
  }
  return matches[0]
}

function relationName(value: unknown): string | undefined {
  const row = linkedRecords(value)[0]
  return accountValue(row ?? ({} as NocoRecord), 'name', 'title', 'level', 'stack')
}

function localeMatches(value: unknown, market: ProfileFillerMarket): boolean {
  const locale = normalized(value)
  return market === 'Ru' ? locale === 'ru' : locale === 'en' || locale === 'eng'
}

export type NocoProfileFillerSnapshot = {
  clients: NocoRecord[]
  autoresponses: NocoRecord[]
  profiles: NocoRecord[]
  accounts: NocoRecord[]
  cvRows: NocoRecord[]
  stacks: NocoRecord[]
}

const NOCO_RATE_LIMIT_FALLBACK_MS = 15 * 60 * 1000

function retryAfterMs(error: any): number {
  const headers = error?.response?.headers
  const raw = typeof headers?.get === 'function'
    ? headers.get('retry-after')
    : headers?.['retry-after'] ?? headers?.['Retry-After']
  if (raw !== undefined && raw !== null && String(raw).trim()) {
    const seconds = Number(raw)
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
    const date = Date.parse(String(raw))
    if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  }
  return NOCO_RATE_LIMIT_FALLBACK_MS
}

function mapNocoReadError(error: unknown, source: string): never {
  if (error instanceof ProfileFillerError) throw error
  if (Number((error as any)?.response?.status) === 429 ||
      /too many requests/i.test(String((error as any)?.message ?? ''))) {
    throw profileFillerError('profile_noco_rate_limited',
      'NocoDB temporarily rate-limited Profile Filler reads. The job was deferred without consuming an HH attempt.',
      'resolve_noco', { retryAfterMs: retryAfterMs(error), source })
  }
  throw error
}

export function createProfileFillerNocoRepository(
  client = createNocoClient({ pageDelayMs: 750, retryDelaysMs: [0, 5000, 15000, 45000] })
) {
  let cached: Promise<NocoProfileFillerSnapshot> | undefined
  let cachedClients: Promise<NocoRecord[]> | undefined

  async function readTable(tableId: string, source: string): Promise<NocoRecord[]> {
    try {
      return await client.fetchRecords(tableId, 1000)
    } catch (error) {
      return mapNocoReadError(error, source)
    }
  }

  async function listClients(refresh = false): Promise<NocoRecord[]> {
    if (refresh) {
      cachedClients = undefined
      cached = undefined
    }
    if (!cachedClients) cachedClients = readTable(TABLES.clients.id, 'clients')
    try {
      return await cachedClients
    } catch (error) {
      cachedClients = undefined
      throw error
    }
  }

  async function snapshot(refresh = false): Promise<NocoProfileFillerSnapshot> {
    if (refresh) {
      cached = undefined
      cachedClients = undefined
    }
    if (!cached) {
      cached = (async () => {
        const clients = await listClients()
        const autoresponses = await readTable(TABLES.hhAutoresponses.id, 'hh_autoresponses')
        const profiles = await readTable(TABLES.dolphinProfiles.id, 'dolphin_profiles')
        const accounts = await readTable(TABLES.platformAccounts.id, 'platform_accounts')
        const cvRows = await readTable(TABLES.cvProcessing.id, 'cv_processing')
        const stacks = await readTable(TABLES.stacks.id, 'stacks')
        return { clients, autoresponses, profiles, accounts, cvRows, stacks }
      })()
    }
    try {
      return await cached
    } catch (error) {
      cached = undefined
      throw error
    }
  }

  async function resolveClient(expectedClientId: number,
    market: ProfileFillerMarket): Promise<ResolvedClient> {
    const data = await snapshot()
    const clientRow = data.clients.find(row => Number(row.Id) === expectedClientId)
    if (!clientRow) {
      throw profileFillerError('profile_client_not_found',
        `Noco client ${expectedClientId} was not found.`, 'resolve_noco')
    }
    const clientName = text(clientRow.client_name) || `client-${expectedClientId}`
    const currentMarket = marketForStatus(clientRow.client_status)
    if (currentMarket !== market) {
      throw profileFillerError('profile_status_changed',
        `Client ${clientName} is no longer in on ${market.toLowerCase()} market status.`,
        'resolve_noco', { currentStatus: text(clientRow.client_status) })
    }

    const responseRows = data.autoresponses.filter(row =>
      clientId(row, 'rel_hhAutoresponses_client') === expectedClientId)
    const overrideValues = responseRows.flatMap(row => linkedRecords(row['Stack Override']))
    const overrideIds = [...new Set(overrideValues.map(row => Number(row.Id)).filter(Boolean))]
    if (overrideIds.length > 1) {
      throw profileFillerError('profile_stack_ambiguous',
        `Multiple Stack Override values found for ${clientName}: ${overrideIds.join(', ')}.`,
        'resolve_stack')
    }
    const stackRelation = overrideValues[0] ?? linkedRecords(clientRow.rel_clients_primary_stack)[0]
    const stackId = Number(stackRelation?.Id ?? clientRow.stacks_id)
    const stackRow = data.stacks.find(row => Number(row.Id) === stackId)
    const stack = text(stackRow?.name ?? stackRow?.stack ?? stackRelation?.name)
    if (!stack) {
      throw profileFillerError('profile_stack_missing',
        `No stack is configured for ${clientName}.`, 'resolve_stack')
    }

    const profiles = data.profiles.filter(row =>
      clientId(row, 'rel_dolphinProfiles_client') === expectedClientId &&
      localeMatches(row.locale, market))
    if (profiles.length !== 1) {
      throw profileFillerError(profiles.length ? 'profile_dolphin_ambiguous' : 'profile_dolphin_missing',
        `${profiles.length || 'No'} Dolphin ${market} profile rows found for ${clientName}.`,
        'resolve_dolphin', { rowIds: profiles.map(row => row.Id) })
    }
    const dolphinProfileId = Number(profiles[0].dolphin_profile_id)
    if (!Number.isInteger(dolphinProfileId) || dolphinProfileId <= 0) {
      throw profileFillerError('profile_dolphin_invalid',
        `Dolphin profile id is invalid for ${clientName}.`, 'resolve_dolphin')
    }

    const cvCandidates = data.cvRows.filter(row =>
      clientId(row, 'rel_cvProcessing_client') === expectedClientId &&
      FINAL_CV_STATUSES.has(normalized(row.status)) &&
      text(market === 'Ru' ? row.ru_version_url : row.en_version_url))
      .sort((left, right) => recordTimestamp(right) - recordTimestamp(left) ||
        Number(right.Id) - Number(left.Id))
    const cvRow = cvCandidates[0]
    if (!cvRow) {
      throw profileFillerError('profile_cv_not_ready',
        `A confirmed final ${market} CV is not available for ${clientName}.`, 'resolve_cv')
    }

    const accounts = data.accounts.filter(row =>
      clientId(row, 'rel_platformAccounts_client') === expectedClientId)
    const hhAccount = uniqueAccount(accounts,
      row => platformId(row) === HH_PLATFORM_IDS[market] ||
        accountLabel(row).includes(`hh ${market.toLowerCase()}`), `hh_${market.toLowerCase()}`)
    const phoneAccount = uniqueAccount(accounts, row => {
      const label = accountLabel(row)
      return label.includes('phone en') || platformId(row) === 28 || label === 'phone'
    }, 'phone_en')
    const telegramAccount = uniqueAccount(accounts, row => {
      const label = accountLabel(row)
      return label.includes(`telegram ${market.toLowerCase()}`) ||
        (label.includes('telegram') && accounts.filter(item =>
          accountLabel(item).includes(`telegram ${market.toLowerCase()}`)).length === 0)
    }, `telegram_${market.toLowerCase()}`)

    const contacts: ContactData = {
      email: accountValue(hhAccount ?? ({} as NocoRecord), 'login', 'email'),
      phone: accountValue(phoneAccount ?? ({} as NocoRecord), 'login', 'phone', 'foreign_number'),
      telegram: accountValue(telegramAccount ?? ({} as NocoRecord), 'nickname', 'login'),
      linkedin: undefined,
      other: []
    }

    return {
      clientId: expectedClientId,
      clientName,
      currentStatus: text(clientRow.client_status),
      market,
      stack,
      dolphinProfileId,
      cvUrl: text(market === 'Ru' ? cvRow.ru_version_url : cvRow.en_version_url),
      cvRevision: text(cvRow.UpdatedAt ?? cvRow.Id),
      studentFolderUrl: text(cvRow.student_data_folder_url) || text(clientRow.google_folder) || undefined,
      contacts,
      fallbacks: {
        fullName: text(clientRow.fio) || text(clientRow.client_name) || undefined,
        firstName: text(clientRow.first_name) || undefined,
        lastName: text(clientRow.last_name) || undefined,
        birthDate: text(clientRow.birth_date) || undefined,
        location: text(clientRow.desired_location) || text(clientRow.real_location) || undefined,
        education: text(clientRow.education_entries) || text(clientRow.education) || undefined,
        englishLevel: relationName(clientRow['English level']) ||
          relationName(clientRow.english_level) || undefined
      },
      credentials: {
        login: accountValue(hhAccount ?? ({} as NocoRecord), 'login', 'phone', 'email'),
        password: accountValue(hhAccount ?? ({} as NocoRecord), 'password')
      }
    }
  }

  return { listClients, resolveClient, snapshot }
}
