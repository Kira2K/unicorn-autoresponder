const { createNocoClient } = require('../core/client.ts') as {
  createNocoClient(): any
}
const { describeError } = require('../core/errors.ts') as {
  describeError(error: any): string
}
const { parseJobArgs } = require('../core/job.ts') as {
  parseJobArgs(args?: string[]): { apply: boolean; test: boolean }
}
const { createReportDir, writeJson, writeText } = require('../core/reports.ts') as {
  createReportDir(jobName: string): string
  writeJson(dir: string, fileName: string, data: unknown): void
  writeText(dir: string, fileName: string, content: string): void
}
const { RELATIONS, TABLES } = require('../core/schema.ts') as {
  RELATIONS: Record<string, string>
  TABLES: Record<string, { id: string; title: string }>
}
const {
  addBindingTag,
  fetchDolphinProfileDetails,
  fetchDolphinProfileInventory
} = require('../integrations/dolphin.ts') as {
  addBindingTag(profileId: number, tag: string): Promise<void>
  fetchDolphinProfileDetails(profileId: number): Promise<{ tags?: string[] }>
  fetchDolphinProfileInventory(): Promise<any[]>
}
const {
  buildAuditReport,
  renderManualReview,
  runTests,
  summarizeReport
} = require('./logic.ts') as {
  buildAuditReport(input: any): any
  renderManualReview(report: any): string
  runTests(): void
  summarizeReport(report: any): Record<string, unknown>
}

const JOB_NAME = 'nocodb-dolphin-profile-audit'

function applyClientIdScope(): number | undefined {
  const raw = String(process.env.NOCO_DOLPHIN_PROFILE_AUDIT_CLIENT_ID ?? '').trim()
  if (!raw) {
    return undefined
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('NOCO_DOLPHIN_PROFILE_AUDIT_CLIENT_ID must be a positive record Id.')
  }
  return value
}

function isApplyTarget(item: any, clientIdScope = applyClientIdScope()): boolean {
  return !clientIdScope || Number(item.clientId) === clientIdScope
}

function writeReport(dir: string, report: any): void {
  writeJson(dir, 'summary.json', summarizeReport(report))
  writeJson(dir, 'safe-bindings.json', report.safeBindings)
  writeJson(dir, 'profile-exists-not-bound.json', report.profileExistsNotBound)
  writeJson(dir, 'intentional-clients-without-paid-profiles.json', report.missingExpectedProfiles)
  writeJson(dir, 'noco-profile-missing-in-dolphin.json', report.nocoProfileMissingInDolphin)
  writeJson(dir, 'conflicts-and-duplicates.json', {
    conflictsAndDuplicates: report.conflictsAndDuplicates,
    existingNocoProfileDuplicates: report.existingNocoProfileDuplicates,
    skippedClients: report.skippedClients
  })
  writeJson(dir, 'ignored-dolphin-profiles.json', report.ignoredDolphinProfiles)
  writeText(dir, 'manual-review.md', renderManualReview(report))
}

function extractCreatedRecordId(value: any): number | null {
  if (typeof value?.Id === 'number') {
    return value.Id
  }
  if (typeof value?.id === 'number') {
    return value.id
  }
  if (Array.isArray(value) && value[0]) {
    return extractCreatedRecordId(value[0])
  }
  if (Array.isArray(value?.list) && value.list[0]) {
    return extractCreatedRecordId(value.list[0])
  }

  return null
}

async function createNocoDolphinProfileRecord(
  item: any,
  client = createNocoClient()
): Promise<{ ok: boolean; record?: unknown; error?: string }> {
  if (!item.dolphinProfile?.id) {
    return { ok: false, error: 'Missing Dolphin profile id.' }
  }

  const record = {
    client_name: item.clientName,
    locale: item.market,
    dolphin_profile_id: item.dolphinProfile.id
  }

  try {
    if (item.nocoProfile?.Id) {
      const patched = await client.patchRecord(
        TABLES.dolphinProfiles.id,
        Number(item.nocoProfile.Id),
        record
      )
      return { ok: true, record: patched }
    }

    const created = await client.createRecord(TABLES.dolphinProfiles.id, record)
    return { ok: true, record: created }
  } catch (error: any) {
    return { ok: false, error: describeError(error) }
  }
}

