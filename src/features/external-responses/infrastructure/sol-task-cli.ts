import { SOL_MODEL } from './sol-model.ts'
import { requireSolAvailability } from './sol-availability.ts'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { atomicJson, safeId, redact } from './store.ts'
import { createCodexAppServer, newOwnerToken, type OwnedTurn } from './codex-app-server.ts'
import { createQuotaGuard, loadBudgetPolicy, readGuardState } from './quota-guard.ts'
import { createBudgetWatchdog, runGuardedTask } from './budget-watchdog.ts'

/** One explicit Codex task. No automatic retries, paid API fallback, or inherited conversation. */
async function main() {
  const args = process.argv.slice(2)
  const arg = (name: string) => { const i = args.indexOf('--' + name); return i < 0 ? undefined : args[i + 1] }
  const directory = resolve(arg('campaign') ?? 'logs/external-responses/guarded-benchmark-20260929')
  const taskId = safeId(arg('task-id') ?? ''), taskFile = arg('task-file')
  if (!taskId || !taskFile) throw Error('explicit_task_id_and_file_required')
  const effort = arg('effort') ?? 'high'
  if (!['medium', 'high'].includes(effort)) throw Error('unapproved_reasoning_effort')
  const packetKind = arg('packet-kind') ?? 'implementation'
  if (!['implementation', 'assessment', 'investigation', 'baseline-investigation'].includes(packetKind)) throw Error('unapproved_packet_kind')
  if (packetKind === 'assessment' && effort !== 'medium') throw Error('assessment_requires_medium_reasoning')
  if (packetKind.includes('investigation') && effort !== 'high') throw Error('investigation_requires_high_reasoning')
  const maxInputBytes = packetKind === 'assessment' ? 64 * 1024 : packetKind === 'baseline-investigation' ? 128 * 1024 : 32 * 1024
  const prompt = await readFile(resolve(taskFile), 'utf8')
  if (Buffer.byteLength(prompt) > maxInputBytes) throw Error('task_packet_exceeds_approved_initial_limit')
  const taskRoot = join(directory, 'tasks', taskId), intentPath = join(taskRoot, 'intent.json')
  try { await readFile(intentPath); throw Error('task_intent_exists_no_automatic_reexecution') }
  catch (error: any) { if (error.code !== 'ENOENT') throw error }
  await mkdir(taskRoot, { recursive: true })
  const policy = await loadBudgetPolicy(join(directory, 'budget.json'))
  const guard = createQuotaGuard(policy, { statePath: join(directory, 'budget-status.json'), initialState: await readGuardState(join(directory, 'budget-status.json')) })
  const owner = newOwnerToken(), messages: unknown[] = [], counts: Record<string, number> = {}
  let active: OwnedTurn | undefined, finish!: (turn: any) => void, tokenUsage: unknown
  const completed = new Promise<any>(r => { finish = r })
  const server = createCodexAppServer({ onNotification: event => {
    counts[event.method] = (counts[event.method] ?? 0) + 1
    const params = event.params as any
    if (event.method === 'item/completed' && params?.item?.type === 'agentMessage') messages.push(redact(params.item.text))
    if (event.method === 'thread/tokenUsage/updated') tokenUsage = params?.tokenUsage
    if (event.method === 'turn/completed') finish(params.turn)
  } })
  const watchdog = createBudgetWatchdog({ guard, readRateLimit: () => server.readPrimaryRateLimit(),
    cancelOwnedWork: async () => { if (active) await server.interruptOwnedTurn(active) }, reportPath: join(directory, 'watchdog-report.json') })
  const startedAt = new Date().toISOString()
  let progress: NodeJS.Timeout | undefined
  try {
    const result = await runGuardedTask(watchdog, { live: true }, async control => {
      await control.admitNewAiWork()
      await requireSolAvailability(server,effort as 'medium'|'high')
      const thread = await server.startOwnedThread(owner, { model: SOL_MODEL, modelProvider: 'openai', allowProviderModelFallback: false, cwd: process.cwd(), sandbox: 'workspace-write', approvalPolicy: 'never', ephemeral: false })
      await atomicJson(intentPath, { taskId, startedAt, model: SOL_MODEL, effort, threadId: thread.ownedThread.threadId,
        promptHash: createHash('sha256').update(prompt).digest('hex'), promptBytes: Buffer.byteLength(prompt), packetKind, maxInputBytes, status: 'intent' })
      await control.admitNewAiWork()
      active = (await server.startOwnedTurn(owner, { threadId: thread.ownedThread.threadId, model: SOL_MODEL, effort,
        input: [{ type: 'text', text: prompt }] })).ownedTurn
      if (control.signal.aborted) await server.interruptOwnedTurn(active)
      progress = setInterval(() => { void atomicJson(join(taskRoot, 'progress.json'), { taskId, at: new Date().toISOString(), counts,
        quota: guard.latest().observation, lastMessage: messages.at(-1) }).catch(() => {}) }, 5000)
      // A dead transport may never send turn/completed. The owned cancellation still runs
      // in the watchdog; preserve an uncertain outcome instead of hanging after a stop.
      const stopped = () => ({ status: 'stopped_without_completion', error: String(control.signal.reason ?? 'quota_pause_or_stop') })
      if (control.signal.aborted) return stopped()
      return Promise.race([completed, new Promise<any>(resolve => control.signal.addEventListener('abort', () => resolve(stopped()), { once: true }))])
    })
    await guard.recordCall({ ok: result?.status === 'completed' })
    await atomicJson(join(taskRoot, 'result.json'), { taskId, startedAt, finishedAt: new Date().toISOString(), status: result?.status,
      error: redact(result?.error), messages, counts, tokenUsage, tokenUsageSource: 'Codex cumulative thread snapshot; do not sum updates', quota: guard.latest().observation })
    console.log(JSON.stringify({ taskId, status: result?.status, result: join(taskRoot, 'result.json'), quota: guard.latest().observation }))
    if (result?.status !== 'completed') process.exitCode = 2
  } catch (error: any) {
    await atomicJson(join(taskRoot, 'result.json'), { taskId, startedAt, status: 'failed_or_uncertain', reason: String(error.message), counts, messages })
    throw error
  } finally { clearInterval(progress); await server.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
