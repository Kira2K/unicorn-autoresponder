const assert = require('node:assert/strict')
const {
  getLinkedRecordId
} = require('../core/relations.ts') as {
  getLinkedRecordId(value: unknown): number | null
}

type NocoRecord = Record<string, unknown> & { Id: number }

type DolphinProfileTagSnapshot = {
  id: string
  name: string
  tags: string[]
}

type ClientBinding = {
  clientId: number
  clientName: string
  nocoProfileRowId: number
}

type TagCleanupAction = {
  profileId: string
  profileName: string
  status: 'already_clean' | 'will_update' | 'skipped'
  reason: string
  clientId?: number
  clientName?: string
  beforeTags: string[]
  afterTags: string[]
  removedTags: string[]
  preservedTags: string[]
  canonicalTag?: string
}

type TagCleanupReport = {
  checkedAt: string
  totalProfiles: number
  actions: TagCleanupAction[]
  summary: Record<string, number>
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function normalizeKey(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/ё/g, 'е')
}

function normalizeProfileId(value: unknown): string {
  return String(value ?? '').trim().replace(/\.0$/, '')
}

function uniquePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const key = normalizeKey(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(normalizeText(value))
  }

  return result
}

function canonicalBindingTag(clientName: string, clientId: number): string {
  return `binded, to ${clientName}, noco:${clientId}`
}

function isCanonicalBindingTag(tag: string): boolean {
  return /^binded,\s*to\s+.+,\s*noco\s*:\s*\d+$/i.test(normalizeText(tag))
}

function nocoClientIdFromTag(tag: string): number | null {
  const match = normalizeText(tag).match(/^noco\s*:\s*(\d+)$/i)
  if (!match) return null
  const id = Number(match[1])
  return Number.isFinite(id) && id > 0 ? id : null
}

function isLegacyBindingTag(tag: string): boolean {
  const normalized = normalizeText(tag)

  return (
    /^binded$/i.test(normalized) ||
    /^to\s+.+/i.test(normalized) ||
    /^noco\s*:\s*\d+$/i.test(normalized) ||
    /^client_[a-zа-я]{1,2}_.+/i.test(normalized)
  )
}

function profileClientId(profile: NocoRecord): number | null {
  const linkedId = getLinkedRecordId(profile.rel_dolphinProfiles_client)
  const rawId = Number(profile.clients_id)
  return linkedId ?? (Number.isFinite(rawId) && rawId > 0 ? rawId : null)
}

function buildClientBindings(input: {
  nocoProfiles: NocoRecord[]
  clients: NocoRecord[]
}): Map<string, ClientBinding | { conflict: string }> {
  const clientsById = new Map(input.clients.map(client => [Number(client.Id), client]))
  const grouped = new Map<string, NocoRecord[]>()

  for (const profile of input.nocoProfiles) {
    const dolphinProfileId = normalizeProfileId(profile.dolphin_profile_id)
    if (!dolphinProfileId) continue
    grouped.set(dolphinProfileId, [...(grouped.get(dolphinProfileId) ?? []), profile])
  }

  const bindings = new Map<string, ClientBinding | { conflict: string }>()
  for (const [dolphinProfileId, profiles] of grouped.entries()) {
    const clientIds = uniquePreservingOrder(
      profiles
        .map(profile => profileClientId(profile))
        .filter((id): id is number => Boolean(id))
        .map(String)
    ).map(Number)

    if (clientIds.length !== 1) {
      bindings.set(dolphinProfileId, {
        conflict: clientIds.length
          ? `multiple_noco_clients:${clientIds.join(',')}`
          : 'missing_noco_client_relation'
      })
      continue
    }

    const client = clientsById.get(clientIds[0])
    const clientName = normalizeText(client?.client_name)
    if (!client || !clientName) {
      bindings.set(dolphinProfileId, { conflict: `missing_client:${clientIds[0]}` })
      continue
    }

    bindings.set(dolphinProfileId, {
      clientId: clientIds[0],
      clientName,
      nocoProfileRowId: Number(profiles[0].Id)
    })
  }

  return bindings
}

