import { automationError, enabledFor, type AutomationStore, type ExecutionAuthority, type ExecutionGuard } from './contracts.ts'
import { commentWaitReason } from './comment-policy.ts'
export function createAutomationWriteGuard(store: AutomationStore, authority: ExecutionAuthority,
  audit?: {flush():Promise<void>}, now = Date.now): ExecutionGuard {
  return { async beforeWrite(account, feature, key) {
    await authority.check()
    await audit?.flush()
    if (!key) return
    const config = (await store.settings()).find(c => c.account === account)
    if (feature === 'profile' || feature === 'auth' || !enabledFor(config, feature)) throw automationError('automation_disabled')
    const runs = await store.runs(account), run = runs.find(r => r.key === key)
    const checkDeadline = () => {
      if (run?.deadlineAt !== undefined && now() >= run.deadlineAt) throw automationError('automation_task_timeout')
    }
    checkDeadline()
    if (!run || run.stopRequested || ['cancelled','missed','blocked'].includes(run.state))
      throw automationError('automation_disabled')
    if (feature === 'comments') {
      const reason=commentWaitReason(config,runs,run,now())
      if (reason) throw automationError(reason)
    }
    await store.appendEvent({at:now(),account,feature,runKey:key,level:'info',stage:'before_write',code:'write_authorized'})
    // The event is durable before the call is allowed. Recheck ownership after the storage round trip.
    await authority.check()
    checkDeadline()
    if (feature === 'comments') {
      const fresh=(await store.settings()).find(c=>c.account===account)
      const reason=commentWaitReason(fresh,await store.runs(account),run,now())
      if (reason) throw automationError(reason)
    }
  },async afterWrite(account,feature,key,result) {
    if(!key)return
    await audit?.flush()
    await store.appendEvent({at:now(),account,feature,runKey:key,level:result==='verified'?'info':'warning',
      stage:'write_result',code:result==='verified'?'result_verified':'result_not_confirmed'})
  } }
}
