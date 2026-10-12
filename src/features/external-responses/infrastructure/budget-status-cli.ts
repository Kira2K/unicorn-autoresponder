import { resolve } from 'node:path'
import { createCodexAppServer } from './codex-app-server.ts'
import { createQuotaGuard, loadBudgetPolicy, readGuardState } from './quota-guard.ts'
import { createBudgetWatchdog } from './budget-watchdog.ts'

async function main() {
  const args = process.argv.slice(2), arg = (name: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1] }
  const budgetPath = resolve(arg('budget') ?? 'logs/external-responses/guarded-benchmark-20260929/budget.json')
  const statusPath = resolve(arg('status') ?? 'logs/external-responses/guarded-benchmark-20260929/budget-status.json')
  const policy = await loadBudgetPolicy(budgetPath), initialState = await readGuardState(statusPath)
  const guard = createQuotaGuard(policy, { statePath: statusPath, initialState }), server = createCodexAppServer({ executable: arg('codex') })
  try {
    const watchdog=createBudgetWatchdog({guard,readRateLimit:()=>server.readPrimaryRateLimit(),reportPath:statusPath+'.diagnostics.json'})
    const state=await watchdog.pollOnce()
    console.log(JSON.stringify({ campaignId: state.campaignId, status: state.status, reason: state.reason,
      observedAt: state.observation?.observedAt ?? null, usedPercent: state.observation?.usedPercent ?? null,
      pauseAtPercent: policy.pauseAtPercent, stopAtPercent: policy.stopAtPercent }))
    if (state.status !== 'ready') process.exitCode = 2
  } finally { await server.close() }
}
main().catch(error => { console.error(`external-responses budget: ${error.message}`); process.exitCode = 1 })
