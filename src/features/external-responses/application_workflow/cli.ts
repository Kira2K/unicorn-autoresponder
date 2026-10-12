import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createInterface } from 'node:readline'
import { createRuntimeDatabase } from '../infrastructure/postgres.ts'
import { createDatabaseRead } from '../infrastructure/database.ts'
import { createFileStore, atomicJson, redact, safeId } from '../infrastructure/store.ts'
import { createPostgresStore } from '../infrastructure/postgres-store.ts'
import { loadCollection } from '../vacancy_collection/postgres.ts'
import { loadSelectionRules, assertCurrentSelectionRules } from '../stack_classification/rules.ts'
import { createPostgresRestrictionPolicy } from '../candidate_matching/postgres.ts'
import { loadApplicationStudent } from '../application_preparation/student.ts'
import { createAnswerGenerator } from '../application_preparation/answers.ts'
import { withTestAnswers } from '../application_preparation/test-answers.ts'
import { withPreparedAnswers } from '../application_preparation/prepared-answers.ts'
import { tailorCv, cvHash } from '../application_preparation/tailoring.ts'
import { revisePreparedCv } from '../application_preparation/revise-cv.ts'
import { createDolphinBrowser } from '../infrastructure/dolphin-browser.ts'
import { createAtsAdapters, validateApplicationSelection } from '../applications/index.ts'
import { generateReport } from '../reporting/index.ts'
import { runApplication } from './index.ts'
import { openApplicationBrowser } from './browser-availability.ts'
import { openCampaign, canStartFollowup } from './campaign.ts'
import { createApplicationFormMemory } from './form-memory.ts'
import { applicationOutput } from './output.ts'
import { createVerificationController } from '../applications/verification-controller.ts'
import { createTwoCaptchaDragSolver } from '../applications/verification-solver.ts'
import { assertInteractiveHandoff } from './interactive-handoff.ts'
import type { Page } from 'playwright'
import type { RestrictionPolicy } from '../candidate_matching/restrictions.ts'
import type { BatchState } from '../types.ts'
import { loadLatestPublicationEvidence, withLatestPublicationEvidence } from '../vacancy_collection/publication-memory.ts'
import { evaluatePublicationDate } from '../vacancy_collection/publication-date-precheck.ts'