function classifyProfileTags(
  profile: DolphinProfileTagSnapshot,
  binding: ClientBinding | { conflict: string } | undefined
): TagCleanupAction {
  const beforeTags = uniquePreservingOrder(profile.tags)
  const tagClientIds = uniquePreservingOrder(
    beforeTags
      .map(nocoClientIdFromTag)
      .filter((id): id is number => Boolean(id))
      .map(String)
  ).map(Number)
  const legacyTags = beforeTags.filter(isLegacyBindingTag)
  const canonicalTags = beforeTags.filter(isCanonicalBindingTag)
  const preservedTags = beforeTags.filter(
    tag => !isLegacyBindingTag(tag) && !isCanonicalBindingTag(tag)
  )

  if (!binding) {
    return {
      profileId: profile.id,
      profileName: profile.name,
      status: legacyTags.length || canonicalTags.length ? 'skipped' : 'already_clean',
      reason: legacyTags.length || canonicalTags.length ? 'missing_noco_profile_binding' : 'no_binding_tags',
      beforeTags,
      afterTags: beforeTags,
      removedTags: [],
      preservedTags
    }
  }

  if ('conflict' in binding) {
    return {
      profileId: profile.id,
      profileName: profile.name,
      status: 'skipped',
      reason: binding.conflict,
      beforeTags,
      afterTags: beforeTags,
      removedTags: [],
      preservedTags
    }
  }

  if (!legacyTags.length && !canonicalTags.length) {
    return {
      profileId: profile.id,
      profileName: profile.name,
      status: 'already_clean',
      reason: 'no_binding_tags',
      beforeTags,
      afterTags: beforeTags,
      removedTags: [],
      preservedTags,
      clientId: binding.clientId,
      clientName: binding.clientName
    }
  }

  if (tagClientIds.length > 1) {
    return {
      profileId: profile.id,
      profileName: profile.name,
      status: 'skipped',
      reason: `multiple_tag_client_ids:${tagClientIds.join(',')}`,
      beforeTags,
      afterTags: beforeTags,
      removedTags: [],
      preservedTags,
      clientId: binding.clientId,
      clientName: binding.clientName
    }
  }

  if (tagClientIds.length === 1 && tagClientIds[0] !== binding.clientId) {
    return {
      profileId: profile.id,
      profileName: profile.name,
      status: 'skipped',
      reason: `tag_client_mismatch:${tagClientIds[0]}!=${binding.clientId}`,
      beforeTags,
      afterTags: beforeTags,
      removedTags: [],
      preservedTags,
      clientId: binding.clientId,
      clientName: binding.clientName
    }
  }

  const canonicalTag = canonicalBindingTag(binding.clientName, binding.clientId)
  if (
    !legacyTags.length &&
    canonicalTags.length === 1 &&
    normalizeKey(canonicalTags[0]) === normalizeKey(canonicalTag)
  ) {
    return {
      profileId: profile.id,
      profileName: profile.name,
      status: 'already_clean',
      reason: 'canonical_binding_already_clean',
      clientId: binding.clientId,
      clientName: binding.clientName,
      beforeTags,
      afterTags: beforeTags,
      removedTags: [],
      preservedTags,
      canonicalTag
    }
  }

  const afterTags = uniquePreservingOrder([...preservedTags, canonicalTag])
  const removedTags = beforeTags.filter(tag => !afterTags.some(next => normalizeKey(next) === normalizeKey(tag)))
  const beforeKeys = beforeTags.map(normalizeKey)
  const afterKeys = afterTags.map(normalizeKey)
  const changed =
    beforeKeys.length !== afterKeys.length ||
    beforeKeys.some((key, index) => key !== afterKeys[index])

  return {
    profileId: profile.id,
    profileName: profile.name,
    status: changed ? 'will_update' : 'already_clean',
    reason: changed ? 'normalize_binding_tags' : 'canonical_binding_already_clean',
    clientId: binding.clientId,
    clientName: binding.clientName,
    beforeTags,
    afterTags,
    removedTags,
    preservedTags,
    canonicalTag
  }
}

function buildTagCleanupReport(input: {
  profiles: DolphinProfileTagSnapshot[]
  nocoProfiles: NocoRecord[]
  clients: NocoRecord[]
  checkedAt?: string
}): TagCleanupReport {
  const bindings = buildClientBindings({
    nocoProfiles: input.nocoProfiles,
    clients: input.clients
  })
  const actions = input.profiles.map(profile =>
    classifyProfileTags(profile, bindings.get(normalizeProfileId(profile.id)))
  )
  const summary: Record<string, number> = {}

  for (const action of actions) {
    summary[action.status] = (summary[action.status] ?? 0) + 1
    summary[action.reason] = (summary[action.reason] ?? 0) + 1
  }

  return {
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    totalProfiles: input.profiles.length,
    actions,
    summary
  }
}

