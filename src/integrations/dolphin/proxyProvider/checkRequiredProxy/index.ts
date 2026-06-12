require('dotenv').config({ quiet: true })

const fs = require('node:fs/promises')
const path = require('node:path')
const { createAppDb } = require('../../../../platform/db/index.ts') as {
  createAppDb(): {
    getProxyRequiredClients(market?: 'En' | 'Ru'): Promise<any[]>
  }
}
const { SHEET_NAMES } = require('../../../../platform/db/schema.ts') as {
  SHEET_NAMES: {
    personalData: string
  }
}
const {
  getAllDolphinProfileSnapshots,
  getAllDolphinProxySnapshots,
  getDolphinProfileSnapshot
} = require('./dolphin-api.ts') as {
  getAllDolphinProfileSnapshots(): Promise<any[]>
  getAllDolphinProxySnapshots(): Promise<any[]>
  getDolphinProfileSnapshot(profileId: string): Promise<any>
}
const {
  classifyProxyClient,
  findMatchingExistingProfiles,
  findExactProxyMatches,
  normalizeMarket,
  validateProxyName
} = require('./logic.ts') as {
  classifyProxyClient(input: any): any
  findMatchingExistingProfiles(
    profiles: any[],
    client: any,
    market: 'En' | 'Ru'
  ): any[]
  findExactProxyMatches(proxies: any[], proxyName: string): any[]
  normalizeMarket(value: unknown): 'En' | 'Ru'
  validateProxyName(proxyName: string, client: any, market: 'En' | 'Ru'): any
}

type RunOptions = {
  market?: 'En' | 'Ru'
  outputRoot?: string
  redactProxyConnectionValues?: boolean
}

function parseCliArgs(argv: string[]): RunOptions {
  const options: RunOptions = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--market') {
      options.market = normalizeMarket(argv[index + 1])
      index += 1
      continue
    }

    if (arg.startsWith('--market=')) {
      options.market = normalizeMarket(arg.slice('--market='.length))
      continue
    }

    if (arg === '--output') {
      options.outputRoot = argv[index + 1]
      index += 1
      continue
    }

    if (arg.startsWith('--output=')) {
      options.outputRoot = arg.slice('--output='.length)
      continue
    }

    if (arg === '--redact-proxy-connections') {
      options.redactProxyConnectionValues = true
      continue
    }

    if (arg === '--no-redact-proxy-connections') {
      options.redactProxyConnectionValues = false
      continue
    }

    throw new Error(`Unsupported argument: ${arg}`)
  }

  return options
}

function shouldRedactProxyConnectionValues(options: RunOptions): boolean {
  if (options.redactProxyConnectionValues !== undefined) {
    return options.redactProxyConnectionValues
  }

  const envValue = String(
    process.env.PROXY_PROVIDER_REDACT_PROXY_CONNECTIONS ?? ''
  )
    .trim()
    .toLowerCase()

  if (['0', 'false', 'no', 'off'].includes(envValue)) {
    return false
  }

  return false
}

function createRunDirectory(outputRoot?: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const root =
    outputRoot ??
    path.resolve(__dirname, 'reports')

  return path.join(root, timestamp)
}

