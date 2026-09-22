import { enabledFor, emptySettings, features, automationError, type AutomationStore, type AutomationAdapters,
  type AutomationRun, type FeatureState, type ExecutionAuthority } from './contracts.ts'
import { windows, reservedTime, validateSettings, occurrenceKey } from './calendar.ts'
import { planSlotTasks, minimumTaskPauseMs, taskTimeLimitMs } from './slot-plan.ts'
import { randomUUID } from 'node:crypto'
import { safeCode } from './audit.ts'
import { readAutomationDiagnostics } from './diagnostics.ts'
import { commentWaitReason } from './comment-policy.ts'
import { localDate } from './calendar.ts'
export function createLinkedInOrchestrator(deps: { store: AutomationStore; adapters: AutomationAdapters;
  authority: ExecutionAuthority; now: () => number; random: () => number;
  accountExists: (account: number) => Promise<boolean>; previewOnly?:boolean; log?: (code: string) => void }, autoStart = true) {
  const { store, adapters, authority, now } = deps
  const instance = randomUUID(), startedAt = now()
  let recovered=false
  const checkpoints = new Map<string,string>()
  let closed = false, ticking: Promise<void> | undefined
  let tail: Promise<unknown> = Promise.resolve(), settingsTail: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const request = tail.then(fn); tail = request.catch(() => {}); return request
  }
  const save = async (run: AutomationRun) => {
    run.updatedAt = now()
    const checkpoint = `${run.state}:${run.reason ?? ''}:${run.featureRunId ?? ''}:${Boolean(run.stopRequested)}:${run.plannedAt}:${run.nextActionAt??0}:${run.publication?.id ?? ''}`
    await store.saveRun(run, checkpoints.get(run.key) === checkpoint ? undefined : {
      at:now(),account:run.account,feature:run.feature,runKey:run.key,stage:run.state,
      code:safeCode(run.reason ?? run.state),level:run.state === 'blocked' ? 'error' : run.reason==='task_time_limit'?'warning':'info',
      details:{state:run.state,plannedAt:run.plannedAt,pauseBeforeMs:run.pauseBeforeMs??0,
        ...(run.deadlineAt===undefined?{}:{deadlineAt:run.deadlineAt}),
        ...(run.nextActionAt===undefined?{}:{nextActionAt:run.nextActionAt}),
        ...(run.publication ? {publishedAt:run.publication.at} : {})} })
    checkpoints.set(run.key,checkpoint)
  }
  async function finish(run: AutomationRun, state: FeatureState) {
    run.featureRunId = state.id
    run.nextActionAt = state.nextActionAt
    if (!state.owned) { run.state = 'blocked'; run.reason = 'manual_task_active'; run.finishedAt = now() }
    else {
      if (state.publication) run.publication = state.publication
      run.state = state.state === 'stopped' ? 'cancelled' : state.state
      run.reason = state.reason
      if (['completed', 'blocked', 'cancelled'].includes(run.state)) run.finishedAt = now()
    }
    if (run.state !== 'running') run.releasedAt ??= now()
    if (run.state === 'monitoring') run.deadlineAt = undefined
    await save(run)
  }
  const commentPublication = (run:AutomationRun,runs:AutomationRun[]) => {
    const post=runs.filter(r=>r.account===run.account && r.feature==='posts' && r.publication && r.publication.at<=now())
      .sort((a,b)=>b.publication!.at-a.publication!.at)[0]
    if(post)run.publication=post.publication
  }
  async function stop(run: AutomationRun, reason: 'disabled_by_admin' | 'task_time_limit' = run.stopReason ?? 'disabled_by_admin') {
    run.stopRequested = true; run.stopReason = reason; run.reason = reason; await save(run)
    if (['starting', 'running', 'deferred', 'monitoring'].includes(run.state)) {
      await adapters[run.feature].stop(run)
      const status=await adapters[run.feature].status(run)
      if(status?.owned && (status.state==='running' || status.state==='deferred')) {
        run.state=status.state;run.reason=reason==='task_time_limit'?reason:'stop_requested';await save(run);return
      }
      if(status?.owned && status.state==='blocked') {
        run.state='blocked';run.reason=status.reason??'uncertain';run.releasedAt??=now();await save(run);return
      }
    }
    run.state = reason==='task_time_limit' ? 'blocked' : 'cancelled'
    run.reason = reason; run.finishedAt = now(); run.releasedAt??=now(); await save(run)
  }
  async function executeTick() {
    if (closed) return
    await authority.check()
    const restoring = !recovered
    if(!recovered) {
      const previous=await store.heartbeat()
      await store.appendEvent({at:now(),level:'info',stage:'recovery',code:'worker_restarted',
        details:{previousHeartbeat:previous?.at??0,previousShutdownClean:previous?.state==='stopped'}})
      recovered=true
    }
    await store.heartbeat({instance,startedAt,at:now(),state:restoring?'recovering':'ready'})
    const configs = await store.settings(), runs = await store.runs()
    if(deps.previewOnly) {await store.heartbeat({instance,startedAt,at:now(),state:'ready',code:'preview_only'});return}
    for (const run of runs.filter(r => ['planned', 'starting', 'running', 'deferred', 'monitoring'].includes(r.state) ||
      (r.feature==='posts' && r.state==='completed' && !r.publication && r.date===localDate(now())))) {
      try {
        const config = configs.find(c => c.account === run.account)
        // Older releases did not persist publication evidence in orchestrator rows. Read the existing post once;
        // never start or republish it to enable comments after an upgrade.
        if (run.state==='completed') {
          if (enabledFor(config,'comments')) {
            const status=await adapters.posts.status(run)
            if (status?.owned && status.publication) {run.publication=status.publication;await save(run)}
          }
          continue
        }
        if (!enabledFor(config, run.feature) || run.stopRequested) { await stop(run); continue }
        if (run.feature === 'comments') {
          if (run.state === 'planned' && !run.commentMode) {
            run.state='cancelled';run.reason='comment_policy_changed';await save(run);continue
          }
          run.commentMode='continuous'
          if (enabledFor(config,'posts')) commentPublication(run,runs)
          else run.publication=undefined
          const reason=commentWaitReason(config,runs,run,now())
          if (reason) {run.reason=reason;await save(run);continue}
          if (run.state === 'planned') continue
        }
        if (run.state === 'planned') {
          const same = config!.slots.some(s => s.id === run.slotId && s.features.includes(run.feature) &&
            windows({ ...config!, slots: [s] }, run.opensAt, 1).some(w => w.start === run.opensAt && w.end === run.closesAt))
          if (!same) { run.state = 'cancelled'; run.reason = 'schedule_changed'; await save(run) }
          else if (run.closesAt <= now()) { run.state = 'missed'; run.reason = 'window_closed'; await save(run) }
          continue
        }
        if (run.state !== 'monitoring' && run.deadlineAt === undefined && run.startedAt !== undefined) {
          run.deadlineAt=run.startedAt+taskTimeLimitMs(run.reserveMs);await save(run)
        }
        if (run.state === 'monitoring') await adapters[run.feature].maintain?.(run)
        const status = await adapters[run.feature].status(run)
        if ((!status || ['running','deferred'].includes(status.state)) && run.deadlineAt !== undefined && now() >= run.deadlineAt) {
          if(status)run.featureRunId=status.id
          await stop(run,'task_time_limit')
        }
        else if (status) await finish(run, status)
        else if (run.state === 'starting') await finish(run, await adapters[run.feature].start(run))
        else { run.state = 'blocked'; run.reason = 'feature_run_missing'; await save(run) }
      } catch(error) {
        const code = safeCode((error as any)?.code)
        if (code.startsWith('automation_writer_') || code.startsWith('postgres_')) throw error
        run.reason = code; await save(run)
      }
    }
    const active = () => runs.filter(r => ['starting', 'running'].includes(r.state))
    for (const config of configs.filter(c => c.enabled)) {
      const estimates = new Map<string,number>()
      for (const window of windows(config, now(), 8)) {
        const pending: Array<{key:string;feature:AutomationRun['feature'];reserveMs:number}> = []
        for (const feature of window.slot.features) {
          // Comments are a background monitor, not a randomly timed slot task.
          if (feature === 'comments') continue
          const key = occurrenceKey(config.account, feature, window.date, window.slot)
          if (runs.some(r => r.key === key)) continue
          const samples = runs.filter(r => r.account === config.account && r.feature === feature && r.state === 'completed' &&
            r.startedAt !== undefined && r.finishedAt !== undefined).sort((a,b) => b.finishedAt! - a.finishedAt!)
            .map(r => r.finishedAt! - r.startedAt!)
          if (!estimates.has(feature)) {
            try { estimates.set(feature,(await adapters[feature].inspect(config.account)).estimateMs ?? 0) }
            catch(error) {
              const code=safeCode((error as any)?.code)
              if(code.startsWith('automation_writer_') || code.startsWith('postgres_'))throw error
              await store.appendEvent({at:now(),account:config.account,feature,level:'error',stage:'duration_estimate',code})
              // Keep the initial conservative reserve; readiness is checked again before execution.
              estimates.set(feature,0)
            }
          }
          const reserveMs = reservedTime(feature, estimates.get(feature), samples)
          pending.push({key,feature,reserveMs})
        }
        // Keep already saved starts intact when a feature is added to a slot.
        const occupiedUntil = runs.filter(r=>r.account===config.account && r.feature!=='comments' && r.opensAt===window.start &&
          r.closesAt===window.end && !['cancelled','missed'].includes(r.state))
          .reduce((end,r)=>Math.max(end,r.releasedAt??r.finishedAt??(r.plannedAt+r.reserveMs)),window.start)
        const plan = planSlotTasks(occupiedUntil,window.end,now(),pending,deps.random)
        for (const {key,feature,reserveMs} of pending) {
          const timing = plan.get(key)
          const run = await store.claim({ key, account: config.account, feature, date: window.date, slotId: window.slot.id,
            opensAt: window.start, closesAt: window.end, plannedAt: timing?.plannedAt ?? window.start,
            pauseBeforeMs:timing?.pauseBeforeMs,reserveMs,
            state: !timing ? 'missed' : 'planned', reason: !timing ?
              (reserveMs > window.end-window.start ? 'window_too_short':'insufficient_time') : undefined, updatedAt: now() })
          runs.push(run)
          await save(run)
        }
      }
      if (enabledFor(config,'comments') && !runs.some(r=>r.account===config.account && r.feature==='comments' &&
        ['planned','starting','running','deferred','monitoring'].includes(r.state))) {
        const key=`${config.account}:comments:continuous:${config.revision}`
        if (!runs.some(r=>r.key===key)) {
          const run=await store.claim({key,account:config.account,feature:'comments',commentMode:'continuous',
            date:localDate(now()),slotId:'continuous',opensAt:now(),closesAt:now(),plannedAt:now(),
            reserveMs:reservedTime('comments'),state:'planned',updatedAt:now()})
          runs.push(run);await save(run)
        }
      }
    }
    const due = runs.filter(r => r.state === 'planned' && r.plannedAt <= now() && r.opensAt <= now())
      .sort((a,b) => Number(a.feature==='comments')-Number(b.feature==='comments') ||
        a.closesAt - b.closesAt || a.plannedAt - b.plannedAt || a.key.localeCompare(b.key))
    for (const run of due) {
      if (closed) return
      if(run.feature==='comments' && runs.some(r=>r.account===run.account && r.state==='monitoring')) {
        run.state='cancelled';run.reason='monitor_already_running';await save(run);continue
      }
      if (active().some(r => r.account === run.account)) {
        run.reason = 'waiting_for_account'; await save(run); continue
      }
      try {
        await authority.check()
        const fresh = (await store.settings()).find(c => c.account === run.account)
        if (!enabledFor(fresh, run.feature)) { await stop(run); continue }
        if (run.feature === 'comments') {
          if (enabledFor(fresh,'posts')) commentPublication(run,runs)
          else run.publication=undefined
          const reason=commentWaitReason(fresh,runs,run,now())
          if (reason) {run.reason=reason;await save(run);continue}
          const check=await adapters.comments.inspect(run.account)
          if (!check.ready || check.busy) {run.reason=check.reason??'waiting_for_account';await save(run);continue}
          run.state='starting';run.startedAt=now();run.reason=undefined;await save(run)
          await finish(run,await adapters.comments.start(run));continue
        }
        const previousEnd = runs.filter(r=>r.account===run.account && r.feature!=='comments' && r.key!==run.key && r.startedAt!==undefined)
          .reduce((end,r)=>Math.max(end,r.releasedAt??r.finishedAt??0),0)
        const afterPause = previousEnd ? previousEnd + Math.max(minimumTaskPauseMs,run.pauseBeforeMs??0) : 0
        if (afterPause > run.plannedAt) {
          run.plannedAt=afterPause;run.reason='waiting_for_pause';await save(run)
        }
        if (Math.max(now(),run.plannedAt) + run.reserveMs > run.closesAt) {
          run.state='missed';run.reason='insufficient_time';await save(run);continue
        }
        if (run.plannedAt > now()) continue
        const adapter = adapters[run.feature], check = await adapter.inspect(run.account)
        if (!check.ready || check.busy) { run.reason = check.reason ?? 'waiting_for_account'; await save(run); continue }
        run.reserveMs = Math.max(run.reserveMs, reservedTime(run.feature, check.estimateMs))
        if (now() + run.reserveMs > run.closesAt) {
          run.state = 'missed'; run.reason = 'insufficient_time'; await save(run); continue
        }
        run.state = 'starting'; run.startedAt = now(); run.deadlineAt=run.startedAt+taskTimeLimitMs(run.reserveMs)
        run.reason = undefined; await save(run)
        await finish(run, await adapter.start(run))
      } catch (error) {
        const code = String((error as { code?: string }).code ?? 'automation_feature_unavailable')
        if (code.startsWith('automation_writer_') || code.startsWith('postgres_')) throw error
        run.reason = /^[a-z0-9_]{1,100}$/.test(code) ? code : 'automation_feature_unavailable'
        if (run.state === 'starting') {
          if (run.feature==='comments' && code.startsWith('automation_comments_')) run.state='planned'
          else {run.state='blocked';run.finishedAt=now()}
        }
        await save(run)
      }
    }
    await store.heartbeat({instance,startedAt,at:now(),state:'ready'})
  }
  const tick = () => ticking ??= serial(async () => {
    try { await executeTick() }
    catch(error) {
      try { await store.heartbeat({instance,startedAt,at:now(),state:'error',code:safeCode((error as any)?.code,'automation_tick_failed')}) } catch { /* Old heartbeat deliberately becomes stale. */ }
      throw error
    }
  }).finally(() => { ticking = undefined })
  const timer = autoStart ? setInterval(() => { void tick().catch(error => deps.log?.(String(error?.code ?? 'automation_tick_failed'))) }, 5000) : undefined
  timer?.unref()
  async function update(account: number, input: unknown, expectedRevision: number) {
    const request=settingsTail.then(async () => {
      await authority.check()
      if (!await deps.accountExists(account)) throw automationError('automation_account_missing')
      const old = (await store.settings()).find(c => c.account === account) ?? emptySettings(account)
      if (old.revision !== expectedRevision) throw automationError('automation_settings_conflict')
      const config = validateSettings(account, input, old.revision, now())
      config.managed = old.managed || config.enabled
      const saved = await store.saveSettings(config, expectedRevision,{at:now(),account,level:'info',stage:'settings_changed',
        code:config.enabled?'automation_enabled':'disabled_by_admin',details:{revision:config.revision,slotCount:config.slots.length}})
      // Persist the off switch before notifying running services. Write guards read this same value.
      await serial(async()=>{
        for (const run of await store.runs(account)) if (['planned','starting','running','deferred','monitoring'].includes(run.state) &&
          !enabledFor(saved, run.feature)) await stop(run)
      })
      return saved
    })
    settingsTail=request.catch(()=>{});return request
  }
  return {
    tick, update,
    diagnostics: (query?: Parameters<typeof readAutomationDiagnostics>[2]) => readAutomationDiagnostics(store,now(),query),
    async bulk(items: Array<{ account: number; settings: unknown; revision: number }>) {
      if (!Array.isArray(items) || !items.length || items.length > 200 || new Set(items.map(i => i.account)).size !== items.length)
        throw automationError('automation_bulk_invalid')
      const results = []
      for (const item of items) {
        try { results.push({ account: item.account, ok: true, settings: await update(item.account, item.settings, item.revision) }) }
        catch (error) { results.push({ account: item.account, ok: false, error: String((error as any).code ?? 'automation_update_failed') }) }
      }
      return results
    },
    async snapshot(account?: number) {
      const configs = (await store.settings()).filter(c => account === undefined || c.account === account)
      if (account !== undefined && !configs.length) configs.push(emptySettings(account))
      return { timezone: 'Europe/Moscow', previewOnly:Boolean(deps.previewOnly), settings: configs, runs: await store.runs(account),
        preview: configs.flatMap(c => windows(c, now()).map(w => ({ account: c.account, ...w,
          requiredMs: slotReserve(w.slot.features),
          tooShort: slotReserve(w.slot.features) > w.end - w.start }))),
        features, minimumTaskPauseMs, initialReserves: Object.fromEntries(features.map(f => [f, reservedTime(f)])) }
    },
    async close() { closed = true; if (timer) clearInterval(timer); await settingsTail; await tail;
      await store.heartbeat({instance,startedAt,at:now(),state:'stopped'}) }
  }
}
const slotReserve = (selected: AutomationRun['feature'][]) => {
  const tasks=selected.filter(f=>f!=='comments')
  return tasks.reduce((sum,f)=>sum+reservedTime(f),0)+Math.max(0,tasks.length-1)*minimumTaskPauseMs
}
export type LinkedInOrchestrator = ReturnType<typeof createLinkedInOrchestrator>
