import { createLinkedInOrchestrator } from './service.ts'
import { createFeatureAdapters } from './adapters.ts'
import { createAutomationAudit } from './audit.ts'
import { createAutomationWriteGuard } from './execution-guard.ts'
import { automationError,type AutomationStore,type ExecutionAuthority,type ExecutionGuard } from './contracts.ts'
import type { Store as WithdrawalStore } from '../invitation-withdrawal/contracts.ts'
export type AutomationRuntimeOptions = {store:AutomationStore;authority:ExecutionAuthority;leader:boolean;
  withdrawals:WithdrawalStore;previewOnly?:boolean}
export function prepareAutomation(options:AutomationRuntimeOptions) {
  const audit=createAutomationAudit(options.store)
  const normalGuard=createAutomationWriteGuard(options.store,options.authority,audit)
  const guard:ExecutionGuard={...normalGuard,async beforeWrite(account,feature,key) {
    if(key && options.previewOnly) throw automationError('automation_preview_only')
    await normalGuard.beforeWrite(account,feature,key)
  }}
  return {...options,audit,guard,
    schedulingManaged:async(account:number)=>Boolean((await options.store.settings()).find(s=>s.account===account)?.managed),
    compose(deps:Parameters<typeof createFeatureAdapters>[0],accountExists:(id:number)=>Promise<boolean>) {
      const service=createLinkedInOrchestrator({store:options.store,authority:options.authority,
        adapters:createFeatureAdapters(deps),now:Date.now,random:Math.random,accountExists,
        previewOnly:options.previewOnly || !options.leader,
        log:code=>console.error(`LinkedIn automation: ${code}`)},options.leader)
      if(options.leader) void service.tick().catch(()=>undefined)
      return service
    }
  }
}