function toMarkdownTable(results: any[]): string {
  const header = [
    'status',
    'issues',
    'notes',
    'market',
    'firstName',
    'secondName',
    'stack',
    'chatId',
    'profileId',
    'sheetProxyName',
    'checkedProxySource',
    'checkedProxyName'
  ]
  const escapeCell = (value: unknown) =>
    String(Array.isArray(value) ? value.join(', ') : (value ?? ''))
      .replace(/\r?\n/g, ' ')
      .replace(/\|/g, '\\|')
  const lines = [
    `| ${header.join(' |')} |`,
    `| ${header.map(() => '---').join(' | ')} |`
  ]

  for (const result of results) {
    lines.push(`| ${header.map(key => escapeCell(result[key])).join(' | ')} |`)
  }

  return `${lines.join('\n')}\n`
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function getResultsWithIssue(results: any[], issue: string): any[] {
  return results.filter(result => result.issues.includes(issue))
}

function countResultsWithIssue(results: any[], issue: string): number {
  return getResultsWithIssue(results, issue).length
}

function hydrateProfileProxyFromInventory(profile: any, proxyInventory: any[]): any {
  if (!profile?.proxyId || profile.proxy?.name) {
    return profile
  }

  const inventoryProxy = proxyInventory.find(
    proxy => String(proxy.id ?? '') === String(profile.proxyId)
  )

  if (!inventoryProxy) {
    return profile
  }

  return {
    ...profile,
    proxy: inventoryProxy
  }
}

function findCorrectProxyNameMatches(
  proxyInventory: any[],
  result: any
): any[] {
  return proxyInventory.filter(proxy => {
    const proxyName = String(proxy.name ?? '').trim()

    return proxyName && validateProxyName(proxyName, result, result.market).valid
  })
}

function looksLikeProxyConnectionValue(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()

  return (
    normalized.includes('://') ||
    normalized.includes('@') ||
    /^(?:\d{1,3}\.){3}\d{1,3}:\d+(?:$|[:/])/.test(normalized) ||
    /^[a-z0-9.-]+\.[a-z]{2,}:\d+(?:$|[:/])/.test(normalized)
  )
}

function redactProxyConnectionValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  return looksLikeProxyConnectionValue(value)
    ? '[proxy_connection_value_redacted]'
    : value
}

function redactProxyCredentialsForReport(
  value: any,
  shouldRedact = true
): any {
  if (!shouldRedact) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(entry => redactProxyCredentialsForReport(entry, shouldRedact))
  }

  if (!value || typeof value !== 'object') {
    return redactProxyConnectionValue(value)
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      redactProxyCredentialsForReport(entryValue, shouldRedact)
    ])
  )
}

function addCorrectProxyMatchesToResults(
  results: any[],
  proxyInventory: any[]
): any[] {
  return results.map(result => ({
    ...result,
    correctProxyNameMatches: findCorrectProxyNameMatches(proxyInventory, result)
  }))
}

function getInvalidProxyOwnNameResults(
  results: any[],
  proxyInventory: any[],
  options: { redactProxyConnectionValues?: boolean } = {}
): any[] {
  return redactProxyCredentialsForReport(addCorrectProxyMatchesToResults(
    getResultsWithIssue(results, 'invalid_proxy_name').filter(
      result => result.checkedProxySource !== 'sheet'
    ),
    proxyInventory
  ), options.redactProxyConnectionValues ?? false)
}

function getInvalidProxySavedNameResults(
  results: any[],
  proxyInventory: any[],
  options: { redactProxyConnectionValues?: boolean } = {}
): any[] {
  return redactProxyCredentialsForReport(addCorrectProxyMatchesToResults(
    results
      .map(result => {
        const sheetProxyName = String(result.sheetProxyName ?? '').trim()

        if (!sheetProxyName) {
          return undefined
        }

        const sheetProxyNameValidation = validateProxyName(
          sheetProxyName,
          result,
          result.market
        )

        if (sheetProxyNameValidation.valid) {
          return undefined
        }

        return {
          ...result,
          sheetProxyNameValidation
        }
      })
      .filter(Boolean),
    proxyInventory
  ), options.redactProxyConnectionValues ?? false)
}

function getCorrectProxyNameFromDolphinResult(result: any): string {
  const checkedProxyName = String(result.checkedProxyName ?? '').trim()

  if (
    checkedProxyName &&
    result.checkedProxySource !== 'sheet' &&
    result.proxyNameValidation?.valid
  ) {
    return checkedProxyName
  }

  return String(result.correctProxyNameMatches?.[0]?.name ?? '').trim()
}

function toInvalidProxySavedNameMapText(results: any[]): string {
  return results
    .map(result => {
      const correctProxyName = getCorrectProxyNameFromDolphinResult(result)

      if (!correctProxyName) {
        return ''
      }

      return `${result.firstName} >>> ${correctProxyName}`
    })
    .filter(Boolean)
    .join('\n')
    .concat('\n')
}

