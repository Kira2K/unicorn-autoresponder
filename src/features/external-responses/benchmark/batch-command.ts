import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { atomicJson } from '../infrastructure/store.ts'
import { createCodexAppServer } from '../infrastructure/codex-app-server.ts'
import { createQuotaGuard, loadBudgetPolicy, primaryRateLimit, readGuardState } from '../infrastructure/quota-guard.ts'
import type { BudgetPolicy, RateLimitObservation } from '../infrastructure/quota-guard.ts'
import { guardedBenchmarkCommand } from './command.ts'
import type { GuardedBenchmarkDependencies } from './command.ts'

export function selectBenchmarkBatch(frozen: any, batch: number) {
  const ids: string[] = frozen.catalog?.companyIds
  if (!ids || ids.length !== 30 || new Set(ids).size !== 30 || !Number.isInteger(batch) || batch < 1 || batch > 6) throw Error('benchmark_requires_thirty_companies_six_batches')
  const chosen = ids.slice((batch - 1) * 5, batch * 5), selected = new Set(chosen)
  return { ...frozen, catalog: { ...frozen.catalog, companyIds: chosen,
    companies: chosen.map(id => { const company = frozen.catalog.companies.find((c: any) => c.id === id); if (!company) throw Error('benchmark_company_missing'); return company }),
    sources: frozen.catalog.sources.filter((s: any) => selected.has(s.database?.companyId)),
    deferred: frozen.catalog.deferred.filter((s: any) => selected.has(s.companyId)),
    issues: frozen.catalog.issues.filter((issue: string) => selected.has(issue.split(':')[1])) } }
}

export function batchBudget(parent: BudgetPolicy, observation: RateLimitObservation, batch: number): BudgetPolicy {
  const allowancePoints = Math.min(1, parent.stopAtPercent - observation.usedPercent)
  const pauseAtPercent = Math.min(parent.pauseAtPercent, observation.usedPercent + allowancePoints - 0.25)
  if (observation.usedPercent >= pauseAtPercent || allowancePoints <= 0) throw Error('campaign_budget_does_not_admit_batch')
  return { version: 1, campaignId: parent.campaignId + '-batch-' + batch, baseline: observation,
    allowancePoints, bufferPoints: observation.usedPercent + allowancePoints - pauseAtPercent,
    pauseAtPercent, stopAtPercent: observation.usedPercent + allowancePoints }
}

async function optional(path: string) { try { return JSON.parse(await readFile(path, 'utf8')) } catch (error: any) { if (error.code !== 'ENOENT') throw error } }

/** One frozen five-company batch, with shared total budget and an immutable per-batch ledger.
 * No AI dispatch, applications, registration or SQL writes. Replay shares the same allowance.
 */
