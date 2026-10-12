import { atomicJson } from './store.ts'
import { primaryRateLimit, type QuotaGuard } from './quota-guard.ts'
import { safeRpcFailure } from './codex-app-server.ts'

export type BudgetWatchdog = ReturnType<typeof createBudgetWatchdog>

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** Polls independently of the worker and can cancel only through the injected owned-work callback. */
export function createBudgetWatchdog(options: {
  guard: QuotaGuard
  readRateLimit: () => Promise<unknown>
  cancelOwnedWork?: () => Promise<void>
  reportPath: string
  pollIntervalMs?: number
  sleep?: (ms: number) => Promise<void>
  retrySleep?: (ms:number)=>Promise<void>
  now?: () => number
  writeReport?: (path: string, value: unknown) => Promise<void>
}) {
  const sleep = options.sleep ?? wait, now = options.now ?? Date.now
  const abort = new AbortController()
  let running = false, loop: Promise<void> | undefined, cancellation: 'not_requested' | 'requested' | 'succeeded' | 'failed' = 'not_requested'
  let pollTask:Promise<ReturnType<QuotaGuard['latest']>>|undefined,recovering=false
  const recovery={recovered:0,errors:[] as ({at:string;attempt:number}&ReturnType<typeof safeRpcFailure>)[]}
  let releaseStop!: () => void
  const stopped = new Promise<void>(resolve => { releaseStop = resolve })
  const writeReport = async () => {
    const state = options.guard.latest()
    await (options.writeReport ?? atomicJson)(options.reportPath, { version: 1, campaignId: state.campaignId, status: state.status, reason: state.reason,
      updatedAt: new Date(now()).toISOString(), observation: state.observation, thresholds: {
        pauseAtPercent: options.guard.policy.pauseAtPercent, stopAtPercent: options.guard.policy.stopAtPercent },
      percentagePointsSinceBaseline: state.observation ? state.observation.usedPercent - options.guard.policy.baseline.usedPercent : null,
      overshootPoints: state.observation ? Math.max(0, state.observation.usedPercent - options.guard.policy.stopAtPercent) : null,
      cancellation, accounting: state.accounting, recovery })
  }
  const poll = async () => {
    // Recovery requires a new explicit run; a cancelled worker cannot become ready again.
    if (abort.signal.aborted) return options.guard.latest()
    let state=options.guard.latest()
    for(let attempt=1;attempt<=3;attempt++){
      try {
        const raw = await options.readRateLimit()
        if (abort.signal.aborted) return options.guard.latest()
        state = await options.guard.observe(primaryRateLimit(raw, new Date(now()).toISOString(), options.guard.policy.baseline.windowMinutes))
        if(recovering&&state.status==='ready')recovery.recovered++
        break
      } catch(error) {
        const diagnostic=safeRpcFailure(error)
        recovery.errors.push({at:new Date(now()).toISOString(),attempt,...diagnostic})
        // Bounded log, no raw errors or account metadata.
        if(recovery.errors.length>30)recovery.errors.shift()
        const transient=['timeout','network'].includes(diagnostic.category)||diagnostic.category==='http'&&(diagnostic.httpStatus===429||(diagnostic.httpStatus??0)>=500)||diagnostic.category==='rpc'&&diagnostic.rpcCode===-32603
        const observed=options.guard.latest().observation
        const fresh=!observed||now()-Date.parse(observed.observedAt)<25_000
        if(!transient||attempt===3||!fresh){state=await options.guard.setFailure();break}
        recovering=true;await options.guard.setFailure('rate_limit_recovering');await writeReport()
        await Promise.race([(options.retrySleep??wait)(attempt*1000),stopped])
        if(abort.signal.aborted)return options.guard.latest()
      }
    }
    recovering=false
    if ((state.status === 'hard_stopped' || state.status === 'paused') && cancellation === 'not_requested') {
      cancellation = 'requested'; abort.abort(Error(state.reason))
      if (options.cancelOwnedWork) {
        try { await options.cancelOwnedWork(); cancellation = 'succeeded' } catch { cancellation = 'failed' }
      }
    }
    await writeReport()
    return state
  }
  const pollOnce=()=>pollTask??=(poll().finally(()=>{pollTask=undefined}))
  const start = () => {
    if (running) return loop!
    running = true
    loop = (async () => {
      try { while (running) { await Promise.race([sleep(options.pollIntervalMs ?? 5_000), stopped]); if (running) await pollOnce() } }
      catch {
        running = false
        try { await options.guard.setFailure('watchdog_failed_closed') } catch { /* in-memory state is already paused */ }
        abort.abort(Error('watchdog_failed_closed'))
        if (cancellation === 'not_requested' && options.cancelOwnedWork) {
          cancellation = 'requested'
          try { await options.cancelOwnedWork(); cancellation = 'succeeded' } catch { cancellation = 'failed' }
        }
      }
    })()
    return loop
  }
  const stop = async () => { running = false; releaseStop(); await loop; await writeReport() }
  const preflight = async (input: { live: boolean }) => {
    if (input.live && !options.cancelOwnedWork) throw Error('live_cancellation_required')
    const state = await pollOnce()
    if (state.status !== 'ready') throw Error(`budget_preflight_${state.reason}`)
    return state
  }
  const waitForAdmission=async()=>{
    if(recovering&&pollTask)await pollTask
    if(!abort.signal.aborted&&options.guard.admission().reason==='rate_limit_stale')await pollOnce()
    const current=options.guard.admission()
    if(abort.signal.aborted||!current.allowed)throw Error(`budget_${current.reason}`)
  }
  return { pollOnce, preflight, start, stop, waitForAdmission, latest: options.guard.latest, admission: options.guard.admission, signal: abort.signal }
}

export async function runGuardedTask<T>(watchdog: BudgetWatchdog, input: { live: boolean },
  worker: (control: { signal: AbortSignal; admitNewAiWork: () => Promise<void> }) => Promise<T>): Promise<T> {
  await watchdog.preflight(input)
  watchdog.start()
  try {
    return await worker({ signal: watchdog.signal, admitNewAiWork: watchdog.waitForAdmission })
  } finally { await watchdog.stop() }
}