async function findDolphinProfileClientRelationFieldId(client = createNocoClient()): Promise<string | null> {
  const meta = await client.fetchTableMeta(TABLES.dolphinProfiles.id)
  const columns = meta.columns ?? []
  const byTitle = columns.find((column: any) => column.title === RELATIONS.dolphinProfilesClient)
  if (byTitle?.id) {
    return byTitle.id
  }

  const byRelatedClient = columns.find((column: any) => {
    const options = column.colOptions ?? {}
    return (
      (column.uidt === 'LinkToAnotherRecord' || column.uidt === 'Links') &&
      (options.fk_related_model_id === TABLES.clients.id ||
        options.fk_parent_model_id === TABLES.clients.id)
    )
  })

  return byRelatedClient?.id ?? null
}

async function linkDolphinProfileToClient(
  relationFieldId: string,
  profileRecordId: number,
  clientRecordId: number,
  client = createNocoClient()
): Promise<{ ok: boolean; error?: string }> {
  const bodies = [
    [{ Id: clientRecordId }],
    { Id: clientRecordId },
    { data: [{ Id: clientRecordId }] }
  ]

  for (const body of bodies) {
    try {
      await client.request(
        'post',
        `/api/v2/tables/${TABLES.dolphinProfiles.id}/links/${relationFieldId}/records/${profileRecordId}`,
        body
      )
      return { ok: true }
    } catch (error: any) {
      const status = error?.response?.status
      if (status !== 400 && status !== 404 && status !== 422) {
        return { ok: false, error: describeError(error) }
      }
    }
  }

  return { ok: false, error: 'NocoDB rejected all known link payload shapes.' }
}

async function applySafeBindings(report: any, client = createNocoClient()): Promise<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = []
  const clientIdScope = applyClientIdScope()
  const relationFieldId = await findDolphinProfileClientRelationFieldId(client)
  const tagTargets = [
    ...report.safeBindings,
    ...report.safeMissingNocoBindings
  ].filter(item => item.dolphinProfile?.id && isApplyTarget(item, clientIdScope))
  const safeMissingNocoBindings = report.safeMissingNocoBindings.filter((item: any) =>
    isApplyTarget(item, clientIdScope)
  )

  for (const item of safeMissingNocoBindings) {
    const createResult = await createNocoDolphinProfileRecord(item, client)
    results.push({
      action: item.nocoProfile?.Id
        ? 'patch_noco_dolphin_profile_record'
        : 'create_noco_dolphin_profile_record',
      clientLabel: item.clientLabel,
      market: item.market,
      dolphinProfile: item.dolphinProfile,
      ...createResult
    })

    const profileRecordId =
      Number(item.nocoProfile?.Id) || extractCreatedRecordId(createResult.record)
    if (createResult.ok && relationFieldId && profileRecordId) {
      const linkResult = await linkDolphinProfileToClient(
        relationFieldId,
        profileRecordId,
        item.clientId,
        client
      )
      results.push({
        action: 'link_noco_dolphin_profile_to_client',
        clientLabel: item.clientLabel,
        market: item.market,
        profileRecordId,
        clientRecordId: item.clientId,
        ...linkResult
      })
    } else if (createResult.ok && !relationFieldId) {
      results.push({
        action: 'link_noco_dolphin_profile_to_client',
        ok: false,
        clientLabel: item.clientLabel,
        market: item.market,
        error: 'Could not find Dolphin profiles -> clients relation field.'
      })
    }
    await client.wait(120)
  }

  for (const item of tagTargets) {
    try {
      await addBindingTag(Number(item.dolphinProfile?.id), item.tag)
      results.push({
        action: 'add_dolphin_profile_tag',
        ok: true,
        clientLabel: item.clientLabel,
        market: item.market,
        dolphinProfile: item.dolphinProfile,
        tag: item.tag
      })
    } catch (error: any) {
      results.push({
        action: 'add_dolphin_profile_tag',
        ok: false,
        clientLabel: item.clientLabel,
        market: item.market,
        dolphinProfile: item.dolphinProfile,
        tag: item.tag,
        error: describeError(error)
      })
    }
    await client.wait(120)
  }

  return {
    createdNocoBindings: results.filter(item => item.action === 'create_noco_dolphin_profile_record' && item.ok).length,
    patchedNocoBindings: results.filter(item => item.action === 'patch_noco_dolphin_profile_record' && item.ok).length,
    linkedNocoBindings: results.filter(item => item.action === 'link_noco_dolphin_profile_to_client' && item.ok).length,
    taggedDolphinProfiles: results.filter(item => item.action === 'add_dolphin_profile_tag' && item.ok).length,
    applyScope: clientIdScope ? `client:${clientIdScope}` : 'all',
    skippedSafeMissingBindings: report.safeMissingNocoBindings.length - safeMissingNocoBindings.length,
    skippedTagTargets: report.safeBindings.length + report.safeMissingNocoBindings.length - tagTargets.length,
    failed: results.filter(item => !item.ok).length,
    results
  }
}

