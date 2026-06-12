const assert = require('node:assert/strict')
const {
  getDolphinProfileNameCandidates
} = require('../integrations/dolphin.ts') as {
  getDolphinProfileNameCandidates(client: {
    firstName: string
    secondName: string
    stack: string
  }, market: 'Ru' | 'En'): Array<{ format: string; name: string }>
}
const {
  formatLinkedRelationLabel,
  getLinkedRecord,
  getLinkedRecordId
} = require('../core/relations.ts') as {
  formatLinkedRelationLabel(value: unknown): string
  getLinkedRecord(value: unknown): Record<string, unknown> | null
  getLinkedRecordId(value: unknown): number | null
}

type NocoRecord = Record<string, unknown> & { Id: number }
type ClientMarket = 'ru' | 'en' | 'both'
type ProfileMarket = 'ru' | 'en'

type DolphinProfileSnapshot = {
  id: string
  name?: string
  proxyId?: string
  proxy?: unknown
}

type ExpectedSlot = {
  clientId: number
  clientLabel: string
  clientName: string
  stack: string
  market: ProfileMarket
  tag: string
  candidates: string[]
}

type AuditCase = {
  category:
    | 'safe_existing_binding'
    | 'safe_missing_noco_binding'
    | 'missing_expected_profile'
    | 'noco_profile_missing_in_dolphin'
    | 'conflict_or_duplicate'
  reason: string
  clientId: number
  clientLabel: string
  clientName: string
  stack: string
  market: ProfileMarket
  tag: string
  candidates: string[]
  nocoProfile?: Record<string, unknown>
  dolphinProfile?: DolphinProfileSnapshot
  dolphinProfiles?: DolphinProfileSnapshot[]
  existingBindedTags?: string[]
  notes: string[]
}

type AuditReport = {
  checkedAt: string
  expectedSlots: ExpectedSlot[]
  safeBindings: AuditCase[]
  safeMissingNocoBindings: AuditCase[]
  missingExpectedProfiles: AuditCase[]
  profileExistsNotBound: AuditCase[]
  nocoProfileMissingInDolphin: AuditCase[]
  conflictsAndDuplicates: AuditCase[]
  ignoredDolphinProfiles: AuditCase[]
  skippedClients: Array<Record<string, unknown>>
  existingNocoProfileDuplicates: Array<Record<string, unknown>>
}

const INTENTIONALLY_IGNORED_DOLPHIN_PROFILES: Record<string, string> = {
  '798038485': 'User-confirmed ignore for now: Мария Е Fullstack Ru.',
  '798037209': 'User-confirmed ignore for now: Мария Е Fullstack En.',
  '797134760': 'User-confirmed keep-both duplicate: Руслан Исхаков already has EN profile 791180993 bound in Noco.'
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
}

function normalizeProfileId(value: unknown): string {
  return String(value ?? '').trim().replace(/\.0$/, '')
}

function normalizeMarket(value: unknown): ClientMarket | '' {
  const linkedMarket = getLinkedRecord(value)
  if (linkedMarket) {
    return normalizeMarket(
      linkedMarket.market ??
      linkedMarket.name ??
      linkedMarket.title ??
      linkedMarket.value
    )
  }

  const normalized = normalizeText(value)
    .replace(/\s+/g, '')
    .replace(/[\\|,+]+/g, '/')

  if (normalized === 'ru' || normalized === 'ру') {
    return 'ru'
  }
  if (normalized === 'en' || normalized === 'eng') {
    return 'en'
  }
  if (
    normalized === 'both' ||
    normalized === 'ru/en' ||
    normalized === 'en/ru' ||
    normalized === 'ruen' ||
    normalized === 'enru'
  ) {
    return 'both'
  }

  return ''
}

function expectedMarketsForClient(market: unknown): ProfileMarket[] {
  const normalized = normalizeMarket(market)
  if (normalized === 'ru') {
    return ['ru']
  }
  if (normalized === 'en' || normalized === 'both') {
    return ['ru', 'en']
  }
  return []
}

function firstNameFromClientName(clientName: unknown): string {
  return String(clientName ?? '').trim().split(/\s+/).filter(Boolean)[0] ?? ''
}