/** Public SQL-backed single-student command; input is data, never an orchestration script. */
export async function applicationCommand(command: string, args: string[]) {
  const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1] }, flag = (name: string) => args.includes(`--${name}`)
  if (!arg('input')) throw Error('application_workflow_input_required')
  if (flag('live') === flag('dry-run')) throw Error('select_live_or_dry_run')
  if (flag('offline')) throw Error('application_workflow_requires_sql')
  assertInteractiveHandoff(flag('live'), flag('close'), process.stdin.isTTY)
  const path = resolve(arg('input')!), readInput = async () => JSON.parse(await readFile(path, 'utf8')), initial = await readInput()
  const id = safeId(initial.candidateId), batchId = safeId(initial.batchId), root = resolve(arg('storage') ?? 'storage/external-responses'), logs = resolve(arg('logs') ?? 'logs/external-responses')
  const directory = join(logs, 'applications', batchId); await mkdir(directory, { recursive: true })
  const event = async (data: Record<string, unknown>) => {
    try { await appendFile(join(directory, 'events.jsonl'), JSON.stringify(redact({ at: new Date().toISOString(), batchId, candidateId: id, ...data })) + '\n', { mode: 0o600 }) }
    catch { process.stderr.write('Application diagnostics unavailable; do not retry external writes.\n') }
  }
  const db = createRuntimeDatabase(), local = createFileStore(root, logs), store = createPostgresStore(local, db, String(initial.studentId))
  const release = await local.lock(`workflow-${initial.studentId}`)
  let context: Awaited<ReturnType<typeof createDolphinBrowser>> | undefined
  const emitReport = async () => {
    const report = await generateReport({ candidateId: id, batchId }, { store })
    await writeFile(join(directory, 'report.md'), report.markdown)
    await atomicJson(join(directory, 'results.json'), report.results)
    await atomicJson(join(directory, 'failures.json'), report.failures)
    await atomicJson(join(directory, 'robot-failures.json'), report.robotFailures)
    await writeFile(join(directory, 'applications.csv'), report.csv)
    return report
  }
  try {
    const student = await loadApplicationStudent(String(initial.studentId), createDatabaseRead())
    if (student.stackId !== initial.stackId) throw Error('student_stack_mismatch')
    if (initial.profileId && Number(initial.profileId) !== student.profileId) throw Error('student_dolphin_profile_binding_mismatch')
    const saved = await loadCollection(initial.collectionRunId, db.read), collection = saved.classification
    if (!collection) throw Error('saved_classification_required')
    const rules = await loadSelectionRules(); assertCurrentSelectionRules(collection.selectionRules, rules)
    const stack = collection.collection.scope?.stacks.find(s => s.id === initial.stackId)
    if (!stack) throw Error('database_campaign_scope_required')
    const candidate = await store.candidate(id)
    const positions = initial.positionIds.map((id: string) => {
      const p = collection.collection.positions.find(p => p.id === id); if (!p) throw Error('target_not_in_saved_collection'); return p
    })
    const common = { candidate, collection, stackId: initial.stackId, batchId, positions, limit: positions.length, mode: flag('live') ? 'live' as const : 'dry-run' as const, resume: flag('resume') }
    validateApplicationSelection(common)
    // Read latest date evidence before opening Dolphin or generating any answers/CV.
    // Do not rewrite a frozen batch or block reconciliation of an uncertain submission.
    const priorBatch = await store.batch(id, batchId)
    const dated = withLatestPublicationEvidence(positions, await loadLatestPublicationEvidence(positions, db.read))
    for (const position of dated) {
      const previous = priorBatch?.records.find(r => r.position.id === position.id)
      if (previous && ['succeeded', 'submitting', 'unknown'].includes(previous.status)) continue
      const age = evaluatePublicationDate(position, rules)
      if (age.decision !== 'continue') {
        await event({ action: 'publication_age_preflight', positionId: position.id, decision: age.decision, publication: age.context })
        throw Error(`${age.decision === 'excluded' ? 'posting_age_excluded' : 'publication_date_review_required'}:${position.id}`)
      }
    }
    let campaign: Awaited<ReturnType<typeof openCampaign>> | undefined
    if (initial.campaign) {
      if (initial.campaign.studentId !== candidate.databaseClientId || initial.campaign.candidateId !== candidate.id) throw Error('campaign_student_binding_mismatch')
      campaign = await openCampaign(join(root, 'campaigns'), initial.campaign, {
        load: async () => (await store.batch(id, initial.campaign.initialBatch))?.campaignProgress,
        save: async state => {
          const unlock = await store.lock(id)
          try {
            const initialBatch = await store.batch(id, initial.campaign.initialBatch)
            if (!initialBatch) throw Error('initial_campaign_batch_missing')
            initialBatch.campaignProgress = state; await store.saveBatch(initialBatch)
          } finally { await unlock() }
        },
      })
      if (initial.campaign.initialBatch !== batchId && campaign.state.batches.find(b => b.runId === initial.collectionRunId)?.batchId !== batchId) throw Error('campaign_batch_binding_mismatch')
      const allowed = initial.campaign.initialBatch === batchId ? initial.campaign.initialTargets : campaign.state.batches.find(b => b.runId === initial.collectionRunId)?.targets
      if (!allowed || JSON.stringify(allowed) !== JSON.stringify(initial.positionIds)) throw Error('campaign_target_scope_mismatch')
      if (initial.campaign.initialBatch !== batchId && !canStartFollowup(campaign.state)) throw Error('initial_test_not_confirmed')
    }
    const frozenInput = (v: any) => JSON.stringify({ candidateId: v.candidateId, studentId: v.studentId, batchId: v.batchId, positionIds: v.positionIds, collectionRunId: v.collectionRunId, stackId: v.stackId, campaign: v.campaign, tailoringPolicy: v.tailoringPolicy, cvMode: v.cvMode, originalCvApproval: v.originalCvApproval, verification: v.verification, currentPostingReviews: v.currentPostingReviews })
    let current = initial
    const restrictionPolicy: RestrictionPolicy = createPostgresRestrictionPolicy({ read: createDatabaseRead(), market: student.market, expectedStack: stack, evaluate: async (rule, _candidate, position) => {
      const review = current.restrictionReviews?.[`${rule.id}:${position.id}`]
      const inputHash = cvHash(JSON.stringify({ rule, studentId: candidate.databaseClientId, facts: _candidate.facts, positionId: position.id, description: position.description }))
      if (!review || review.inputHash !== inputHash) return { decision: 'review', reason: 'A current assistant restriction review is required', evidence: [] }
      return review
    } })
    // Existing market membership is checked on every restriction refresh, not inferred from CV.
    const loadRestrictions = restrictionPolicy.load
    restrictionPolicy.load = async c => {
      const fresh = await loadApplicationStudent(String(initial.studentId), createDatabaseRead())
      if (fresh.market !== student.market || fresh.stackId !== student.stackId || fresh.profileId !== student.profileId) throw Error('student_routing_changed')
      return loadRestrictions(c)
    }
    if (command === 'revise-cv') {
      if (!flag('live')) throw Error('revision_requires_live_sql_write')
      for (const position of positions) {
        const revision = initial.cvRevisions?.[position.id]
        if (!revision) throw Error('reviewed_cv_revision_required')
        const artifact = await revisePreparedCv({ ...revision, candidateId: id, batchId, positionId: position.id }, { store })
        await event({ action: 'tailored_cv_revised', positionId: position.id, artifact })
        console.log(JSON.stringify({ positionId: position.id, path: artifact.path, sha256: artifact.sha256 }))
      }
      return
    }
    if (command === 'tailor') {
      if (initial.cvMode === 'original') throw Error('tailor_not_applicable_original_cv')
      if (!flag('live')) throw Error('tailor_requires_explicit_live_mode')
      if (!process.env.CV_TAILORING_API_KEY?.trim()) throw Error('cv_tailoring_not_configured')
      const batch = await store.batch(id, batchId)
      if (!batch || JSON.stringify(batch.targetIds) !== JSON.stringify(initial.positionIds)) throw Error('prepare_batch_first')
      for (const position of positions) {
        const record = batch.records.find(r => r.position.id === position.id)
        if (record?.status !== 'prepared' || record.answers?.missing.length) throw Error('prepare_answers_first')
        const artifact = await tailorCv({ candidate, position, batchId, policy: initial.tailoringPolicy, directory: join(root, 'candidates', id, 'tailored', batchId) })
        record.preparedCv = artifact
        const unlock = await store.lock(candidate.id)
        try { await store.saveBatch(batch) } finally { await unlock() }
        await event({ action: 'tailored_cv_generated', positionId: position.id, artifact }); console.log(JSON.stringify(artifact))
      }
      return
    }
    if (flag('live') && command === 'run-application' && initial.cvMode !== 'original' && !process.env.CV_TAILORING_API_KEY?.trim()) throw Error('cv_tailoring_not_configured')
    const availability = await openApplicationBrowser({ profileId: student.profileId, owner: `external-responses:${batchId}`, event })
    if (availability.status === 'busy') {
      const result = { ...availability, batchId, candidateId: id, targetIds: initial.positionIds, at: new Date().toISOString(), attempted: false }
      await event({ action: 'workflow_deferred', ...result })
      await atomicJson(join(directory, 'availability.json'), result)
      // Preserve any previous application evidence; no failed application or submission is created.
      await writeFile(join(directory, 'availability.md'), `# Application availability\n\n${id}: **busy / deferred**. No profile interaction or new application attempt.\n\n${result.nextAction}\n`)
      console.log(JSON.stringify(result)); return
    }
    context = availability.context
    await atomicJson(join(directory, 'availability.json'), { status: 'available', profileId: student.profileId, at: new Date().toISOString() })
    const verificationPages = new Map<string, Page>()
    const adapters = createAtsAdapters({ context, evidenceRoot: join(directory, 'evidence'), selectionRules: rules, stackId: initial.stackId.replace(/^stack-/, ''), sumupReviews: initial.currentPostingReviews, onVerificationPage: (positionId, page) => verificationPages.set(positionId, page) })
    const verificationControllers = new WeakMap<Page, ReturnType<typeof createVerificationController>>()
    const verificationController = () => {
      const active = [...verificationPages].filter(([positionId, page]) => initial.positionIds.includes(positionId) && !page.isClosed())
      if (active.length !== 1) throw Error('verification_requires_one_retained_target')
      const [positionId, page] = active[0]
      let controller = verificationControllers.get(page)
      if (!controller) {
        const enabled = initial.verification?.enabled === true && initial.verification?.provider === '2captcha' && initial.verification?.positionId === positionId
          && Number.isFinite(Date.parse(initial.verification?.approvedAt)) && !!initial.verification?.approvalReference?.trim()
        const automation = enabled ? { extract: async () => undefined, solver: createTwoCaptchaDragSolver({ enabled: true, key: process.env.TWO_CAPTCHA_API_KEY, intentDirectory: join(directory, 'verification-solver') }) } : undefined
        controller = createVerificationController(page, join(directory, 'evidence'), undefined, automation)
        verificationControllers.set(page, controller)
      }
      return controller
    }
    const run = async (resume: boolean) => {
      current = await readInput()
      if (frozenInput(current) !== frozenInput(initial)) throw Error('application_workflow_scope_changed')
      const base = createAnswerGenerator()
      const answers = current.campaign?.aggressiveTestAnswers ? withTestAnswers(base, { campaignId: current.campaign.id, studentId: String(current.studentId), batchId, targets: current.positionIds, answers: current.testAnswers ?? [] }) : withPreparedAnswers(base, current.preparedAnswers)
      const batch = await runApplication({ ...common, resume, market: student.market, stage: command === 'prepare-application' ? 'prepare' : command === 'apply-application' ? 'apply' : 'run', tailoringPolicy: current.tailoringPolicy, cvMode: current.cvMode, originalCvApproval: current.originalCvApproval, testReviews: current.testReviews, retryAuthorizations: current.retryAuthorizations, humanAssistance: current.humanAssistance, testCampaign: current.campaign ? { id: current.campaign.id, answerOverride: current.campaign.aggressiveTestAnswers } : undefined }, {
        store, adapters, answers, restrictions: restrictionPolicy, rules, event, formMemory: createApplicationFormMemory(db),
        tailor: position => tailorCv({ candidate, position, batchId, policy: current.tailoringPolicy, directory: join(root, 'candidates', id, 'tailored', batchId) }),
        verification: { queue: async record => event({ action: 'handoff', positionId: record.position.id, reason: record.reason }) }
      })
      if (campaign) {
        const confirmed = batch.records.length === batch.limit && batch.records.every(r => r.status === 'succeeded' && r.evidence?.confirmation === 'captured' && r.preparedCv?.testReview?.result === 'passed')
        if (batch.id === campaign.state.scope.initialBatch && confirmed) campaign.state.initialConfirmed = true
        else if (batch.id !== campaign.state.scope.initialBatch) {
          const b = campaign.state.batches.find(b => b.runId === initial.collectionRunId)
          if (b) b.completed = batch.records.length === batch.limit && batch.records.every(r => ['succeeded', 'failed', 'blocked', 'unknown', 'skipped'].includes(r.status))
        }
        await campaign.save()
      }
      await emitReport()
      console.log(JSON.stringify(applicationOutput(batch, join(directory, 'report.md'), flag('verbose'), { campaign: current.campaign, testReviews: current.testReviews, cvMode: current.cvMode }), null, flag('verbose') ? 2 : undefined))
      return batch
    }
    let batch = await run(flag('resume'))
    if (flag('live') && !flag('close') && batch.records.some(r => r.status !== 'succeeded' && r.status !== 'skipped')) {
      console.log('Workflow paused with browser preserved. Type status, verify inspect/capture/capture-visual/confirm/click/drag/solve, resume, or exit.')
      const terminal = createInterface({ input: process.stdin, output: process.stdout })
      for await (const line of terminal) {
        if (line.trim() === 'exit') { terminal.close(); break }
        if (line.trim() === 'status') {
          console.log(JSON.stringify({ source: 'retained_process_checkpoint', refreshed: false,
            ...applicationOutput(batch, join(directory, 'report.md'), false, { campaign: current.campaign, testReviews: current.testReviews, cvMode: current.cvMode }) }))
          continue
        }
        if (line.trim().startsWith('verify ')) {
          const verificationStarted = Date.now()
          const operation = line.trim().split(/\s+/)[1]
          const auditOperation = ['inspect', 'capture', 'capture-visual', 'confirm', 'click', 'drag', 'solve'].includes(operation) ? operation : 'invalid'
          try {
            const [_, command, ...values] = line.trim().split(/\s+/), controller = verificationController()
            const number = (value: string) => { const n = Number(value); if (!Number.isFinite(n)) throw Error('verification_number_required'); return n }
            let result: unknown
            if (command === 'inspect' && !values.length) result = await controller.inspect()
            else if (command === 'capture' && values.length === 5) result = await controller.capture(number(values[0]), { x: number(values[1]), y: number(values[2]), width: number(values[3]), height: number(values[4]) })
            else if (command === 'capture-visual' && values.length === 5) result = await controller.capture(number(values[0]), { x: number(values[1]), y: number(values[2]), width: number(values[3]), height: number(values[4]) }, 'visual')
            else if (command === 'confirm' && values.length === 2 && ['assistant', 'operator'].includes(values[1])) result = await controller.confirmVisual(values[0], values[1] as 'assistant' | 'operator')
            else if (command === 'click' && values.length === 3) result = await controller.act(values[0], { type: 'click', at: { x: number(values[1]), y: number(values[2]) } })
            else if (command === 'drag' && values.length === 5) result = await controller.act(values[0], { type: 'drag', from: { x: number(values[1]), y: number(values[2]) }, to: { x: number(values[3]), y: number(values[4]) } })
            else if (command === 'solve' && values.length === 1) { if (!process.env.TWO_CAPTCHA_API_KEY?.trim()) throw Error('verification_provider_key_missing'); result = await controller.solve(values[0]) }
            else throw Error('verification_command_invalid')
            const evidence = result as { id?: string; snapshotId?: string; path?: string }
            await event({ action: 'verification_command', operation: auditOperation, positionIds: initial.positionIds, outcome: 'completed', durationMs: Date.now() - verificationStarted, snapshotId: evidence.id ?? evidence.snapshotId, evidencePath: evidence.path, ...(auditOperation === 'confirm' ? { reviewSource: (result as { reviewSource?: string }).reviewSource } : {}) })
            console.log(JSON.stringify(result))
          } catch (error: any) {
            // Log known codes only: browser/provider errors can include URLs or request data.
            const reason = /^verification_[a-z0-9_]+$/.test(error.message ?? '') ? error.message : 'verification_operation_failed'
            await event({ action: 'verification_command', operation: auditOperation, positionIds: initial.positionIds, outcome: 'failed', reason, durationMs: Date.now() - verificationStarted })
            console.error(reason)
          }
          continue
        }
        if (line.trim() === 'resume') { try { batch = await run(true); if (batch.records.every(r => ['succeeded', 'skipped'].includes(r.status))) { terminal.close(); break } } catch (e: any) { await event({ action: 'resume_failed', error: e.message }); console.error(e.message) } }
      }
    }
  } catch (error: any) {
    await event({ action: 'workflow_failed', error: error.message }); await emitReport().catch(() => {}); throw error
  } finally { try { await context?.close() } finally { await release(); await db.close() } }
}