export async function benchmarkBatchCommand(args: string[], deps: GuardedBenchmarkDependencies = {}) {
  const arg = (key: string, fallback?: string) => { const at = args.indexOf('--' + key); return at < 0 ? fallback : args[at + 1] }
  const campaign = resolve(arg('campaign') ?? ''), batch = Number(arg('batch')), phase = args.includes('--replay') ? 'replay' : 'initial'
  const frozen = selectBenchmarkBatch(JSON.parse(await readFile(join(campaign, 'frozen-scope.json'), 'utf8')), batch)
  const policy = await loadBudgetPolicy(join(campaign, 'budget.json'))
  if (policy.allowancePoints !== 5) throw Error('benchmark_total_allowance_must_be_five')
  const directory = join(campaign, 'batches', String(batch)), run = `${policy.campaignId}-b${batch}-${phase}`
  await mkdir(directory, { recursive: true })
  const priorScope = await optional(join(directory, 'frozen-scope.json'))
  if (priorScope && JSON.stringify(priorScope) !== JSON.stringify(frozen)) throw Error('benchmark_batch_scope_changed')
  if (!priorScope) await atomicJson(join(directory, 'frozen-scope.json'), frozen)
  const server = deps.readRateLimit ? undefined : createCodexAppServer()
  const statePath = join(campaign, 'batch-budget-status.json'), guard = createQuotaGuard(policy, { statePath, initialState: await readGuardState(statePath), now: deps.now })
  const readRateLimit = async () => {
    const raw = await (deps.readRateLimit?.() ?? server!.readPrimaryRateLimit())
    await guard.observe(primaryRateLimit(raw, new Date(deps.now?.() ?? Date.now()).toISOString(), policy.baseline.windowMinutes))
    if (!guard.admission().allowed) throw Error('campaign_' + guard.latest().reason)
    return raw
  }
  try {
    await readRateLimit()
    const budgetPath = join(directory, 'budget.json'), existing = await optional(budgetPath)
    const budget = existing ?? batchBudget(policy, guard.latest().observation!, batch)
    if (!existing) await atomicJson(budgetPath, { ...budget, parentCampaign: policy.campaignId, parentBaseline: policy.baseline,
      companyRepairPoints: 0.5, aiRepairs: 'disabled_quota_resolution_insufficient', classificationAndReplayShareAllowance: true })
    else if (existing.parentCampaign !== policy.campaignId || existing.parentBaseline?.usedPercent !== policy.baseline.usedPercent || existing.parentBaseline?.resetsAt !== policy.baseline.resetsAt) throw Error('benchmark_batch_budget_parent_changed')
    await atomicJson(join(directory, 'execution-policy.json'), { campaignId: budget.campaignId, scopeKind: 'explicit_followup',
      approvedCompanyIds: frozen.catalog.companyIds, coldCompanyIds: frozen.catalog.companyIds, stackIds: ['2','5','7'],
      maxConcurrentActions: 1, maxReaderCallsPerSource: 200, maxActiveCrawlMsPerSource: 900000, maxEngineCandidatesPerSource: 2,
      paidApiCalls: 0, applications: false, maxExpansions: 1, repairResetsFailureStreak: false,
      failurePolicy: 'bounded_batch_skip_unresolved', stopAfterSuccessfulCompanies: 5, consecutiveCompanyFailureLimit: null, companyRepairPoints: 0.5 })
    const cancellation = JSON.parse(await readFile(join(campaign, 'cancellation-preflight.json'), 'utf8'))
    await atomicJson(join(directory, 'cancellation-preflight.json'), cancellation)
    const flags = ['--mode','cold','--campaign',directory,'--run',run,'--browser-driver',arg('browser-driver','patchright')!]
    if (args.includes('--execute')) flags.push('--execute')
    if (args.includes('--headless')) flags.push('--headless')
    if (args.includes('--resume')) flags.push('--resume')
    if (phase === 'replay') flags.push('--replay-run',`${policy.campaignId}-b${batch}-initial`)
    const report: any = await guardedBenchmarkCommand(flags, { ...deps, readRateLimit, closeRateLimit: async () => {} })
    const checkpoint = await optional(join(directory, 'isolated', run, 'benchmark-checkpoint.json'))
    const classified = await optional(join(directory, 'isolated', run, 'classified.json'))
    const sources = Object.values(checkpoint?.sourceResults ?? {}) as any[]
    const analysis = { version: 1, batch, phase, companyIds: frozen.catalog.companyIds, companyNames: frozen.catalog.companies,
      completedCompanies: checkpoint?.completedCompanyIds ?? [], completeCompanies: report.successfulCompanyIds ?? [],
      readerCalls: Object.values(checkpoint?.sourceBudgets ?? {}).reduce((n: number, b: any) => n + b.reads, 0),
      observations: classified?.collection.positions.length ?? 0, accepted: report.classification?.accepted ?? 0,
      pendingClassification: report.classification?.pending ?? 0, collectionStatus: report.status,
      sources: sources.map(s => ({ companyId: s.audit.source.database.companyId, sourceId: s.audit.source.database.sourceId,
        status: s.audit.status, reuse: s.reuse, issues: s.audit.issues, recipeSaved: !!s.audit.trace?.recipe })),
      aiRepairCalls: 0, companyRepairLimitPoints: 0.5, repairPolicy: 'No AI repairs because whole-point quota readings cannot enforce a half-point maximum.',
      batchBudget: budget, latestQuota: guard.latest().observation, totalUsedPoints: guard.latest().observation!.usedPercent - policy.baseline.usedPercent,
      humanAssistance: false, productionSqlWrites: false }
    await atomicJson(join(directory, phase + '-analysis.json'), analysis)
    await writeFile(join(directory, phase + '-analysis.md'), [
      `# Batch ${batch}: ${phase}`, '',
      `Companies: ${frozen.catalog.companies.map((c: any) => c.id + ' ' + c.name).join(', ')}.`,
      `Complete: ${analysis.completeCompanies.length}/5. Reads: ${analysis.readerCalls}. Observations: ${analysis.observations}.`,
      `Accepted: ${analysis.accepted}. Pending classification: ${analysis.pendingClassification}.`,
      `Weekly usage since batch baseline: ${analysis.latestQuota!.usedPercent - budget.baseline.usedPercent} points; total: ${analysis.totalUsedPoints}/5 points.`,
      '', 'AI company repair skipped: quota resolution cannot verify 0.5 points. No replacement companies.', '',
      ...analysis.sources.map(s => `- Company ${s.companyId}, source ${s.sourceId}: ${s.status}; ${s.issues.join('; ') || 'validated complete'}`), ''
    ].join('\n'))
    console.log(JSON.stringify({ batch, phase, complete: analysis.completeCompanies.length, observations: analysis.observations,
      pending: analysis.pendingClassification, reads: analysis.readerCalls, usedPercent: analysis.latestQuota!.usedPercent, analysis: join(directory, phase + '-analysis.md') }))
    return analysis
  } finally { await (server?.close() ?? Promise.resolve()) }
}