function secondNameFromClientName(clientName: unknown): string {
  const tokens = String(clientName ?? '').trim().split(/\s+/).filter(Boolean)
  return tokens.length > 1 ? tokens.join(' ') : ''
}

function getClientStack(client: NocoRecord): string {
  const linkedStack = getLinkedRecord(client.rel_clients_primary_stack)
  return String(
      linkedStack?.stack ??
      linkedStack?.name ??
      linkedStack?.stack_name ??
      client.stack ??
      client.stack_name ??
      ''
  ).trim()
}

function getCandidateNames(input: {
  clientName: string
  stack: string
  market: ProfileMarket
}): string[] {
  const firstName = firstNameFromClientName(input.clientName)
  const secondName = secondNameFromClientName(input.clientName)
  const market = input.market === 'ru' ? 'Ru' : 'En'

  return getDolphinProfileNameCandidates(
    {
      firstName,
      secondName,
      stack: input.stack
    },
    market
  ).map(candidate => candidate.name)
}

function makeBindedTag(clientName: string, clientId: number): string {
  return `binded, to ${clientName}, noco:${clientId}`
}

function buildExpectedSlots(clients: NocoRecord[]): {
  slots: ExpectedSlot[]
  skippedClients: Array<Record<string, unknown>>
} {
  const slots: ExpectedSlot[] = []
  const skippedClients: Array<Record<string, unknown>> = []

  for (const client of clients) {
    const clientName = String(client.client_name ?? '').trim()
    const clientLabel = `${client.Id} ${clientName}`.trim()
    const stack = getClientStack(client)
    const markets = expectedMarketsForClient(client.market)

    if (!clientName || !stack || !markets.length) {
      skippedClients.push({
        Id: client.Id,
        client_name: client.client_name,
        market: client.market,
        stack,
        reason: 'missing_client_name_stack_or_supported_market'
      })
      continue
    }

    for (const market of markets) {
      const candidates = getCandidateNames({ clientName, stack, market })
      slots.push({
        clientId: client.Id,
        clientLabel,
        clientName,
        stack,
        market,
        tag: makeBindedTag(clientName, client.Id),
        candidates
      })
    }
  }

  return { slots, skippedClients }
}

function nocoProfileMarket(profile: NocoRecord): ProfileMarket | '' {
  const locale = normalizeText(profile.locale)
  if (locale === 'ru' || locale === 'en') {
    return locale
  }

  return ''
}

function nocoProfileClientId(profile: NocoRecord): number | null {
  return getLinkedRecordId(profile.rel_dolphinProfiles_client)
}

function nocoProfileMatchesSlot(profile: NocoRecord, slot: ExpectedSlot): boolean {
  const linkedClientId = nocoProfileClientId(profile)
  if (linkedClientId) {
    return linkedClientId === slot.clientId
  }
  return false
}

function safeNocoProfile(profile: NocoRecord): Record<string, unknown> {
  return {
    Id: profile.Id,
    client_name: profile.client_name,
    locale: profile.locale,
    dolphin_profile_id: normalizeProfileId(profile.dolphin_profile_id),
    relation_status: profile.relation_status,
    relation_notes: profile.relation_notes,
    rel_client_id: nocoProfileClientId(profile),
    rel_client_label: formatLinkedRelationLabel(profile.rel_dolphinProfiles_client)
  }
}

function safeDolphinProfile(profile: DolphinProfileSnapshot): DolphinProfileSnapshot {
  return {
    id: profile.id,
    name: profile.name,
    proxyId: profile.proxyId
  }
}

function ignoredDolphinProfileReason(profileId: string): string | undefined {
  return INTENTIONALLY_IGNORED_DOLPHIN_PROFILES[profileId]
}

function isDolphinProfileSnapshot(
  profile: DolphinProfileSnapshot | undefined
): profile is DolphinProfileSnapshot {
  return Boolean(profile)
}

function caseBase(
  category: AuditCase['category'],
  reason: string,
  slot: ExpectedSlot
): AuditCase {
  return {
    category,
    reason,
    clientId: slot.clientId,
    clientLabel: slot.clientLabel,
    clientName: slot.clientName,
    stack: slot.stack,
    market: slot.market,
    tag: slot.tag,
    candidates: slot.candidates,
    notes: []
  }
}