function toRunSummaryText(input: {
  payload: any
  invalidProxyOwnNameResults: any[]
  invalidProxySavedNameResults: any[]
  runDirectory?: string
}): string {
  const { payload, invalidProxyOwnNameResults, invalidProxySavedNameResults } = input
  const results = payload.results ?? []
  const invalidProxySavedNameMapCount = toInvalidProxySavedNameMapText(
    invalidProxySavedNameResults
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean).length
  const lines = [
    `generatedAt: ${payload.generatedAt}`,
    `market: ${payload.market}`,
    `sourceSheet: ${payload.sourceSheet}`,
    `total: ${payload.total}`,
    `ok: ${payload.counts?.ok ?? 0}`,
    `needs_proxy: ${payload.counts?.needs_proxy ?? 0}`,
    `data_mismatch: ${payload.counts?.data_mismatch ?? 0}`,
    `error: ${payload.counts?.error ?? 0}`,
    `missing_profile_id: ${countResultsWithIssue(results, 'missing_profile_id')}`,
    `profile_exists_but_not_connected: ${countResultsWithIssue(results, 'profile_exists_but_not_connected')}`,
    `invalid_proxy_own_name: ${invalidProxyOwnNameResults.length}`,
    `invalid_proxy_saved_name: ${invalidProxySavedNameResults.length}`,
    `invalid_proxy_saved_name_map: ${invalidProxySavedNameMapCount}`
  ]

  if (input.runDirectory) {
    lines.push(`runDirectory: ${input.runDirectory}`)
  }

  return `${lines.join('\n')}\n`
}

function addCorrectProxyMatchesToInvalidProxyNameResults(
  results: any[],
  proxyInventory: any[]
): any[] {
  return getInvalidProxyOwnNameResults(results, proxyInventory)
}