function runTests(): void {
  const clients: NocoRecord[] = [
    { Id: 84, client_name: 'Кирилл Шумаев' },
    { Id: 1, client_name: 'Кира' }
  ]
  const nocoProfiles: NocoRecord[] = [
    { Id: 10, dolphin_profile_id: '795169945', rel_dolphinProfiles_client: { Id: 84 } },
    { Id: 11, dolphin_profile_id: '770032142', rel_dolphinProfiles_client: { Id: 1 } },
    { Id: 12, dolphin_profile_id: '999', rel_dolphinProfiles_client: { Id: 1 } }
  ]

  const kirill = classifyProfileTags(
    {
      id: '795169945',
      name: 'Кирилл Шумаев React Ru',
      tags: [
        'binded',
        'to Кирилл Шумаев',
        'client_at_кирилл_шумаев',
        'binded',
        'to Кирилл Шумаев',
        'noco:84',
        'Автоотклики',
        'не трогай'
      ]
    },
    { clientId: 84, clientName: 'Кирилл Шумаев', nocoProfileRowId: 10 }
  )
  assert.equal(kirill.status, 'will_update')
  assert.deepEqual(kirill.afterTags, [
    'Автоотклики',
    'не трогай',
    'binded, to Кирилл Шумаев, noco:84'
  ])

  const canonical = classifyProfileTags(
    {
      id: '770032142',
      name: 'Kira',
      tags: ['manual', 'binded, to Кира, noco:1']
    },
    { clientId: 1, clientName: 'Кира', nocoProfileRowId: 11 }
  )
  assert.equal(canonical.status, 'already_clean')
  assert.deepEqual(canonical.afterTags, ['manual', 'binded, to Кира, noco:1'])

  const mismatch = classifyProfileTags(
    {
      id: '770032142',
      name: 'Kira',
      tags: ['binded', 'to Wrong', 'noco:84']
    },
    { clientId: 1, clientName: 'Кира', nocoProfileRowId: 11 }
  )
  assert.equal(mismatch.status, 'skipped')
  assert.equal(mismatch.reason, 'tag_client_mismatch:84!=1')

  const multipleIds = classifyProfileTags(
    {
      id: '770032142',
      name: 'Kira',
      tags: ['noco:1', 'noco:84']
    },
    { clientId: 1, clientName: 'Кира', nocoProfileRowId: 11 }
  )
  assert.equal(multipleIds.status, 'skipped')
  assert.equal(multipleIds.reason, 'multiple_tag_client_ids:1,84')

  const unbound = classifyProfileTags(
    {
      id: 'no-row',
      name: 'No Row',
      tags: ['binded', 'to Someone', 'noco:1']
    },
    undefined
  )
  assert.equal(unbound.status, 'skipped')
  assert.equal(unbound.reason, 'missing_noco_profile_binding')

  const report = buildTagCleanupReport({
    clients,
    nocoProfiles,
    profiles: [
      { id: '795169945', name: 'Кирилл Шумаев React Ru', tags: ['binded', 'client_at_кирилл_шумаев', 'noco:84'] },
      { id: '770032142', name: 'Kira', tags: ['binded, to Кира, noco:1'] },
      { id: '999', name: 'No visible binding tags', tags: ['manual'] }
    ],
    checkedAt: '2026-06-22T00:00:00.000Z'
  })
  assert.equal(report.totalProfiles, 3)
  assert.equal(report.summary.will_update, 1)
  assert.equal(report.summary.already_clean, 2)
  assert.equal(report.actions[2].reason, 'no_binding_tags')
  assert.deepEqual(report.actions[2].afterTags, ['manual'])
}

module.exports = {
  buildClientBindings,
  buildTagCleanupReport,
  canonicalBindingTag,
  classifyProfileTags,
  isCanonicalBindingTag,
  isLegacyBindingTag,
  nocoClientIdFromTag,
  normalizeProfileId,
  runTests,
  uniquePreservingOrder
}