function buildAuditReport(input: {
  clients: NocoRecord[]
  nocoProfiles: NocoRecord[]
  dolphinProfiles: DolphinProfileSnapshot[]
  dolphinProfileTags?: Record<string, string[]>
  checkedAt?: string
}): AuditReport {
  const { slots, skippedClients } = buildExpectedSlots(input.clients)
  const checkedAt = input.checkedAt ?? new Date().toISOString()
  const dolphinById = new Map(
    input.dolphinProfiles.map(profile => [normalizeProfileId(profile.id), profile])
  )
  const nocoProfilesById = new Map<string, NocoRecord[]>()

  for (const profile of input.nocoProfiles) {
    const id = normalizeProfileId(profile.dolphin_profile_id)
    if (!id) {
      continue
    }
    nocoProfilesById.set(id, [...(nocoProfilesById.get(id) ?? []), profile])
  }

  const existingNocoProfileDuplicates = [...nocoProfilesById.entries()]
    .filter(([, profiles]) => profiles.length > 1)
    .map(([dolphinProfileId, profiles]) => ({
      dolphinProfileId,
      nocoProfiles: profiles.map(safeNocoProfile)
    }))

  const allCandidateKeys = new Set<string>()
  for (const slot of slots) {
    for (const candidate of slot.candidates) {
      allCandidateKeys.add(normalizeText(candidate))
    }
  }

  const safeBindings: AuditCase[] = []
  const safeMissingNocoBindings: AuditCase[] = []
  const missingExpectedProfiles: AuditCase[] = []
  const profileExistsNotBound: AuditCase[] = []
  const nocoProfileMissingInDolphin: AuditCase[] = []
  const conflictsAndDuplicates: AuditCase[] = []
  const ignoredDolphinProfiles: AuditCase[] = []
  const usedDolphinIds = new Map<string, ExpectedSlot[]>()

  for (const slot of slots) {
    const slotNocoProfiles = input.nocoProfiles.filter(profile => {
      return (
        nocoProfileMatchesSlot(profile, slot) &&
        nocoProfileMarket(profile) === slot.market
      )
    })
    const slotNocoWithIds = slotNocoProfiles.filter(profile =>
      normalizeProfileId(profile.dolphin_profile_id)
    )

    if (slotNocoWithIds.length > 1) {
      const item = caseBase(
        'conflict_or_duplicate',
        'multiple_noco_profiles_for_expected_slot',
        slot
      )
      item.notes.push('Expected exactly one NocoDB profile row for client/market slot.')
      item.dolphinProfiles = slotNocoWithIds
        .map(profile => dolphinById.get(normalizeProfileId(profile.dolphin_profile_id)))
        .filter(isDolphinProfileSnapshot)
        .map(safeDolphinProfile)
      item.nocoProfile = { profiles: slotNocoWithIds.map(safeNocoProfile) }
      conflictsAndDuplicates.push(item)
      continue
    }

    const nocoProfile = slotNocoWithIds[0]
    if (nocoProfile) {
      const dolphinId = normalizeProfileId(nocoProfile.dolphin_profile_id)
      const dolphinProfile = dolphinById.get(dolphinId)
      const item = caseBase(
        dolphinProfile ? 'safe_existing_binding' : 'noco_profile_missing_in_dolphin',
        dolphinProfile ? 'existing_noco_binding_found_in_dolphin' : 'noco_profile_id_not_found_in_dolphin',
        slot
      )
      item.nocoProfile = safeNocoProfile(nocoProfile)

      if (dolphinProfile) {
        const bindedTags = (input.dolphinProfileTags?.[dolphinId] ?? []).filter(tag =>
          normalizeText(tag).startsWith('binded')
        )
        item.existingBindedTags = bindedTags

        if (bindedTags.length && !bindedTags.includes(slot.tag)) {
          item.notes.push(`Legacy Dolphin binded tags kept untouched: ${bindedTags.join('; ')}`)
        }

        item.dolphinProfile = safeDolphinProfile(dolphinProfile)
        safeBindings.push(item)
        usedDolphinIds.set(dolphinId, [...(usedDolphinIds.get(dolphinId) ?? []), slot])
      } else {
        nocoProfileMissingInDolphin.push(item)
      }
      continue
    }

    const matches = input.dolphinProfiles.filter(profile =>
      slot.candidates.some(candidate => normalizeText(candidate) === normalizeText(profile.name))
    )

    if (matches.length === 1) {
      const item = caseBase(
        'safe_missing_noco_binding',
        'dolphin_profile_exists_not_bound_in_noco',
        slot
      )
      const matchedProfileId = normalizeProfileId(matches[0].id)
      const bindedTags = (input.dolphinProfileTags?.[matchedProfileId] ?? []).filter(tag =>
        normalizeText(tag).startsWith('binded')
      )
      item.existingBindedTags = bindedTags
      item.dolphinProfile = safeDolphinProfile(matches[0])

      const emptyNocoRows = slotNocoProfiles.filter(
        profile => !normalizeProfileId(profile.dolphin_profile_id)
      )
      if (emptyNocoRows.length === 1) {
        item.nocoProfile = safeNocoProfile(emptyNocoRows[0])
      }

      if (bindedTags.length && !bindedTags.includes(slot.tag)) {
        item.notes.push(`Legacy Dolphin binded tags kept untouched: ${bindedTags.join('; ')}`)
      }

      safeMissingNocoBindings.push(item)
      profileExistsNotBound.push(item)
      usedDolphinIds.set(matches[0].id, [...(usedDolphinIds.get(matches[0].id) ?? []), slot])
    } else if (matches.length > 1) {
      const item = caseBase(
        'conflict_or_duplicate',
        'multiple_dolphin_profiles_match_expected_slot',
        slot
      )
      item.dolphinProfiles = matches.map(safeDolphinProfile)
      conflictsAndDuplicates.push(item)
    } else {
      missingExpectedProfiles.push(
        caseBase('missing_expected_profile', 'no_dolphin_profile_matched_expected_names', slot)
      )
    }
  }

  for (const [dolphinId, matchedSlots] of usedDolphinIds.entries()) {
    if (matchedSlots.length < 2) {
      continue
    }
    const profile = dolphinById.get(dolphinId)
    conflictsAndDuplicates.push({
      category: 'conflict_or_duplicate',
      reason: 'one_dolphin_profile_matches_multiple_slots',
      clientId: matchedSlots[0].clientId,
      clientLabel: matchedSlots[0].clientLabel,
      clientName: matchedSlots[0].clientName,
      stack: matchedSlots[0].stack,
      market: matchedSlots[0].market,
      tag: matchedSlots[0].tag,
      candidates: matchedSlots.flatMap(slot => slot.candidates),
      dolphinProfile: profile ? safeDolphinProfile(profile) : undefined,
      notes: matchedSlots.map(slot => `${slot.clientName} ${slot.market}`)
    })
  }

  const boundDolphinIds = new Set([
    ...input.nocoProfiles
      .map(profile => normalizeProfileId(profile.dolphin_profile_id))
      .filter(Boolean),
    ...safeMissingNocoBindings
      .map(item => item.dolphinProfile?.id)
      .filter(Boolean)
      .map(String)
  ])

  for (const profile of input.dolphinProfiles) {
    const profileId = normalizeProfileId(profile.id)
    const profileNameKey = normalizeText(profile.name)
    if (!profileId || boundDolphinIds.has(profileId) || allCandidateKeys.has(profileNameKey)) {
      continue
    }

    if (profileNameKey.includes(' ru') || profileNameKey.includes(' en')) {
      const ignoredReason = ignoredDolphinProfileReason(profileId)
      if (ignoredReason) {
        ignoredDolphinProfiles.push({
          category: 'conflict_or_duplicate',
          reason: 'intentionally_ignored_dolphin_profile',
          clientId: 0,
          clientLabel: '',
          clientName: '',
          stack: '',
          market: profileNameKey.endsWith(' en') ? 'en' : 'ru',
          tag: '',
          candidates: [],
          dolphinProfile: safeDolphinProfile(profile),
          notes: [ignoredReason]
        })
        continue
      }

      conflictsAndDuplicates.push({
        category: 'conflict_or_duplicate',
        reason: 'dolphin_profile_name_not_matching_any_expected_slot',
        clientId: 0,
        clientLabel: '',
        clientName: '',
        stack: '',
        market: profileNameKey.endsWith(' en') ? 'en' : 'ru',
        tag: '',
        candidates: [],
        dolphinProfile: safeDolphinProfile(profile),
        notes: ['Review manually: profile looks market-related but was not matched.']
      })
    }
  }

  return {
    checkedAt,
    expectedSlots: slots,
    safeBindings,
    safeMissingNocoBindings,
    missingExpectedProfiles,
    profileExistsNotBound,
    nocoProfileMissingInDolphin,
    conflictsAndDuplicates,
    ignoredDolphinProfiles,
    skippedClients,
    existingNocoProfileDuplicates
  }
}

