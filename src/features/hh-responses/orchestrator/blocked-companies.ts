type ClientAutomationData = import('./types.ts').ClientAutomationData
type BlockedCompany = import('../../../../shared/company-stop-list.ts').BlockedCompany
const {
  compactCompanyName,
  normalizeBlockedCompanies
} = require('../../../../shared/company-stop-list.ts') as {
  compactCompanyName(value: unknown): string
  normalizeBlockedCompanies(blockedCompanies: unknown): BlockedCompany[]
}

const GLOBAL_BLOCKED_COMPANIES: BlockedCompany[] = [
  { id: 'global-comtek', name: 'Comtek' }
]

function slugifyBlockedCompanyId(value: unknown): string {
  const compact = compactCompanyName(value)
  return compact
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'company'
}

function splitCompanyList(value: unknown): string[] {
  return String(value ?? '')
    .split(/[;,\n]/)
    .map(item => item.trim())
    .map(item => item.replace(/^["'`]+|["'`]+$/g, '').trim())
    .filter(Boolean)
}

function addBlockedCompany(
  companiesByKey: Map<string, BlockedCompany>,
  company: BlockedCompany
): void {
  const key = compactCompanyName(company.name)
  if (!key || companiesByKey.has(key)) {
    return
  }

  companiesByKey.set(key, company)
}

function parseRunExtraBlockedCompanies(value = process.env.ORCHESTRATOR_EXTRA_BLOCKED_COMPANIES): BlockedCompany[] {
  const raw = String(value ?? '').trim()
  if (!raw) {
    return []
  }

  if (raw.startsWith('[')) {
    try {
      return normalizeBlockedCompanies(JSON.parse(raw))
    } catch {
      return []
    }
  }

  return splitCompanyList(raw).map(companyName => ({
    id: `run-extra-stop-list:${slugifyBlockedCompanyId(companyName)}`,
    name: companyName
  }))
}

function mergeBlockedCompanies(...sources: unknown[]): BlockedCompany[] {
  const companiesByKey = new Map<string, BlockedCompany>()

  for (const source of sources) {
    for (const company of normalizeBlockedCompanies(source)) {
      addBlockedCompany(companiesByKey, company)
    }
  }

  return [...companiesByKey.values()]
}

function attachBlockedCompanies(
  clients: ClientAutomationData[]
): ClientAutomationData[] {
  const runExtraBlockedCompanies = parseRunExtraBlockedCompanies()

  return clients.map(client => ({
    ...client,
    blockedCompanies: mergeBlockedCompanies(
      GLOBAL_BLOCKED_COMPANIES,
      client.blockedCompanies,
      runExtraBlockedCompanies
    )
  }))
}

module.exports = {
  GLOBAL_BLOCKED_COMPANIES,
  attachBlockedCompanies,
  mergeBlockedCompanies,
  parseRunExtraBlockedCompanies
}
