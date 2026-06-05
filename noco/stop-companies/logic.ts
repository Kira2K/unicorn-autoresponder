const assert = require('node:assert/strict')
const {
  compactCompanyName,
  normalizeCompanyName
} = require('../../shared/company-stop-list.ts') as {
  compactCompanyName(value: unknown): string
  normalizeCompanyName(value: unknown): string
}
const { getLinkedRecordId } = require('../core/relations.ts') as {
  getLinkedRecordId(value: unknown): number | null
}
const {
  normalizeText,
  slugify,
  uniqueValue
} = require('../core/text.ts') as {
  normalizeText(value: unknown): string
  slugify(value: unknown): string
  uniqueValue(baseValue: string, usedValues: Set<string>): string
}

type NocoRecord = Record<string, unknown> & { Id: number }

type StopCompanyField =
  | 'from_legend_resume_companies'
  | 'currently_interviewing_companies'
  | 'offer_companies'

type ParsedStopCompany = {
  restrictionId: number
  restrictionRef: string
  rawClientName: string
  clientId: number | null
  market: string
  sourceRow: string
  sourceField: StopCompanyField
  rawCompanyName: string
  normalizedCompanyKey: string
}

type CompanyCreatePlan = {
  companyRef: string
  companyName: string
  normalizedCompanyKey: string
  source: 'stop_companies'
  usedByRestrictions: Array<{
    restrictionId: number
    restrictionRef: string
    rawClientName: string
    sourceField: StopCompanyField
  }>
}

type RestrictionCompanyLinkPlan = {
  restrictionId: number
  restrictionRef: string
  rawClientName: string
  clientId: number | null
  market: string
  companyIds: number[]
  companies: Array<{
    Id?: number
    companyRef: string
    companyName: string
    normalizedCompanyKey: string
    source: string
    willCreate?: boolean
  }>
}

type StopCompaniesReport = {
  checkedAt: string
  parsedStopCompanies: ParsedStopCompany[]
  companyCreatePlans: CompanyCreatePlan[]
  restrictionCompanyLinkPlans: RestrictionCompanyLinkPlan[]
    missingClientRelationReview: Array<Record<string, unknown>>
  ambiguousCompanyReview: Array<Record<string, unknown>>
  duplicateCompanyNames: Array<Record<string, unknown>>
}

const STOP_COMPANY_FIELDS: StopCompanyField[] = [
  'from_legend_resume_companies',
  'currently_interviewing_companies',
  'offer_companies'
]

function existingLinkedCompanyIds(restriction: NocoRecord): Set<number> {
  const links = restriction.rel_restrictions_blocked_companies
  if (!Array.isArray(links)) {
    return new Set()
  }

  return new Set(
    links
      .map(link => Number(link?.Id))
      .filter(id => Number.isFinite(id) && id > 0)
  )
}