function summarizeReport(report: AuditReport): Record<string, unknown> {
  return {
    checkedAt: report.checkedAt,
    expectedSlots: report.expectedSlots.length,
    safeExistingBindings: report.safeBindings.length,
    safeMissingNocoBindings: report.safeMissingNocoBindings.length,
    intentionalClientsWithoutPaidProfiles: report.missingExpectedProfiles.length,
    profileExistsNotBound: report.profileExistsNotBound.length,
    nocoProfileMissingInDolphin: report.nocoProfileMissingInDolphin.length,
    conflictsAndDuplicates: report.conflictsAndDuplicates.length,
    ignoredDolphinProfiles: report.ignoredDolphinProfiles.length,
    skippedClients: report.skippedClients.length,
    existingNocoProfileDuplicates: report.existingNocoProfileDuplicates.length
  }
}

function renderManualReview(report: AuditReport): string {
  const lines = [
    '# Dolphin Profile Manual Review',
    '',
    `Checked at: ${report.checkedAt}`,
    '',
    '## Summary',
    '',
    ...Object.entries(summarizeReport(report)).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Conflicts And Duplicates',
    ''
  ]

  for (const item of report.conflictsAndDuplicates) {
    lines.push(
      `- ${item.reason}: ${item.clientName || '(unknown client)'} ${item.market || ''}`,
      `  - candidates: ${item.candidates.join(' | ') || '(none)'}`,
      `  - dolphin: ${item.dolphinProfile ? `${item.dolphinProfile.id} ${item.dolphinProfile.name}` : JSON.stringify(item.dolphinProfiles ?? [])}`,
      `  - notes: ${item.notes.join('; ') || '(none)'}`
    )
  }

  lines.push('', '## Ignored Dolphin Profiles', '')
  for (const item of report.ignoredDolphinProfiles) {
    lines.push(
      `- ${item.dolphinProfile?.id} ${item.dolphinProfile?.name}`,
      `  - notes: ${item.notes.join('; ')}`
    )
  }

  lines.push('', '## Clients Without Paid Dolphin Profiles (Intentional Cost Saving)', '')
  for (const item of report.missingExpectedProfiles) {
    lines.push(`- ${item.clientName} ${item.market}: ${item.candidates.join(' | ')}`)
  }

  lines.push('', '## Noco Profile Missing In Dolphin', '')
  for (const item of report.nocoProfileMissingInDolphin) {
    lines.push(`- ${item.clientName} ${item.market}: ${JSON.stringify(item.nocoProfile)}`)
  }

  lines.push('', '## Existing Noco Profile Duplicates', '')
  for (const duplicate of report.existingNocoProfileDuplicates) {
    lines.push(`- ${JSON.stringify(duplicate)}`)
  }

  return `${lines.join('\n')}\n`
}