async function fetchDolphinProfileTags(dolphinProfiles: any[], client = createNocoClient()): Promise<Record<string, string[]>> {
  const dolphinProfileTags: Record<string, string[]> = {}
  for (const profile of dolphinProfiles) {
    const profileId = Number(profile.id)
    if (!Number.isFinite(profileId)) {
      continue
    }
    try {
      const fullProfile = await fetchDolphinProfileDetails(profileId)
      dolphinProfileTags[String(profile.id)] = Array.isArray(fullProfile.tags)
        ? fullProfile.tags
        : []
    } catch (error: any) {
      dolphinProfileTags[String(profile.id)] = [
        `tag_fetch_error:${describeError(error)}`
      ]
    }
    await client.wait(80)
  }
  return dolphinProfileTags
}

async function runAudit(apply: boolean): Promise<void> {
  const client = createNocoClient()
  const dir = createReportDir(JOB_NAME)
  const [clients, nocoProfiles, dolphinProfiles] = await Promise.all([
    client.fetchRecords(TABLES.clients.id, 100),
    client.fetchRecords(TABLES.dolphinProfiles.id, 100),
    fetchDolphinProfileInventory()
  ])
  const dolphinProfileTags = await fetchDolphinProfileTags(dolphinProfiles, client)

  const report = buildAuditReport({
    clients,
    nocoProfiles,
    dolphinProfiles,
    dolphinProfileTags
  })
  writeReport(dir, report)

  if (apply) {
    const result = await applySafeBindings(report, client)
    writeJson(dir, 'apply-result.json', result)
  } else {
    writeJson(dir, 'apply-result.json', {
      skipped: true,
      reason: 'dry_run',
      safeMissingNocoBindings: report.safeMissingNocoBindings.length,
      taggableSafeBindings: report.safeBindings.length + report.safeMissingNocoBindings.length
    })
  }

  console.log(`Report: ${dir}`)
  console.log(JSON.stringify(summarizeReport(report), null, 2))
}

if (require.main === module) {
  const args = parseJobArgs()
  if (args.test) {
    runTests()
    console.log('noco:dolphin-profile-audit tests passed')
  } else {
    runAudit(args.apply).catch((error: any) => {
      console.error(describeError(error))
      process.exitCode = 1
    })
  }
}

module.exports = {
  applySafeBindings,
  createNocoDolphinProfileRecord,
  fetchDolphinProfileTags,
  findDolphinProfileClientRelationFieldId,
  linkDolphinProfileToClient,
  runAudit,
  writeReport
}