function splitCompanyList(value: unknown): string[] {
  return String(value ?? '')
    .split(/[;,\n]/)
    .map(item => item.trim())
    .map(item => item.replace(/^["'`]+|["'`]+$/g, '').trim())
    .filter(Boolean)
}

function slugifyCompanyRef(value: unknown): string {
  const normalized = normalizeCompanyName(value)
  return slugify(normalized)
}

function uniqueCompanyRef(baseRef: string, usedRefs: Set<string>): string {
  return uniqueValue(baseRef, usedRefs)
}

function parseStopCompanies(restrictions: NocoRecord[]): ParsedStopCompany[] {
  const parsed: ParsedStopCompany[] = []

  for (const restriction of restrictions) {
    for (const field of STOP_COMPANY_FIELDS) {
      for (const companyName of splitCompanyList(restriction[field])) {
        const normalizedCompanyKey = compactCompanyName(companyName)
        if (!normalizedCompanyKey) {
          continue
        }

        parsed.push({
          restrictionId: Number(restriction.Id),
          restrictionRef: normalizeText(restriction.restriction_ref),
          rawClientName: normalizeText(restriction.raw_client_name),
          clientId: getLinkedRecordId(restriction.rel_restrictions_client),
          market: normalizeText(restriction.market),
          sourceRow: normalizeText(restriction.source_row),
          sourceField: field,
          rawCompanyName: companyName,
          normalizedCompanyKey
        })
      }
    }
  }

  return parsed
}

function indexCompaniesByName(companies: NocoRecord[]): Map<string, NocoRecord[]> {
  const index = new Map<string, NocoRecord[]>()

  for (const company of companies) {
    const key = compactCompanyName(company.company_name)
    if (!key) {
      continue
    }

    if (!index.has(key)) {
      index.set(key, [])
    }
    index.get(key)!.push(company)
  }

  return index
}

function buildStopCompaniesReport(
  restrictions: NocoRecord[],
  companies: NocoRecord[],
  now = new Date().toISOString()
): StopCompaniesReport {
  const parsedStopCompanies = parseStopCompanies(restrictions)
  const companiesByName = indexCompaniesByName(companies)
  const createPlansByName = new Map<string, CompanyCreatePlan>()
  const linkPlansByRestriction = new Map<number, RestrictionCompanyLinkPlan>()
  const ambiguousCompanyReview: Array<Record<string, unknown>> = []

  for (const parsed of parsedStopCompanies) {
    const companyMatches = companiesByName.get(parsed.normalizedCompanyKey) ?? []
    const restriction = restrictions.find(item => Number(item.Id) === parsed.restrictionId)
    const linkedCompanyIds = restriction ? existingLinkedCompanyIds(restriction) : new Set<number>()

    if (companyMatches.length > 1) {
      ambiguousCompanyReview.push({
        ...parsed,
        matchedCompanies: companyMatches.map(company => ({
          Id: company.Id,
          company_name: company.company_name,
          source: company.source
        }))
      })
      continue
    }

    const existingCompany = companyMatches[0]
    const existingCompanyId = existingCompany ? Number(existingCompany.Id) : 0
    const alreadyLinked = existingCompanyId > 0 && linkedCompanyIds.has(existingCompanyId)
    if (!existingCompany && !createPlansByName.has(parsed.normalizedCompanyKey)) {
      const companyRef = uniqueCompanyRef(
        `company_stop_${slugifyCompanyRef(parsed.rawCompanyName)}`,
        new Set([...createPlansByName.values()].map(plan => plan.companyRef))
      )
      const usedByRestrictions = parsedStopCompanies
        .filter(item => item.normalizedCompanyKey === parsed.normalizedCompanyKey)
        .map(item => ({
          restrictionId: item.restrictionId,
          restrictionRef: item.restrictionRef,
          rawClientName: item.rawClientName,
          sourceField: item.sourceField
        }))

      createPlansByName.set(parsed.normalizedCompanyKey, {
        companyRef,
        companyName: parsed.rawCompanyName,
        normalizedCompanyKey: parsed.normalizedCompanyKey,
        source: 'stop_companies',
        usedByRestrictions
      })
    }

    const createPlan = createPlansByName.get(parsed.normalizedCompanyKey)
    if (alreadyLinked) {
      continue
    }

    const companyInfo = existingCompany
      ? {
          Id: existingCompanyId,
          companyRef: String(existingCompany.Id),
          companyName: normalizeText(existingCompany.company_name),
          normalizedCompanyKey: parsed.normalizedCompanyKey,
          source: normalizeText(existingCompany.source)
        }
      : {
          companyRef: createPlan!.companyRef,
          companyName: createPlan!.companyName,
          normalizedCompanyKey: parsed.normalizedCompanyKey,
          source: createPlan!.source,
          willCreate: true
        }

    const existingPlan = linkPlansByRestriction.get(parsed.restrictionId)
    if (!existingPlan) {
      linkPlansByRestriction.set(parsed.restrictionId, {
        restrictionId: parsed.restrictionId,
        restrictionRef: parsed.restrictionRef,
        rawClientName: parsed.rawClientName,
        clientId: parsed.clientId,
        market: parsed.market,
        companyIds: existingCompany ? [existingCompanyId] : [],
        companies: [companyInfo]
      })
      continue
    }

    if (existingCompany && !existingPlan.companyIds.includes(existingCompanyId)) {
      existingPlan.companyIds.push(existingCompanyId)
    }

    if (
      !existingPlan.companies.some(
        company => company.normalizedCompanyKey === companyInfo.normalizedCompanyKey
      )
    ) {
      existingPlan.companies.push(companyInfo)
    }
  }

  const duplicateCompanyNames = [...companiesByName.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([normalizedCompanyKey, rows]) => ({
      normalizedCompanyKey,
      companies: rows.map(row => ({
        Id: row.Id,
        company_name: row.company_name,
        source: row.source
      }))
    }))

  return {
    checkedAt: now,
    parsedStopCompanies,
    companyCreatePlans: [...createPlansByName.values()].sort((a, b) =>
      a.companyName.localeCompare(b.companyName)
    ),
    restrictionCompanyLinkPlans: [...linkPlansByRestriction.values()].sort(
      (a, b) => a.restrictionId - b.restrictionId
    ),
    missingClientRelationReview: restrictions
      .filter(restriction => !getLinkedRecordId(restriction.rel_restrictions_client))
      .map(restriction => ({
        Id: restriction.Id,
        raw_client_name: restriction.raw_client_name,
        market: restriction.market,
        source_row: restriction.source_row,
        reason: 'restriction_has_no_native_client_relation'
      })),
    ambiguousCompanyReview,
    duplicateCompanyNames
  }
}

function summarize(report: StopCompaniesReport): Record<string, unknown> {
  const linkPlansReadyNow = report.restrictionCompanyLinkPlans.filter(plan =>
    plan.companies.every(company => !company.willCreate)
  ).length
  const linkPlansAfterCreates = report.restrictionCompanyLinkPlans.length

  return {
    parsedStopCompanyEntries: report.parsedStopCompanies.length,
    uniqueParsedStopCompanies: new Set(
      report.parsedStopCompanies.map(entry => entry.normalizedCompanyKey)
    ).size,
    companyCreatePlans: report.companyCreatePlans.length,
    restrictionCompanyLinkPlans: report.restrictionCompanyLinkPlans.length,
    linkPlansReadyNow,
    linkPlansAfterCreates,
    missingClientRelationReview: report.missingClientRelationReview.length,
    ambiguousCompanyReview: report.ambiguousCompanyReview.length,
    duplicateCompanyNames: report.duplicateCompanyNames.length
  }
}

function renderManualReview(report: StopCompaniesReport): string {
  const lines = [
    '# Stop Companies Manual Review',
    '',
    '## Summary',
    '',
    ...Object.entries(summarize(report)).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Missing Native Client Relation',
    ''
  ]

  if (!report.missingClientRelationReview.length) {
    lines.push('- none')
  } else {
    for (const row of report.missingClientRelationReview) {
      lines.push(
        `- ${row.raw_client_name || '(empty name)'} | ${row.market || '(empty market)'} | row ${row.Id}`
      )
    }
  }

  lines.push('', '## Ambiguous Company Names', '')
  if (!report.ambiguousCompanyReview.length) {
    lines.push('- none')
  } else {
    for (const row of report.ambiguousCompanyReview) {
      lines.push(
        `- ${row.rawCompanyName} from ${row.restrictionRef}: duplicate company records must be merged or chosen manually`
      )
    }
  }

  lines.push('', '## Newly Needed Company Rows', '')
  if (!report.companyCreatePlans.length) {
    lines.push('- none')
  } else {
    for (const plan of report.companyCreatePlans) {
      lines.push(`- ${plan.companyName} -> ${plan.companyRef}`)
    }
  }

  return `${lines.join('\n')}\n`
}

function runTests(): void {
  const restrictions = [
    {
      Id: 1,
      restriction_ref: 'stop_1',
      raw_client_name: 'Кира',
      rel_restrictions_client: { Id: 1 },
      market: 'en',
      source_row: '2',
      from_legend_resume_companies: 'Comtek, Trynexis',
      currently_interviewing_companies: 'Ozon',
      offer_companies: ''
    },
    {
      Id: 2,
      restriction_ref: 'stop_2',
      raw_client_name: 'Игорь',
      rel_restrictions_client: null,
      market: 'ru',
      source_row: '3',
      from_legend_resume_companies: ' Comtek ',
      currently_interviewing_companies: '',
      offer_companies: ''
    }
  ] as NocoRecord[]
  const companies = [
    { Id: 10, company_name: 'comtek', source: 'applications' }
  ] as NocoRecord[]

  assert.deepEqual(splitCompanyList('A, B; C\nD'), ['A', 'B', 'C', 'D'])
  assert.equal(slugifyCompanyRef('Сбер ГигаЧат'), 'sber_gigachat')

  const parsed = parseStopCompanies(restrictions)
  assert.equal(parsed.length, 4)
  assert.equal(parsed[0].normalizedCompanyKey, compactCompanyName('Comtek'))

  const report = buildStopCompaniesReport(restrictions, companies, 'test')
  assert.equal(report.companyCreatePlans.length, 2)
  assert.deepEqual(
    report.companyCreatePlans.map(plan => plan.companyName).sort(),
    ['Ozon', 'Trynexis']
  )
  assert.equal(report.restrictionCompanyLinkPlans.length, 2)
  assert.equal(report.missingClientRelationReview.length, 1)
  assert.equal(summarize(report).uniqueParsedStopCompanies, 3)

  const duplicateReport = buildStopCompaniesReport(restrictions, [
    ...companies,
    { Id: 11, company_name: 'Comtek', source: 'manual' }
  ] as NocoRecord[])
  assert.equal(duplicateReport.ambiguousCompanyReview.length, 2)

  const alreadyLinkedReport = buildStopCompaniesReport(
    [
      {
        ...restrictions[0],
        from_legend_resume_companies: 'Comtek',
        currently_interviewing_companies: '',
        offer_companies: '',
        rel_restrictions_blocked_companies: [{ Id: 10 }]
      }
    ] as NocoRecord[],
    companies
  )
  assert.deepEqual(alreadyLinkedReport.restrictionCompanyLinkPlans.map(plan => plan.companyIds), [])
}

module.exports = {
  buildStopCompaniesReport,
  parseStopCompanies,
  renderManualReview,
  runTests,
  splitCompanyList,
  slugifyCompanyRef,
  summarize
}
