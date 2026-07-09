const assert = require('node:assert/strict')
const {
  getLinkedRecordId
} = require('../core/relations.ts') as {
  getLinkedRecordId(value: unknown): number | null
}
const {
  isEnabled,
  normalizeId,
  resolveStack,
  responseField
} = require('../../../platform/db/noco/noco-db.ts') as {
  isEnabled(value: unknown): boolean
  normalizeId(value: unknown): string
  resolveStack(
    row: NocoRecord,
    client: NocoRecord,
    clientName: string,
    stacks: NocoRecord[]
  ): { id: number | null; name: string; source: string; row?: NocoRecord }
  responseField(market: Market): string
}

type NocoRecord = Record<string, unknown> & { Id: number }
type Market = 'Ru' | 'En'
type IssueSeverity = 'warning' | 'error'
type RowStatus = 'ok' | 'warning' | 'error'

type DolphinProfileDetail = {
  id: string
  name?: string
  tags?: string[]
  proxy?: {
    id?: string | number
    name?: string
    host?: string
  } | null
  error?: string
}

type ValidationIssue = {
  severity: IssueSeverity
  code: string
  message: string
}

type ValidationRow = {
  kind: 'enabled_target' | 'linked_profile_slot'
  status: RowStatus
  clientId: number | null
  clientName: string
  market: Market
  stack: string
  stackSource: string
  hhAutoresponseRowId?: number
  enabledField?: string
  includedBecause?: string
  nocoProfileRowId?: number
  nocoProfileLocale?: string
  nocoProfileClientId?: number | null
  dolphinProfileId?: string
  dolphinProfileName?: string
  dolphinProxyName?: string
  dolphinProxyHost?: string
  tags: string[]
  issues: ValidationIssue[]
}

type ValidationReport = {
  checkedAt: string
  totalTargets: number
  totalRows: number
  summary: {
    totalTargets: number
    linkedProfileSlots: number
    totalRows: number
    ok: number
    warning: number
    error: number
    issueCounts: Record<string, number>
  }
  rows: ValidationRow[]
}

type NocoState = {
  clients: NocoRecord[]
  autoresponseRows: NocoRecord[]
  profiles: NocoRecord[]
  stacks: NocoRecord[]
}

type EnabledTarget = {
  row: NocoRecord
  market: Market
  enabledField: string
  clientId: number | null
  client?: NocoRecord
  clientName: string
  stack: string
  stackSource: string
  issues: ValidationIssue[]
}

