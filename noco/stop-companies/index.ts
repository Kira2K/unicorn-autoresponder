const { createNocoClient } = require('../core/client.ts') as {
  createNocoClient(): any
}
const { describeError } = require('../core/errors.ts') as {
  describeError(error: any): string
}
const { parseJobArgs } = require('../core/job.ts') as {
  parseJobArgs(args?: string[]): { apply: boolean; test: boolean }
}
const { ensureRelationField, linkRecords } = require('../core/relations.ts') as {
  ensureRelationField(client: any, sourceTable: any, relatedTable: any, title: string): Promise<any>
  linkRecords(
    client: any,
    sourceTable: any,
    fieldId: string,
    sourceRecordId: number,
    relatedIds: number[]
  ): Promise<{ ok: boolean; linked?: number; error?: string }>
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
  buildStopCompaniesReport,
  renderManualReview,
  runTests,
  summarize
} = require('./logic.ts') as {
  buildStopCompaniesReport(restrictions: any[], companies: any[]): any
  renderManualReview(report: any): string
  runTests(): void
  summarize(report: any): Record<string, unknown>
}

const JOB_NAME = 'nocodb-stop-companies'

async function loadLiveData(client = createNocoClient()): Promise<{
  restrictions: any[]
  companies: any[]
}> {
  const [restrictions, companies] = await Promise.all([
    client.fetchRecords(TABLES.restrictions.id),
    client.fetchRecords(TABLES.companies.id)
  ])
  return { restrictions, companies }
}

function writeReports(dir: string, report: any): void {
  writeJson(dir, 'summary.json', summarize(report))
  writeJson(dir, 'parsed-stop-companies.json', report.parsedStopCompanies)
  writeJson(dir, 'company-create-plans.json', report.companyCreatePlans)
  writeJson(dir, 'restriction-company-link-plans.json', report.restrictionCompanyLinkPlans)
  writeJson(dir, 'missing-client-relation-review.json', report.missingClientRelationReview)
  writeJson(dir, 'ambiguous-company-review.json', report.ambiguousCompanyReview)
  writeJson(dir, 'duplicate-company-names.json', report.duplicateCompanyNames)
  writeText(dir, 'manual-review.md', renderManualReview(report))
}

async function applyStopCompanyPlan(
  report: any,
  client = createNocoClient()
): Promise<Record<string, unknown>> {
  const createdCompanies: Array<Record<string, unknown>> = []
  const failedCompanyCreates: Array<Record<string, unknown>> = []

  for (const plan of report.companyCreatePlans) {
    try {
      await client.createRecord(TABLES.companies.id, {
        company_name: plan.companyName,
        source: plan.source
      })
      createdCompanies.push(plan)
      await client.wait(120)
    } catch (error: any) {
      failedCompanyCreates.push({ plan, error: describeError(error) })
    }
  }

  const relationField = await ensureRelationField(
    client,
    TABLES.restrictions,
    TABLES.companies,
    RELATIONS.restrictionsBlockedCompanies
  )
  if (!relationField.ok || !relationField.id) {
    return {
      createdCompanies,
      failedCompanyCreates,
      relationField,
      linkedRestrictions: 0,
      failedLinks: [{ error: relationField.error ?? 'relation field unavailable' }]
    }
  }

  const { restrictions, companies } = await loadLiveData(client)
  const linkReport = buildStopCompaniesReport(restrictions, companies)
  const linked: Array<Record<string, unknown>> = []
  const failedLinks: Array<Record<string, unknown>> = []

  for (const plan of linkReport.restrictionCompanyLinkPlans) {
    const missingCreatedCompany = plan.companies.filter((company: any) => !company.Id)
    if (missingCreatedCompany.length) {
      failedLinks.push({
        plan,
        error: 'some companies still do not have NocoDB ids after create step'
      })
      continue
    }

    const result = await linkRecords(
      client,
      TABLES.restrictions,
      relationField.id,
      plan.restrictionId,
      plan.companyIds
    )
    if (result.ok) {
      linked.push({ ...plan, linked: result.linked })
    } else {
      failedLinks.push({ plan, error: result.error })
    }
    await client.wait(120)
  }

  return {
    createdCompanies,
    failedCompanyCreates,
    relationField,
    linkedRestrictions: linked.length,
    failedLinks,
    linked
  }
}

async function main(): Promise<void> {
  const args = parseJobArgs()

  if (args.test) {
    runTests()
    console.log('noco:stop-companies tests passed')
    return
  }

  const client = createNocoClient()
  const dir = createReportDir(JOB_NAME)
  const { restrictions, companies } = await loadLiveData(client)
  const report = buildStopCompaniesReport(restrictions, companies)
  writeReports(dir, report)

  if (!args.apply) {
    writeJson(dir, 'apply-result.json', { mode: 'dry-run', applied: false })
    console.log(`NocoDB stop companies dry-run written to ${dir}`)
    console.log(JSON.stringify(summarize(report), null, 2))
    return
  }

  const applyResult = await applyStopCompanyPlan(report, client)
  writeJson(dir, 'apply-result.json', applyResult)

  const after = await loadLiveData(client)
  const postApplyReport = buildStopCompaniesReport(after.restrictions, after.companies)
  writeJson(dir, 'post-apply-summary.json', summarize(postApplyReport))
  writeJson(dir, 'post-apply-company-create-plans.json', postApplyReport.companyCreatePlans)
  writeJson(dir, 'post-apply-link-plans.json', postApplyReport.restrictionCompanyLinkPlans)

  console.log(`NocoDB stop companies apply written to ${dir}`)
  console.log(JSON.stringify({ before: summarize(report), after: summarize(postApplyReport) }, null, 2))
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error(describeError(error))
    process.exit(1)
  })
}

module.exports = {
  applyStopCompanyPlan,
  loadLiveData,
  writeReports
}