async function runRequiredProxyCheck(options: RunOptions = {}) {
  const market = options.market ?? 'En'
  const redactProxyConnectionValues = shouldRedactProxyConnectionValues(options)
  const runDirectory = createRunDirectory(options.outputRoot)
  const logLines: string[] = []
  const log = (message: string) => {
    const line = `[${new Date().toISOString()}] ${message}`

    logLines.push(line)
    console.log(line)
  }

  await fs.mkdir(runDirectory, { recursive: true })
  log(`Proxy required check started. market=${market}`)
  log(`Proxy connection value redaction: ${redactProxyConnectionValues ? 'on' : 'off'}`)
  log(`Reading source through app DB: ${SHEET_NAMES.personalData}`)

  try {
    const clients = await createAppDb().getProxyRequiredClients(market)

    log(`Selected clients with Id общего чата: ${clients.length}`)
    log('Reading Dolphin proxy and profile inventories once for this run.')

    const [proxyInventory, profileInventory] = await Promise.all([
      getAllDolphinProxySnapshots(),
      getAllDolphinProfileSnapshots()
    ])

    log(`Dolphin proxies loaded: ${proxyInventory.length}`)
    log(`Dolphin profiles loaded: ${profileInventory.length}`)

    const results = []
    const checkedAt = new Date().toISOString()

    for (const client of clients) {
      let dolphinProfile
      let dolphinProfileError

      if (/^\d+$/.test(client.profileId)) {
        try {
          dolphinProfile = hydrateProfileProxyFromInventory(
            await getDolphinProfileSnapshot(client.profileId),
            proxyInventory
          )
          log(
            `Profile checked: column=${client.columnIndex}, name=${client.firstName}, profileId=${client.profileId}`
          )
        } catch (error: unknown) {
          dolphinProfileError =
            error instanceof Error ? error.message : String(error)
          log(
            `Profile check failed: column=${client.columnIndex}, name=${client.firstName}, profileId=${client.profileId}, error=${dolphinProfileError}`
          )
        }
      }

      const inventoryProxyMatches = findExactProxyMatches(
        proxyInventory,
        client.sheetProxyName
      )
      const matchedExistingProfiles = client.profileId
        ? []
        : findMatchingExistingProfiles(profileInventory, client, market)
      const result = classifyProxyClient({
        client,
        market,
        dolphinProfile,
        dolphinProfileError,
        matchedExistingProfiles,
        inventoryProxyMatches,
        checkedAt
      })

      results.push(result)
      log(
        `Client status: column=${client.columnIndex}, name=${client.firstName}, status=${result.status}, issues=${result.issues.join(',') || 'none'}, notes=${result.notes.join(',') || 'none'}`
      )
    }

    const counts = results.reduce((acc: Record<string, number>, result: any) => {
      acc[result.status] = (acc[result.status] ?? 0) + 1

      return acc
    }, {})

    const payload = {
      generatedAt: new Date().toISOString(),
      market,
      sourceSheet: SHEET_NAMES.personalData,
      total: results.length,
      counts,
      results
    }

    await writeJson(path.join(runDirectory, 'status.json'), payload)
    await fs.writeFile(
      path.join(runDirectory, 'status.md'),
      toMarkdownTable(results),
      'utf8'
    )
    await writeJson(
      path.join(runDirectory, 'needs-proxy.json'),
      results.filter(result => result.status === 'needs_proxy')
    )
    await writeJson(
      path.join(runDirectory, 'missing-profile-id-errors.json'),
      getResultsWithIssue(results, 'missing_profile_id')
    )
    await writeJson(
      path.join(runDirectory, 'profile-exists-but-not-connected-errors.json'),
      getResultsWithIssue(results, 'profile_exists_but_not_connected')
    )
    const invalidProxyOwnNameResults = getInvalidProxyOwnNameResults(
      results,
      proxyInventory,
      {
        redactProxyConnectionValues
      }
    )

    await writeJson(
      path.join(runDirectory, 'invalid-proxy-own-name-errors.json'),
      invalidProxyOwnNameResults
    )
    const invalidProxySavedNameResults = getInvalidProxySavedNameResults(
      results,
      proxyInventory,
      {
        redactProxyConnectionValues
      }
    )

    await writeJson(
      path.join(runDirectory, 'invalid-proxy-saved-name-errors.json'),
      invalidProxySavedNameResults
    )
    await fs.writeFile(
      path.join(runDirectory, 'invalid-proxy-saved-name-map.txt'),
      toInvalidProxySavedNameMapText(invalidProxySavedNameResults),
      'utf8'
    )
    await writeJson(
      path.join(runDirectory, 'data-mismatch-errors.json'),
      results.filter(result => result.status === 'data_mismatch')
    )
    const summaryText = toRunSummaryText({
      payload,
      invalidProxyOwnNameResults,
      invalidProxySavedNameResults,
      runDirectory
    })

    await fs.writeFile(path.join(runDirectory, 'summary.txt'), summaryText, 'utf8')
    await fs.writeFile(path.join(path.dirname(runDirectory), 'latest.txt'), `${runDirectory}\n`, 'utf8')

    log(`Counts: ${JSON.stringify(counts)}`)
    log(`Reports written to: ${runDirectory}`)
    await fs.writeFile(path.join(runDirectory, 'run.log'), `${logLines.join('\n')}\n`, 'utf8')

    return payload
  } catch (error: unknown) {
    const message = error instanceof Error ? error.stack || error.message : String(error)

    log(`Fatal error: ${message}`)
    await fs.writeFile(path.join(runDirectory, 'run.log'), `${logLines.join('\n')}\n`, 'utf8')
    throw error
  }
}

if (require.main === module) {
  runRequiredProxyCheck(parseCliArgs(process.argv.slice(2))).catch(
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  )
}

module.exports = {
  addCorrectProxyMatchesToInvalidProxyNameResults,
  getInvalidProxyOwnNameResults,
  getInvalidProxySavedNameResults,
  parseCliArgs,
  runRequiredProxyCheck,
  toInvalidProxySavedNameMapText,
  toRunSummaryText
}
