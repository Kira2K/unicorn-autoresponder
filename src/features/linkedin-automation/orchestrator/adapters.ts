import type { AutomationAdapters, AutomationRun, FeatureState } from './contracts.ts'
import { automationError } from './contracts.ts'
import type { ConnectionInviterService } from '../../web-console/backend/connection-inviter-types.ts'
import type { CommentMonitorService } from '../../web-console/backend/comment-monitor-types.ts'
import type { PostWriterService } from '../post-writer/service.ts'
import { active } from '../post-writer/types.ts'
import { scheduledId } from '../post-writer/schedule.ts'
import type { TrackedPost } from '../comment-monitor/types.ts'

export function createFeatureAdapters(deps: {invitations:ConnectionInviterService;posts:PostWriterService;
  comments:CommentMonitorService;gate:{current(account:string):unknown};now:()=>number}):AutomationAdapters {
  const available = (account:number) => ({ready:true,busy:Boolean(deps.gate.current(String(account)))})
  const withdrawalEstimates=new Map<number,{at:number;value:number}>()
  const invitationState = (run:AutomationRun,value:any):FeatureState => ({id:value.runId,
    owned:value.automationKey === run.key,
    ...(Number.isFinite(Date.parse(value.nextActionAt ?? '')) ? {nextActionAt:Date.parse(value.nextActionAt)} : {}),
    state:['succeeded','completed'].includes(value.status) ? 'completed' : value.status === 'stopped' ? 'stopped' :
      value.status === 'running' ?
        (['resolving_uncertain','stop_requested'].includes(value.stage) &&
          Date.parse(value.nextActionAt ?? '') > deps.now() && (deps.gate.current(String(run.account)) as {id?:string}|undefined)?.id !== value.runId
          ? 'deferred' : 'running') : 'blocked',reason:value.errorCode ?? value.stage})
  const postState = (run:AutomationRun,value:any):FeatureState => ({id:value.id,
    owned:value.automationKey === run.key || (value.trigger === 'scheduled' && !active(value)),
    ...(value.status==='published' && value.postId && Number.isFinite(value.publishedAt) ?
      {publication:{id:String(value.postId),at:value.publishedAt}} : {}),
    state:['uncertain','verifying','publishing'].includes(value.status) || active(value) ? 'running' :
      value.status === 'published' ? 'completed' : value.status === 'stopped' ? 'stopped' : 'blocked',reason:value.errorCode})
  const commentState = (run:AutomationRun,value:any):FeatureState => ({id:value.jobId,owned:value.state?.automationKey === run.key,
    state:value.status==='error' ? 'blocked' : value.status === 'disabled' ? 'stopped' : 'monitoring',reason:value.errorCode})
  const withdrawalState = (run:AutomationRun,value:any):FeatureState => ({id:value.id,owned:value.automationKey === run.key,
    state:value.status === 'running' ? 'running' : value.status === 'completed' ? 'completed' :
      value.status === 'stopped' ? 'stopped' : 'blocked',reason:value.errorCode ?? (value.status === 'uncertain' ? 'uncertain' : undefined)})
  const withdrawals = () => { const value=deps.invitations.withdrawals;
    if (!value?.startAutomatic) throw automationError('withdrawal_automatic_unavailable'); return value }
  const latestPublication = async (run:AutomationRun):Promise<TrackedPost|undefined> => {
    // Comments without automated posts remain independent of Post Writer availability.
    if (!run.publication) return undefined
    const value=(await deps.posts.get(run.account)).runs.find(r=>r.automationKey && r.status==='published' &&
      r.postId===run.publication!.id && Number.isFinite(r.publishedAt) && r.publishedAt!<=deps.now())
    return value ? {id:value.postId!,createdAt:new Date(value.publishedAt!).toISOString(),
      url:value.url,text:(value.draft?.text??'').slice(0,5000)} : undefined
  }
  return {
    invitations:{
      async inspect(account) {
        const check:any=await deps.invitations.readiness(account),latest=check.latest
        const remaining=Math.max(0,Number(latest?.dailyQuota ?? 0)-Number(latest?.counters?.sent ?? 0))
        return {...available(account),ready:check.ready && check.writerEnabled,
          reason:!check.writerEnabled ? 'connection_writer_disabled' : !check.ready ? 'stack_required' : undefined,
          estimateMs:remaining * 240_000}
      },
      async start(run) {return invitationState(run,await deps.invitations.start(run.account,{automationKey:run.key}))},
      async status(run) {const value=run.featureRunId ? await deps.invitations.get(run.featureRunId) :
        (await deps.invitations.list()).find(r=>r.automationKey===run.key);return value && invitationState(run,value)},
      async stop(run) {if(run.featureRunId) {const value=await deps.invitations.get(run.featureRunId);
        if(value?.automationKey===run.key) await deps.invitations.stopRun(run.featureRunId)}}
    },
    posts:{
      async inspect(account) {const value=await deps.posts.get(account);return {...available(account),ready:value.writable,
        reason:value.writable ? undefined : 'post_writer_read_only'}},
      async start(run) {return postState(run,await deps.posts.startScheduled(run.account,run.date,run.key))},
      async status(run) {const value=(await deps.posts.get(run.account)).runs.find(r=>r.id===(run.featureRunId ?? scheduledId(run.account,run.date)) &&
        (r.automationKey===run.key || !active(r)));
        return value && postState(run,value)},
      async stop(run) {const value=(await deps.posts.get(run.account)).runs.find(r=>r.id===run.featureRunId);
        if(value?.automationKey===run.key) await deps.posts.action(value.id,'stop')}
    },
    comments:{
      async inspect(account) {const current=(await deps.comments.list()).find((r:any)=>r.platformAccountId===account &&
        ['starting','waiting','checking','replying','paused'].includes(r.status));
        return {...available(account),ready:!current || Boolean((current.state as any)?.automationKey),
          reason:current && !(current.state as any)?.automationKey ? 'manual_task_active' : undefined}},
      async start(run) {if(!deps.comments.ensureAutomatic) throw automationError('comments_automatic_unavailable');
        return commentState(run,await deps.comments.ensureAutomatic(run.account,run.key,await latestPublication(run)))},
      async maintain(run) {await deps.comments.ensureAutomatic?.(run.account,run.key,await latestPublication(run))},
      async status(run) {const value=run.featureRunId ? await deps.comments.get(run.featureRunId) :
        (await deps.comments.list()).find((r:any)=>r.state?.automationKey===run.key);return value && commentState(run,value)},
      async stop(run) {if(run.featureRunId) {const value=await deps.comments.get(run.featureRunId);
        if((value?.state as any)?.automationKey===run.key) await deps.comments.disable(run.account)}}
    },
    withdrawals:{
      async inspect(account) {
        const settings=await deps.invitations.settings(),availability=available(account)
        let estimate=withdrawalEstimates.get(account)
        if(settings.writerEnabled && !availability.busy && (!estimate || deps.now()-estimate.at>=300000)) {
          estimate={at:deps.now(),value:await withdrawals().estimateAutomatic?.(account) ?? 0};withdrawalEstimates.set(account,estimate)
        }
        return {...availability,ready:settings.writerEnabled,estimateMs:estimate?.value,
          reason:settings.writerEnabled ? undefined : 'connection_writer_disabled'}
      },
      async start(run) {return withdrawalState(run,await withdrawals().startAutomatic!(run.account,run.key))},
      async status(run) {let value=await withdrawals().status(run.account);
        if(value?.automationKey===run.key && value.status==='interrupted' && !run.stopRequested)
          value=await withdrawals().startAutomatic!(run.account,run.key)
        return value?.automationKey===run.key ? withdrawalState(run,value) : undefined},
      async stop(run) {const value=await withdrawals().status(run.account);if(value?.automationKey===run.key) await withdrawals().stop(run.account)}
    }
  }
}