type LinkedProfileSlot = {
  profile: NocoRecord
  client: NocoRecord
  clientId: number
  clientName: string
  market: Market
  stack: string
  stackSource: string
  sourceMarket: Market
  sourceAutoresponseRowId: number
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeProfileId(value: unknown): string {
  return normalizeId(value)
}

function positiveNumber(value: unknown): number | null {
  const id = Number(value)
  return Number.isFinite(id) && id > 0 ? id : null
}

function linkedId(value: unknown): number | null {
  return getLinkedRecordId(value)
}

function rowClientId(row: NocoRecord): number | null {
  return linkedId(row.rel_hhAutoresponses_client) ?? positiveNumber(row.clients_id)
}

function profileClientId(profile: NocoRecord): number | null {
  return linkedId(profile.rel_dolphinProfiles_client) ?? positiveNumber(profile.clients_id)
}

function normalizeMarket(value: unknown): Market | '' {
  const normalized = normalizeText(value)
  if (normalized === 'ru') return 'Ru'
  if (normalized === 'en' || normalized === 'eng') return 'En'
  return ''
}

function profileMarket(profile: NocoRecord): Market | '' {
  return normalizeMarket(profile.locale)
}

function canonicalBindingTag(clientName: string, clientId: number): string {
  return `binded, to ${clientName}, noco:${clientId}`
}

function normalizeTagKey(value: unknown): string {
  return normalizeText(value).replace(/\s*:\s*/g, ':')
}

function parseNocoClientIdsFromTags(tags: string[]): number[] {
  const ids: number[] = []
  const seen = new Set<number>()

  for (const tag of tags) {
    for (const match of tag.matchAll(/noco\s*:\s*(\d+)/ig)) {
      const id = Number(match[1])
      if (Number.isFinite(id) && id > 0 && !seen.has(id)) {
        ids.push(id)
        seen.add(id)
      }
    }
  }

  return ids
}

function tokenizeMarketText(value: unknown): string[] {
  const normalized = normalizeText(value)
  if (!normalized) return []
  return normalized
    .split(/[^\p{L}\p{N}]+/u)
    .map(token => token.trim())
    .filter(Boolean)
}

function marketTokens(market: Market): Set<string> {
  return market === 'Ru'
    ? new Set(['ru', 'rus', 'russian'])
    : new Set(['en', 'eng', 'english'])
}

function textHasMarketMarker(value: unknown, market: Market): boolean {
  const tokens = tokenizeMarketText(value)
  const expected = marketTokens(market)
  return tokens.some(token => expected.has(token))
}

function oppositeMarket(market: Market): Market {
  return market === 'Ru' ? 'En' : 'Ru'
}

function addIssue(
  issues: ValidationIssue[],
  severity: IssueSeverity,
  code: string,
  message: string
): void {
  issues.push({ severity, code, message })
}

function rowStatus(issues: ValidationIssue[]): RowStatus {
  if (issues.some(issue => issue.severity === 'error')) return 'error'
  if (issues.some(issue => issue.severity === 'warning')) return 'warning'
  return 'ok'
}

function buildClientsById(clients: NocoRecord[]): Map<number, NocoRecord> {
  return new Map(clients.map(client => [Number(client.Id), client]))
}

function getClientName(client: NocoRecord | undefined, fallback = ''): string {
  return String(client?.client_name ?? fallback).trim()
}

function getEnabledTargets(state: NocoState): EnabledTarget[] {
  const clientsById = buildClientsById(state.clients)
  const targets: EnabledTarget[] = []

  for (const row of state.autoresponseRows) {
    for (const market of ['Ru', 'En'] as Market[]) {
      const enabledField = responseField(market)
      if (!isEnabled(row[enabledField])) {
        continue
      }

      const issues: ValidationIssue[] = []
      const clientId = rowClientId(row)
      const client = clientId ? clientsById.get(clientId) : undefined
      let clientName = ''
      let stack = ''
      let stackSource = ''

      if (!clientId) {
        addIssue(
          issues,
          'error',
          'missing_client_relation',
          'Enabled HH autoresponse row has no linked clients record.'
        )
      } else if (!client) {
        addIssue(
          issues,
          'error',
          'client_not_found',
          `Enabled HH autoresponse row points to missing client ${clientId}.`
        )
      } else {
        clientName = getClientName(client)
        if (!clientName) {
          addIssue(issues, 'warning', 'missing_client_name', `Client ${clientId} has no client_name.`)
        }

        try {
          const resolvedStack = resolveStack(row, client, clientName || `client:${clientId}`, state.stacks)
          stack = String(resolvedStack.name ?? '').trim()
          stackSource = String(resolvedStack.source ?? '').trim()
          if (!stack) {
            addIssue(
              issues,
              'warning',
              'missing_stack',
              `Client ${clientId} has no resolved stack for enabled ${market} target.`
            )
          }
        } catch (error: any) {
          addIssue(
            issues,
            'error',
            'stack_resolution_failed',
            String(error?.message ?? error)
          )
        }
      }

      targets.push({
        row,
        market,
        enabledField,
        clientId,
        client,
        clientName,
        stack,
        stackSource,
        issues
      })
    }
  }

  return targets
}

function findNocoMarketProfiles(
  profiles: NocoRecord[],
  clientId: number,
  market: Market
): NocoRecord[] {
  return profiles.filter(profile =>
    profileClientId(profile) === clientId &&
    profileMarket(profile) === market
  )
}

function validateDolphinDetail(
  row: ValidationRow,
  detail: DolphinProfileDetail | undefined,
  clientName: string,
  clientId: number,
  market: Market
): void {
  if (!row.dolphinProfileId) {
    return
  }

  if (!detail) {
    addIssue(
      row.issues,
      'error',
      'dolphin_profile_detail_missing',
      `Dolphin profile ${row.dolphinProfileId} was not loaded for validation.`
    )
    return
  }

  if (detail.error) {
    addIssue(
      row.issues,
      'error',
      'dolphin_profile_fetch_failed',
      `Dolphin profile ${row.dolphinProfileId} could not be fetched: ${detail.error}`
    )
    return
  }

  const tags = Array.isArray(detail.tags) ? detail.tags : []
  row.dolphinProfileName = String(detail.name ?? '').trim()
  row.dolphinProxyName = String(detail.proxy?.name ?? '').trim()
  row.dolphinProxyHost = String(detail.proxy?.host ?? '').trim()
  row.tags = tags

  const textSources = [
    { label: 'profile name', value: row.dolphinProfileName },
    { label: 'proxy name', value: row.dolphinProxyName }
  ].filter(source => source.value)

  const opposite = oppositeMarket(market)
  const contradictorySources = textSources.filter(source => textHasMarketMarker(source.value, opposite))
  if (contradictorySources.length) {
    addIssue(
      row.issues,
      'error',
      'dolphin_market_marker_contradiction',
      `${market} target resolves to Dolphin text with ${opposite} marker: ${contradictorySources
        .map(source => `${source.label} "${source.value}"`)
        .join('; ')}.`
    )
  }

  const hasExpectedMarker = textSources.some(source => textHasMarketMarker(source.value, market))
  if (!hasExpectedMarker) {
    addIssue(
      row.issues,
      'warning',
      'missing_expected_market_marker',
      `Dolphin profile ${row.dolphinProfileId} has no clear ${market} marker in profile/proxy name.`
    )
  }

  const tagClientIds = parseNocoClientIdsFromTags(tags)
  const wrongTagClientIds = tagClientIds.filter(id => id !== clientId)
  if (wrongTagClientIds.length) {
    addIssue(
      row.issues,
      'error',
      'dolphin_tag_client_mismatch',
      `Dolphin tags point to another Noco client: ${wrongTagClientIds.join(', ')}; expected ${clientId}.`
    )
  }

  const canonicalTag = canonicalBindingTag(clientName, clientId)
  const hasCanonicalTag = tags.some(tag => normalizeTagKey(tag) === normalizeTagKey(canonicalTag))
  if (!hasCanonicalTag) {
    addIssue(
      row.issues,
      'warning',
      'missing_canonical_binding_tag',
      `Dolphin profile ${row.dolphinProfileId} is missing canonical tag "${canonicalTag}".`
    )
  }
}

function buildValidationRow(
  target: EnabledTarget,
  state: NocoState,
  dolphinProfilesById: Record<string, DolphinProfileDetail>
): ValidationRow {
  const row: ValidationRow = {
    kind: 'enabled_target',
    status: 'ok',
    clientId: target.clientId,
    clientName: target.clientName,
    market: target.market,
    stack: target.stack,
    stackSource: target.stackSource,
    hhAutoresponseRowId: Number(target.row.Id),
    enabledField: target.enabledField,
    tags: [],
    issues: [...target.issues]
  }

  if (!target.clientId || !target.client) {
    row.status = rowStatus(row.issues)
    return row
  }

  const matches = findNocoMarketProfiles(state.profiles, target.clientId, target.market)
  if (!matches.length) {
    addIssue(
      row.issues,
      'error',
      'missing_noco_market_profile',
      `No Noco dolphin_profiles row is linked to client ${target.clientId} with locale ${target.market}.`
    )
    row.status = rowStatus(row.issues)
    return row
  }

  if (matches.length > 1) {
    addIssue(
      row.issues,
      'error',
      'ambiguous_noco_market_profile',
      `Multiple Noco dolphin_profiles rows match client ${target.clientId} ${target.market}: ${matches
        .map(profile => profile.Id)
        .join(', ')}.`
    )
    row.status = rowStatus(row.issues)
    return row
  }

  const profile = matches[0]
  const profileId = normalizeProfileId(profile.dolphin_profile_id)
  row.nocoProfileRowId = Number(profile.Id)
  row.nocoProfileLocale = String(profile.locale ?? '').trim()
  row.nocoProfileClientId = profileClientId(profile)
  row.dolphinProfileId = profileId

  if (row.nocoProfileClientId !== target.clientId) {
    addIssue(
      row.issues,
      'error',
      'noco_profile_client_mismatch',
      `Selected Noco profile row ${profile.Id} is linked to client ${String(row.nocoProfileClientId)}, expected ${target.clientId}.`
    )
  }

  if (profileMarket(profile) !== target.market) {
    addIssue(
      row.issues,
      'error',
      'noco_profile_locale_mismatch',
      `Selected Noco profile row ${profile.Id} locale is "${row.nocoProfileLocale}", expected ${target.market}.`
    )
  }

  if (!profileId || !Number.isFinite(Number(profileId)) || Number(profileId) <= 0) {
    addIssue(
      row.issues,
      'error',
      'invalid_dolphin_profile_id',
      `Noco profile row ${profile.Id} has invalid dolphin_profile_id "${profileId || 'empty'}".`
    )
    row.status = rowStatus(row.issues)
    return row
  }

  validateDolphinDetail(
    row,
    dolphinProfilesById[profileId],
    target.clientName || `client:${target.clientId}`,
    target.clientId,
    target.market
  )
  row.status = rowStatus(row.issues)
  return row
}

function buildLinkedProfileSlotRow(
  slot: LinkedProfileSlot,
  dolphinProfilesById: Record<string, DolphinProfileDetail>
): ValidationRow {
  const profile = slot.profile
  const profileId = normalizeProfileId(profile.dolphin_profile_id)
  const row: ValidationRow = {
    kind: 'linked_profile_slot',
    status: 'ok',
    clientId: slot.clientId,
    clientName: slot.clientName,
    market: slot.market,
    stack: slot.stack,
    stackSource: slot.stackSource,
    includedBecause: `Client has enabled ${slot.sourceMarket} target in hh-autoresponses row ${slot.sourceAutoresponseRowId}.`,
    nocoProfileRowId: Number(profile.Id),
    nocoProfileLocale: String(profile.locale ?? '').trim(),
    nocoProfileClientId: profileClientId(profile),
    dolphinProfileId: profileId,
    tags: [],
    issues: []
  }

  if (row.nocoProfileClientId !== slot.clientId) {
    addIssue(
      row.issues,
      'error',
      'noco_profile_client_mismatch',
      `Selected Noco profile row ${profile.Id} is linked to client ${String(row.nocoProfileClientId)}, expected ${slot.clientId}.`
    )
  }

  if (profileMarket(profile) !== slot.market) {
    addIssue(
      row.issues,
      'error',
      'noco_profile_locale_mismatch',
      `Selected Noco profile row ${profile.Id} locale is "${row.nocoProfileLocale}", expected ${slot.market}.`
    )
  }

  if (!profileId || !Number.isFinite(Number(profileId)) || Number(profileId) <= 0) {
    addIssue(
      row.issues,
      'error',
      'invalid_dolphin_profile_id',
      `Noco profile row ${profile.Id} has invalid dolphin_profile_id "${profileId || 'empty'}".`
    )
    row.status = rowStatus(row.issues)
    return row
  }

  validateDolphinDetail(
    row,
    dolphinProfilesById[profileId],
    slot.clientName || `client:${slot.clientId}`,
    slot.clientId,
    slot.market
  )
  row.status = rowStatus(row.issues)
  return row
}

function collectLinkedProfileSlots(state: NocoState, targets: EnabledTarget[]): LinkedProfileSlot[] {
  const enabledKeys = new Set(
    targets
      .filter(target => target.clientId && target.client)
      .map(target => `${target.clientId}:${target.market}`)
  )
  const slots: LinkedProfileSlot[] = []
  const seenProfileRows = new Set<number>()

  for (const target of targets) {
    if (!target.clientId || !target.client) {
      continue
    }

    for (const profile of state.profiles) {
      if (profileClientId(profile) !== target.clientId) {
        continue
      }
      const market = profileMarket(profile)
      if (!market || enabledKeys.has(`${target.clientId}:${market}`)) {
        continue
      }
      if (seenProfileRows.has(Number(profile.Id))) {
        continue
      }

      slots.push({
        profile,
        client: target.client,
        clientId: target.clientId,
        clientName: target.clientName || getClientName(target.client),
        market,
        stack: target.stack,
        stackSource: target.stackSource,
        sourceMarket: target.market,
        sourceAutoresponseRowId: Number(target.row.Id)
      })
      seenProfileRows.add(Number(profile.Id))
    }
  }

  return slots
}

function summarizeRows(rows: ValidationRow[], totalTargets: number): ValidationReport['summary'] {
  const issueCounts: Record<string, number> = {}
  for (const row of rows) {
    for (const issue of row.issues) {
      issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1
    }
  }

  return {
    totalTargets,
    linkedProfileSlots: rows.filter(row => row.kind === 'linked_profile_slot').length,
    totalRows: rows.length,
    ok: rows.filter(row => row.status === 'ok').length,
    warning: rows.filter(row => row.status === 'warning').length,
    error: rows.filter(row => row.status === 'error').length,
    issueCounts
  }
}

function buildMarketBindingReport(input: {
  state: NocoState
  dolphinProfilesById: Record<string, DolphinProfileDetail>
  checkedAt?: string
}): ValidationReport {
  const targets = getEnabledTargets(input.state)
  const targetRows = targets.map(target =>
    buildValidationRow(target, input.state, input.dolphinProfilesById)
  )
  const linkedProfileSlotRows = collectLinkedProfileSlots(input.state, targets).map(slot =>
    buildLinkedProfileSlotRow(slot, input.dolphinProfilesById)
  )
  const rows = [...targetRows, ...linkedProfileSlotRows]

  return {
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    totalTargets: targets.length,
    totalRows: rows.length,
    summary: summarizeRows(rows, targets.length),
    rows
  }
}

function collectRequiredDolphinProfileIds(state: NocoState): string[] {
  const ids: string[] = []
  const seen = new Set<string>()

  for (const target of getEnabledTargets(state)) {
    if (!target.clientId || !target.client) {
      continue
    }
    const matches = findNocoMarketProfiles(state.profiles, target.clientId, target.market)
    if (matches.length !== 1) {
      continue
    }
    const id = normalizeProfileId(matches[0].dolphin_profile_id)
    if (!id || !Number.isFinite(Number(id)) || Number(id) <= 0 || seen.has(id)) {
      continue
    }
    ids.push(id)
    seen.add(id)

    for (const profile of state.profiles) {
      if (profileClientId(profile) !== target.clientId || !profileMarket(profile)) {
        continue
      }
      const siblingId = normalizeProfileId(profile.dolphin_profile_id)
      if (
        !siblingId ||
        !Number.isFinite(Number(siblingId)) ||
        Number(siblingId) <= 0 ||
        seen.has(siblingId)
      ) {
        continue
      }
      ids.push(siblingId)
      seen.add(siblingId)
    }
  }

  return ids
}

function renderManualReview(report: ValidationReport): string {
  const lines = [
    '# Dolphin Market Binding Dry Run',
    '',
    `Checked at: ${report.checkedAt}`,
    `Enabled targets checked: ${report.totalTargets}`,
    `Linked profile slots checked: ${report.summary.linkedProfileSlots}`,
    `Rows checked: ${report.totalRows}`,
    '',
    '## Summary',
    '',
    `- ok: ${report.summary.ok}`,
    `- warning: ${report.summary.warning}`,
    `- error: ${report.summary.error}`,
    '',
    '## Errors',
    ''
  ]

  const errorRows = report.rows.filter(row => row.status === 'error')
  if (!errorRows.length) {
    lines.push('- none')
  }
  for (const row of errorRows) {
    lines.push(
      `- ${row.kind} client ${row.clientId ?? '(missing)'} ${row.clientName || '(unknown)'} ${row.market}: profile ${row.dolphinProfileId ?? '(none)'}`
    )
    for (const issue of row.issues.filter(issue => issue.severity === 'error')) {
      lines.push(`  - ${issue.code}: ${issue.message}`)
    }
  }

  lines.push('', '## Warnings', '')
  const warningRows = report.rows.filter(row =>
    row.issues.some(issue => issue.severity === 'warning')
  )
  if (!warningRows.length) {
    lines.push('- none')
  }
  for (const row of warningRows) {
    lines.push(
      `- ${row.kind} client ${row.clientId ?? '(missing)'} ${row.clientName || '(unknown)'} ${row.market}: profile ${row.dolphinProfileId ?? '(none)'}`
    )
    for (const issue of row.issues.filter(issue => issue.severity === 'warning')) {
      lines.push(`  - ${issue.code}: ${issue.message}`)
    }
  }

  return `${lines.join('\n')}\n`
}

function baseState(): NocoState {
  return {
    clients: [
      { Id: 24, client_name: 'Vsevolod Nasonov', rel_clients_primary_stack: { Id: 1, name: 'React' } },
      { Id: 25, client_name: 'Wrong Client', rel_clients_primary_stack: { Id: 1, name: 'React' } }
    ],
    autoresponseRows: [
      {
        Id: 100,
        rel_hhAutoresponses_client: { Id: 24, client_name: 'Vsevolod Nasonov' },
        [responseField('Ru')]: true,
        [responseField('En')]: false
      }
    ],
    profiles: [
      {
        Id: 83,
        locale: 'ru',
        dolphin_profile_id: '800729368',
        rel_dolphinProfiles_client: { Id: 24, client_name: 'Vsevolod Nasonov' }
      }
    ],
    stacks: [{ Id: 1, name: 'React' }]
  }
}

function details(...items: DolphinProfileDetail[]): Record<string, DolphinProfileDetail> {
  return Object.fromEntries(items.map(item => [item.id, item]))
}

function issueCodes(row: ValidationRow): string[] {
  return row.issues.map(issue => issue.code)
}

function runTests(): void {
  const okReport = buildMarketBindingReport({
    state: baseState(),
    dolphinProfilesById: details({
      id: '800729368',
      name: 'Vsevolod Nasonov React RU',
      tags: ['binded, to Vsevolod Nasonov, noco:24']
    }),
    checkedAt: '2026-07-07T00:00:00.000Z'
  })
  assert.equal(okReport.summary.ok, 1)
  assert.equal(okReport.summary.error, 0)
  assert.deepEqual(issueCodes(okReport.rows[0]), [])

  const wrongMarketReport = buildMarketBindingReport({
    state: baseState(),
    dolphinProfilesById: details({
      id: '800729368',
      name: 'Vsevolod Nasonov React EN',
      proxy: { name: 'Vsevolod | React En' },
      tags: ['binded, to Vsevolod Nasonov, noco:24']
    })
  })
  assert.equal(wrongMarketReport.summary.error, 1)
  assert.equal(
    issueCodes(wrongMarketReport.rows[0]).includes('dolphin_market_marker_contradiction'),
    true
  )

  const wrongTagReport = buildMarketBindingReport({
    state: baseState(),
    dolphinProfilesById: details({
      id: '800729368',
      name: 'Vsevolod Nasonov React RU',
      tags: ['binded, to Wrong Client, noco:25']
    })
  })
  assert.equal(wrongTagReport.summary.error, 1)
  assert.equal(issueCodes(wrongTagReport.rows[0]).includes('dolphin_tag_client_mismatch'), true)

  const missingCanonicalReport = buildMarketBindingReport({
    state: baseState(),
    dolphinProfilesById: details({
      id: '800729368',
      name: 'Vsevolod Nasonov React RU',
      tags: ['Transferred']
    })
  })
  assert.equal(missingCanonicalReport.summary.warning, 1)
  assert.equal(missingCanonicalReport.summary.error, 0)
  assert.equal(
    issueCodes(missingCanonicalReport.rows[0]).includes('missing_canonical_binding_tag'),
    true
  )

  const siblingSlotState = baseState()
  siblingSlotState.profiles = [
    {
      Id: 83,
      locale: 'ru',
      dolphin_profile_id: '800729368',
      rel_dolphinProfiles_client: { Id: 24, client_name: 'Vsevolod Nasonov' }
    },
    {
      Id: 17,
      locale: 'en',
      dolphin_profile_id: '790631645',
      rel_dolphinProfiles_client: { Id: 24, client_name: 'Vsevolod Nasonov' }
    }
  ]
  const siblingSlotReport = buildMarketBindingReport({
    state: siblingSlotState,
    dolphinProfilesById: details(
      {
        id: '800729368',
        name: 'Vsevolod Nasonov React RU',
        tags: ['binded, to Vsevolod Nasonov, noco:24']
      },
      {
        id: '790631645',
        name: 'Vsevolod Nasonov React EN',
        proxy: { name: 'Vsevolod | 790631645 | React En' },
        tags: ['Transferred']
      }
    )
  })
  assert.equal(siblingSlotReport.totalTargets, 1)
  assert.equal(siblingSlotReport.totalRows, 2)
  assert.equal(siblingSlotReport.summary.linkedProfileSlots, 1)
  assert.equal(siblingSlotReport.rows.find(row => row.market === 'Ru')?.status, 'ok')
  const siblingEnRow = siblingSlotReport.rows.find(row => row.market === 'En')
  assert.equal(siblingEnRow?.kind, 'linked_profile_slot')
  assert.equal(siblingEnRow?.dolphinProfileId, '790631645')
  assert.equal(siblingEnRow?.status, 'warning')
  assert.equal(issueCodes(siblingEnRow as ValidationRow).includes('missing_canonical_binding_tag'), true)

  const vsevolodState = baseState()
  vsevolodState.autoresponseRows = [
    {
      Id: 100,
      rel_hhAutoresponses_client: { Id: 24, client_name: 'Vsevolod Nasonov' },
      [responseField('Ru')]: true,
      [responseField('En')]: true
    }
  ]
  vsevolodState.profiles = [
    {
      Id: 83,
      locale: 'ru',
      dolphin_profile_id: '800729368',
      rel_dolphinProfiles_client: { Id: 24, client_name: 'Vsevolod Nasonov' }
    },
    {
      Id: 17,
      locale: 'en',
      dolphin_profile_id: '790631645',
      rel_dolphinProfiles_client: { Id: 24, client_name: 'Vsevolod Nasonov' }
    }
  ]
  const vsevolodReport = buildMarketBindingReport({
    state: vsevolodState,
    dolphinProfilesById: details(
      {
        id: '800729368',
        name: 'Vsevolod Nasonov React RU',
        tags: ['binded, to Vsevolod Nasonov, noco:24']
      },
      {
        id: '790631645',
        name: 'Vsevolod Nasonov React EN',
        proxy: { name: 'Vsevolod | 790631645 | React En' },
        tags: ['Transferred']
      }
    )
  })
  assert.equal(vsevolodReport.totalTargets, 2)
  const ruRow = vsevolodReport.rows.find(row => row.market === 'Ru')
  const enRow = vsevolodReport.rows.find(row => row.market === 'En')
  assert.equal(ruRow?.dolphinProfileId, '800729368')
  assert.equal(ruRow?.status, 'ok')
  assert.equal(enRow?.dolphinProfileId, '790631645')
  assert.equal(enRow?.status, 'warning')
  assert.equal(issueCodes(enRow as ValidationRow).includes('missing_canonical_binding_tag'), true)

  assert.deepEqual(collectRequiredDolphinProfileIds(vsevolodState), ['800729368', '790631645'])
  assert.deepEqual(collectRequiredDolphinProfileIds(siblingSlotState), ['800729368', '790631645'])
}

module.exports = {
  buildMarketBindingReport,
  canonicalBindingTag,
  collectRequiredDolphinProfileIds,
  findNocoMarketProfiles,
  normalizeMarket,
  normalizeProfileId,
  parseNocoClientIdsFromTags,
  renderManualReview,
  runTests,
  textHasMarketMarker,
  tokenizeMarketText
}
