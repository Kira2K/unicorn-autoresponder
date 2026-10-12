import { join } from 'node:path'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { CollectionPersistenceError } from '../vacancy_collection/persistence-error.ts'
import { createCodexAppServer } from './codex-app-server.ts'
import { createQuotaGuard, loadBudgetPolicy, readGuardState } from './quota-guard.ts'
import { createBudgetWatchdog } from './budget-watchdog.ts'
import type { BudgetWatchdog } from './budget-watchdog.ts'

/** Adapt the existing watchdog to the collection's fatal-stop/checkpoint contract. */
export function scanBudgetControl(watchdog:BudgetWatchdog,close:()=>Promise<void>) {
  return {
    signal:watchdog.signal,
    async start(){await watchdog.preflight({live:true});watchdog.start()},
    assertAdmission(){const current=watchdog.admission();if(watchdog.signal.aborted||!current.allowed)throw new CollectionPersistenceError('collection_budget_stop:'+current.reason)},
    async admit(){try{await watchdog.waitForAdmission()}catch{throw new CollectionPersistenceError('collection_budget_stop:'+watchdog.admission().reason)}},
    async close(){try{await watchdog.stop()}finally{await close()}},
  }
}

/** Opt-in; reads an already approved policy. It cannot create, enlarge or reset a budget. */
export async function openScanBudget(directory:string,cancelOwnedBrowser:()=>Promise<void>) {
  const policy=await loadBudgetPolicy(join(directory,'budget.json'))
  const initialState=await readGuardState(join(directory,'budget-status.json'))
  const guard=createQuotaGuard(policy,{statePath:join(directory,'budget-status.json'),initialState}),server=createCodexAppServer()
  const watchdog=createBudgetWatchdog({guard,readRateLimit:()=>server.readPrimaryRateLimit(),cancelOwnedWork:cancelOwnedBrowser,reportPath:join(directory,'scan-watchdog-report.json')})
  const control=scanBudgetControl(watchdog,()=>server.close())
  try{await control.start();return {...control,policyHash:digest(policy)}}catch(error){await control.close();throw error}
}