function runTests(): void {
  const clients: NocoRecord[] = [
    {
      Id: 1,
      client_name: 'Кира',
      market: 'ru',
      rel_clients_primary_stack: { Id: 1, name: 'Frontend' }
    },
    {
      Id: 2,
      client_name: 'Антон Панфилов',
      market: 'en',
      rel_clients_primary_stack: { Id: 2, name: 'Java' }
    },
    {
      Id: 3,
      client_name: 'Алексей',
      market: 'both',
      rel_clients_primary_stack: { Id: 3, name: 'Python' }
    }
  ]
  const { slots } = buildExpectedSlots(clients)
  assert.deepEqual(
    slots.filter(slot => slot.clientId === 1).map(slot => slot.market),
    ['ru']
  )
  assert.deepEqual(
    slots.filter(slot => slot.clientId === 2).map(slot => slot.market),
    ['ru', 'en']
  )
  assert.deepEqual(
    slots.filter(slot => slot.clientId === 3).map(slot => slot.market),
    ['ru', 'en']
  )

  const linkedMarketClients: NocoRecord[] = [
    {
      Id: 19,
      client_name: 'Дамир Каримов',
      market: { Id: 2, market: 'en' },
      rel_clients_primary_stack: { Id: 2, name: 'Fullstack' }
    }
  ]
  const { slots: linkedMarketSlots, skippedClients } = buildExpectedSlots(linkedMarketClients)
  assert.deepEqual(
    linkedMarketSlots.map(slot => slot.market),
    ['ru', 'en']
  )
  assert.equal(skippedClients.length, 0)

  const damirReport = buildAuditReport({
    clients: linkedMarketClients,
    nocoProfiles: [
      {
        Id: 14,
        client_name: 'Дамир Каримов',
        locale: 'en',
        dolphin_profile_id: '762043028',
        rel_dolphinProfiles_client: { Id: 19, client_name: 'Дамир Каримов' }
      },
      {
        Id: 15,
        client_name: 'Дамир Каримов',
        locale: 'ru',
        dolphin_profile_id: '800760592',
        rel_dolphinProfiles_client: { Id: 19, client_name: 'Дамир Каримов' }
      }
    ],
    dolphinProfiles: [
      { id: '800760592', name: 'Дамир Каримов Fullstack Ru' },
      { id: '762043028', name: 'Дамир Каримов Fullstack EN' }
    ],
    checkedAt: '2026-06-05T00:00:00.000Z'
  })
  assert.equal(damirReport.safeBindings.length, 2)
  assert.equal(damirReport.conflictsAndDuplicates.length, 0)
  assert.equal(damirReport.skippedClients.length, 0)

  const report = buildAuditReport({
    clients,
    nocoProfiles: [
      {
        Id: 10,
        client_name: 'Кира',
        locale: 'ru',
        dolphin_profile_id: '100',
        rel_dolphinProfiles_client: { Id: 1 }
      },
      {
        Id: 11,
        client_name: 'Алексей',
        locale: 'ru',
        dolphin_profile_id: '999',
        rel_dolphinProfiles_client: { Id: 3 }
      }
    ],
    dolphinProfiles: [
      { id: '100', name: 'Кира Frontend Ru' },
      { id: '200', name: 'Антон Панфилов Java En' },
      { id: '201', name: 'Антон Java Ru' },
      { id: '300', name: 'Антон Java Ru' },
      { id: '400', name: 'Bad Name En' }
    ],
    checkedAt: '2026-05-20T00:00:00.000Z'
  })

  assert.equal(report.safeBindings.length, 1)
  assert.equal(report.profileExistsNotBound.length, 1)
  assert.equal(report.nocoProfileMissingInDolphin.length, 1)
  assert.equal(
    report.conflictsAndDuplicates.some(
      item => item.reason === 'multiple_dolphin_profiles_match_expected_slot'
    ),
    true
  )
  assert.equal(
    report.conflictsAndDuplicates.some(
      item => item.reason === 'dolphin_profile_name_not_matching_any_expected_slot'
    ),
    true
  )
  assert.equal(report.missingExpectedProfiles.length, 1)

  const ignoredReport = buildAuditReport({
    clients,
    nocoProfiles: [],
    dolphinProfiles: [
      { id: '797134760', name: 'Руслан Исхаков Python En' }
    ],
    checkedAt: '2026-05-20T00:00:00.000Z'
  })
  assert.equal(ignoredReport.conflictsAndDuplicates.length, 0)
  assert.equal(ignoredReport.ignoredDolphinProfiles.length, 1)
}

module.exports = {
  buildAuditReport,
  buildExpectedSlots,
  expectedMarketsForClient,
  getCandidateNames,
  makeBindedTag,
  normalizeMarket,
  normalizeProfileId,
  normalizeText,
  renderManualReview,
  runTests,
  summarizeReport
}
