import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { appendFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createAiUsageRecorder } from './infrastructure/ai-usage.ts'
import { intakeCandidate, fileCvSource, discoverPositions, createWebsiteStrategy, createDialogStrategy, applyToPositions, generateReport, readSources, createFileStore, createAtsAdapters, createBrowserSession, createPageReader, createSkillStrategy, createAiClient, existingCvExtractor, createAnswerGenerator, aiFitAssessor } from './index.ts'
import { atomicJson, safeId, diagnostic } from './infrastructure/store.ts'
import { parseBrowserDriver } from './infrastructure/browser.ts'
import { positionId } from './infrastructure/identity.ts'
import { withPreparedAnswers } from './application_preparation/prepared-answers.ts'
import { createSourceReviewStore } from './vacancy_collection/source-reviews.ts'
import { createReviewedAssessors } from './stack_classification/reviewed-assessor.ts'
import type { Candidate, DiscoveryResult, Position } from './types.ts'
import { collectVacancies, classifyVacancies, javaStack, matchCandidatePositions, validateApplicationSelection, generateCollectionReport } from './index.ts'
import type { ClassifiedCollection } from './stack_classification/index.ts'
import { createDatabaseRead } from './infrastructure/database.ts'
import { loadCampaignScope } from './stack_catalog/postgres.ts'
import { assertCampaignScope } from './stack_catalog/campaign.ts'
import type { CampaignScope } from './stack_catalog/campaign.ts'
import { loadSelectionRules, assertCurrentSelectionRules } from './stack_classification/rules.ts'
import { createPostgresRestrictionPolicy } from './candidate_matching/postgres.ts'
import { createRestrictionEvaluator } from './candidate_matching/restriction-ai.ts'
import type { RestrictionPolicy } from './candidate_matching/restrictions.ts'
import { processCompanySources, reportCompanySources } from './index.ts'
import { createRuntimeDatabase } from './infrastructure/postgres.ts'
import { createPostgresStore } from './infrastructure/postgres-store.ts'
import { loadDatabaseSources } from './company_sources/postgres.ts'
import { saveCollection, loadCollection } from './vacancy_collection/postgres.ts'
import { openCollectionCheckpoint } from './vacancy_collection/checkpoint.ts'
import { saveClassification } from './stack_classification/postgres.ts'
import { scanCommand } from './scan-cli.ts'
import { sourceInspectionCommand } from './vacancy_collection/source-inspection.ts'
import { configureCombinedAssessment } from './stack_classification/combined-ai.ts'
import { classifyWithReuse } from './stack_classification/reuse.ts'
import { refreshSavedClassification } from './stack_classification/refresh-saved.ts'
import { loadLatestPublicationEvidence } from './vacancy_collection/publication-memory.ts'
import { revalidateSession } from './stack_classification/revalidate-session.ts'
import { withSessionClassificationLock } from './stack_classification/session-classification.ts'
import { loadSourceMemory, saveSourceMemory } from './vacancy_collection/memory-postgres.ts'
import { applicationCommand } from './application_workflow/cli.ts'
import { applicationStatusCommand } from './application_workflow/status-cli.ts'
import { guardedBenchmarkCommand } from './benchmark/command.ts'
import { benchmarkBatchCommand } from './benchmark/batch-command.ts'
import { benchmarkReviewCommand } from './benchmark/review.ts'
import { benchmarkCampaignReport } from './benchmark/campaign-report.ts'
const require = createRequire(import.meta.url)
require('dotenv').config({ quiet: true })

async function main() {
  const [requestedCommand, ...args] = process.argv.slice(2)
  if (requestedCommand === 'application-status' && !args.includes('--help')) return applicationStatusCommand(args)
  if(requestedCommand==='benchmark-batch'&&!args.includes('--help'))return benchmarkBatchCommand(args)
  if(requestedCommand==='benchmark-review'&&!args.includes('--help'))return benchmarkReviewCommand(args)
  if(requestedCommand==='benchmark-report'&&!args.includes('--help'))return benchmarkCampaignReport(args[args.indexOf('--campaign')+1]??'')
  if (['run-application', 'tailor', 'revise-cv', 'prepare-application', 'apply-application'].includes(requestedCommand) && !args.includes('--help')) return applicationCommand(requestedCommand, args)
  if (['prepare', 'apply'].includes(requestedCommand) && args.includes('--workflow') && !args.includes('--help')) return applicationCommand(`${requestedCommand}-application`, args.map(a => a === '--workflow' ? '--input' : a))
  if(['scan','scan-schema','scan-report'].includes(requestedCommand)&&!args.includes('--help'))return scanCommand(requestedCommand,args)
  if(requestedCommand==='guarded-benchmark'&&!args.includes('--help'))return guardedBenchmarkCommand(args)
  if(requestedCommand==='inspect-source'&&!args.includes('--help'))return sourceInspectionCommand(args)
  const command = requestedCommand === 'prepare' ? 'apply' : requestedCommand
  const flag = (name: string) => args.includes(`--${name}`)
  const arg = (name: string, fallback?: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1] }
  if (!command || requestedCommand === '--help' || flag('help')) {
    console.log(['external:responses scan|scan-schema|scan-report|guarded-benchmark|sources|scope|intake|collect|classify|match|prepare|tailor|run-application|apply|report|report-collection',
      'run-application --input workflow.json --live|--dry-run [--resume] [--close]: sequential SQL student, Dolphin/Patchright, reviewed answers, per-vacancy tailoring and report.',
      'prepare-application uses the same workflow input for inspection only; tailor requires a prepared batch and explicit --live.',
      'prepare|apply --workflow workflow.json are independent Dolphin preparation/submission stages; apply never generates another CV.',
      'application-status --input workflow.json: compact read-only SQL checkpoint, exact next steps and rule differences; no browser/AI.',
      'application-status --input workflow.json --worker-packet [--position ID]: one-target handoff without conversation, CV, answers or historical evidence; no worker is launched.',
      'In a paused live application process: verify inspect|capture|click|drag|solve operates only the retained hCaptcha tab; see application_workflow/RUNBOOK.md.',
      'scan --concurrency 1 runs one source/repair action at a time (default 3, maximum 3).',
      'scan --budget-campaign DIR reads an approved quota policy and fails closed before live work; requires concurrency 1 and cached classification.',
      'scan --classification-session-policy FILE uses Sol medium with a locally verified tool-free Codex profile; requires approved policy/budget, ChatGPT account and outputLimitMode=observed. No coding-agent or paid-API fallback.',
      'scan --company-ids 100,101 --db-stacks 2,3,5 --run ID [--force-refresh] [--resume] [--seed-run ID] [--export]',
      '  Codex pilot: --reasoner codex --concurrency 1 --max-pages 200 --source-timeout-seconds 900 --await-review',
      'inspect-source --request FILE --url URL --browser-driver patchright [--steps FILE] [--extraction FILE]: budgeted, collection-only evidence for Sol.',
      'scan requires --company-ids or --all-companies. Default classification is cached; paid API requires --classification api --inference-policy FILE.',
      'scan --await-review saves collection without final classification; resume the same run with --assessments FILE to record an explicit human/session review.',
      'scan-schema [--apply --expect-checksum HASH]; scan-report --runs ID,ID --out comparison.md',
      'guarded-benchmark --mode cold|transfer --campaign DIRECTORY --run ID [--execute] [--resume] [--diagnose-company ID]: plain preflight by default; explicit execution uses isolated checkpoints/reports, no applications or production SQL writes.',
      'sources --out catalog.json reads canonical PostgreSQL sources; collect uses the full DB source manifest.',
      '--collection-run ID loads persisted collection/classification; --offline uses only fixture files and cannot submit.',
      'sources --input workbook.snapshot.json --layout resources.sheet.json --out DIRECTORY (source preparation only)',
      'scope --out scope.json [--db-stacks 5] [--students 20,21]',
      'collect --input companies.json --run ID --out collected.json [--scope scope.json | --db-stacks 5]',
      'collect --run ID --resume replays audit checkpoints; classify promotes only matched vacancies to SQL.',
      'classify --input collected.json --out classified.json',
      'classify --collection-run ID --assessments FILE uses explicit evidence-backed reviewed decisions, without AI calls.',
      'classify --refresh-saved --collection-run OLD --run NEW --db-stacks IDS rechecks saved descriptions with current rules; no crawling or AI calls; changed semantic policy stays pending.',
      'classify reads .agents/skills/vacancy-selection/SKILL.md; --selection-rules PATH selects another rules file.',
      'match --candidate LOCAL_ID --student DB_ID --collection classified.json --stack stack-5 --out matches.json',
      'prepare/apply --candidate LOCAL_ID --student DB_ID --collection classified.json --stack stack-5 --input selected.json --batch ID --limit N',
      'apply requires exactly one of --dry-run/--live; prepare is always dry-run. --resume retains the same targets and DB student.',
      '--market en|ru selects restriction scope (default en). --no-ai leaves unresolved text rules for review.',
      '--offline permits fixture catalogs; match/prepare also require --restrictions rules.json. Offline cannot submit live.',
      'collect/discover/prepare/apply: --browser-driver playwright|patchright (default playwright).',
      'Live handoffs stay open: type resume or exit.'].join('\n'))
    return
  }
  const shared = ['sources', 'scope', 'collect', 'classify', 'report-collection'].includes(command)
  const id = safeId(arg('candidate') ?? (shared ? 'collection' : '')), root = resolve(arg('storage', 'storage/external-responses')!), logs = resolve(arg('logs', 'logs/external-responses')!)
  const usageDirectory = join(logs, 'ai-usage', randomUUID())
  const usage = createAiUsageRecorder(line => {
    mkdirSync(usageDirectory, { recursive: true })
    appendFileSync(join(usageDirectory, 'requests.jsonl'), line + '\n', { mode: 0o600 })
  })
  const measuredAi = () => createAiClient(process.env, { usage })
  const localStore = createFileStore(root, logs)
  const db = flag('offline') || command === 'intake' || command === 'sources' && arg('input') ? undefined : createRuntimeDatabase()
  let collectionCheckpoint: Awaited<ReturnType<typeof openCollectionCheckpoint>> | undefined
  let releaseCrawl: (() => Promise<void>) | undefined
  const store = db && ['apply', 'match', 'report'].includes(command) ? createPostgresStore(localStore, db, arg('student')) : localStore
  try {
  // Reuse the existing exclusive lock: separate collection CLIs cannot each start three workers.
  // Fixed workspace path also covers invocations with a custom --storage directory.
  if (command === 'collect' || command === 'discover') releaseCrawl = await createFileStore(resolve('storage/external-responses'), logs).lock('shared-vacancy-collection')
  const readInput = async () => arg('input') ? JSON.parse(await readFile(resolve(arg('input')!), 'utf8')) : {}
  let input = await readInput()
  if (db && arg('collection-run') && ['classify', 'report-collection'].includes(command)) {
    const saved = await loadCollection(arg('collection-run')!, db.read)
    input = command === 'classify' ? saved.collection : saved.classification
    if (!input) throw Error('saved_classification_required')
  }
  if (command === 'sources' && !arg('input')) {
    const catalog = await loadDatabaseSources(createDatabaseRead())
    const path = resolve(arg('out', join(logs, 'database-sources.json'))!)
    await atomicJson(path, catalog)
    console.log(JSON.stringify({ sources: catalog.sources.length, companies: catalog.companyIds.length, deferred: catalog.deferred.length, issues: catalog.issues.length, path })); return
  }
  if (command === 'sources') {
    if (!arg('input') || !arg('layout') || !arg('out')) throw Error('source_input_layout_and_output_required')
    const layout = JSON.parse(await readFile(resolve(arg('layout')!), 'utf8'))
    const catalog = processCompanySources(input, layout), report = reportCompanySources(catalog), directory = resolve(arg('out')!)
    await mkdir(directory, { recursive: true })
    await atomicJson(join(directory, 'catalog.json'), catalog)
    await atomicJson(join(directory, 'companies.json'), catalog.companyManifest)
    await atomicJson(join(directory, 'review.json'), catalog.entries.filter(e => e.status === 'review'))
    await atomicJson(join(directory, 'deferred.json'), catalog.entries.filter(e => e.status === 'deferred'))
    await atomicJson(join(directory, 'blocked.json'), catalog.entries.filter(e => e.status === 'blocked'))
    await writeFile(join(directory, 'report.md'), report.markdown)
    await writeFile(join(directory, 'sources.csv'), report.csv)
    console.log(JSON.stringify({ ...catalog.summary, report: join(directory, 'report.md') })); return
  }
  const output = async (value: unknown, path?: string) => { if (path) await atomicJson(resolve(path), value); else console.log(JSON.stringify(value, null, 2)) }
  const csvIds = (name: string) => arg(name)?.split(',').map(id => id.trim()).filter(Boolean)
  const readScope = () => loadCampaignScope({ stackIds: csvIds('db-stacks'), studentIds: csvIds('students') }, { read: createDatabaseRead() })
  if (flag('offline') && flag('live')) throw Error('offline_mode_cannot_submit')
  if (command === 'scope') {
    const scope = await readScope(); await output(scope, arg('out'))
    console.log(`Scope: ${scope.stacks.length} stacks with students; ${scope.excluded.length} without students; ${scope.issues.length} configuration issues`); return
  }
  if (command === 'classify') {
    const selectionRules = await loadSelectionRules(arg('selection-rules'))
    if (flag('refresh-saved')) {
      if (!db || !arg('collection-run') || !arg('run') || !arg('db-stacks')) throw Error('refresh_requires_saved_run_new_run_and_current_stacks')
      if (arg('assessments') || arg('inference-policy') || arg('recover-session-results')) throw Error('refresh_saved_uses_cached_decisions_only')
      const saved = await loadCollection(arg('collection-run')!, db.read), runId = safeId(arg('run')!)
      if (!saved.classification) throw Error('saved_classification_required')
      let exists = false
      try { await loadCollection(runId, db.read); exists = true } catch (error: any) { if (error.code !== 'collection_run_not_found') throw error }
      if (exists) throw Error('refresh_new_unused_run_required')
      const current = await readScope(); assertCampaignScope(current)
      const publicationEvidence = await loadLatestPublicationEvidence(saved.classification.collection.positions, db.read)
      const result = await refreshSavedClassification({ saved: saved.classification, rules: selectionRules, stacks: current.stacks, runId, publicationEvidence })
      await saveCollection(result.classified.collection, db.write)
      await saveClassification(result.classified, db.write)
      const path = resolve(arg('out', join(logs, 'scans', runId, 'classified.json'))!)
      await output(result.classified, path)
      await writeFile(path + '.report.md', generateCollectionReport(result.classified).markdown)
      console.log(JSON.stringify({ ...result.summary, runId, path })); return
    }
    if(arg('recover-session-results')) {
      if(!db||!arg('collection-run')||!arg('run')||!arg('classification-session-policy')||!arg('db-stacks'))throw Error('revalidation_requires_saved_run_new_run_policy_and_current_stacks')
      const saved=await loadCollection(arg('collection-run')!,db.read)
      if(!saved.classification)throw Error('saved_classification_required')
      const policy=JSON.parse(await readFile(arg('classification-session-policy')!,'utf8'))
      const current=await readScope();assertCampaignScope(current)
      let revalidationAt:string|undefined
      try{revalidationAt=(await loadCollection(safeId(arg('run')!),db.read)).classification?.assessmentProvenance?.reviewedAt}catch(error:any){if(error.code!=='collection_run_not_found')throw error}
      const result=await withSessionClassificationLock(resolve(arg('recover-session-results')!),saved.collection.runId,store=>revalidateSession({saved:saved.classification!,rules:selectionRules,stacks:current.stacks,policy,runId:safeId(arg('run')!),store,revalidationAt}))
      await saveCollection(result.classified.collection,db.write)
      await saveClassification(result.classified,db.write)
      const collection=result.classified.collection,memories=await loadSourceMemory(collection.sources,db.read)
      await saveSourceMemory({runId:collection.runId,audits:collection.audit,memories,decisions:result.updates,positionSources:new Map(collection.positions.map(p=>[p.id,(p.sources??[p.source]).map(s=>s.database!.sourceId)])),decisionsOnly:true},db.write)
      const path=resolve(arg('out',join(logs,'scans',safeId(arg('run')!),'classified.json'))!)
      await output(result.classified,path)
      await atomicJson(path+'.recovery.json',result.recovery)
      await writeFile(path+'.report.md',generateCollectionReport(result.classified).markdown)
      console.log(JSON.stringify({...result.recovery,runId:result.classified.collection.runId,accepted:Object.values(result.classified.groups).flatMap(g=>g.matchedIds).filter((id,i,all)=>all.indexOf(id)===i).length,path}));return
    }
    const exchangeRates = arg('exchange-rates') ? JSON.parse(await readFile(arg('exchange-rates')!, 'utf8')) : undefined
    const stacks = arg('stacks') === 'java' ? [javaStack] : arg('stacks') ? JSON.parse(await readFile(arg('stacks')!, 'utf8')) : undefined
    const raw = input.collection ?? input
    const reviewed = arg('assessments') ? createReviewedAssessors(JSON.parse(await readFile(arg('assessments')!, 'utf8')), raw, selectionRules, new Date(), exchangeRates) : undefined
    const inference=configureCombinedAssessment({requested:!flag('no-ai')&&!!arg('inference-policy'),policy:arg('inference-policy')?JSON.parse(await readFile(arg('inference-policy')!,'utf8')):undefined,env:process.env,usage})
    const result = reviewed ? await classifyVacancies({collection:raw,stacks,selectionRules,assessmentProvenance:reviewed.provenance,exchangeRates},reviewed)
      : raw.scope ? (await classifyWithReuse({collection:raw,rules:selectionRules,cache:{},policy:inference.policyKey,exchangeRates},{assess:inference.assess})).classified
      : await classifyVacancies({collection:raw,stacks,selectionRules,exchangeRates})
    if (db) await saveClassification(result, db.write)
    await output(result, arg('out')); console.log(`Classification: ready=${result.readyForApplications}; configuration issues=${result.configurationIssues.length}`); return
  }
  if (command === 'report-collection') {
    const report = generateCollectionReport(input), directory = resolve(arg('out', join(logs, 'collections', safeId(input.collection.runId), 'report'))!)
    await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'report.md'), report.markdown); await writeFile(join(directory, 'companies.csv'), report.csv)
    await atomicJson(join(directory, 'source-audit.json'), report.rows)
    await atomicJson(join(directory, 'accepted-vacancies.json'), report.vacancies)
    await writeFile(join(directory, 'accepted-vacancies.csv'), report.vacancyCsv)
    await atomicJson(join(directory, 'selection-decisions.json'), { selectionRules: input.selectionRules ?? null, globalDecisions: input.globalDecisions ?? {}, stackDecisions: input.decisions })
    console.log(`Report: ${join(directory, 'report.md')}`); return
  }
  if (command === 'intake') {
    const extractor = flag('no-ai') ? { extract: async () => ({}) } : existingCvExtractor(measuredAi())
    const candidate = await intakeCandidate({ id, source: fileCvSource(input.cvPath), confirmed: input.confirmed, criteria: input.criteria, history: input.history, stackIds: input.stackIds, databaseClientId: input.databaseClientId }, { store, storageRoot: root, extractor })
    if (flag('no-ai')) console.log('CV preserved; AI extraction skipped. Only explicitly confirmed input facts were recorded.')
    await output({ id: candidate.id, cvHash: candidate.cv.sha256, factKeys: Object.keys(candidate.facts) }, arg('out')); return
  }
  if (command === 'report') {
    const discovery = arg('discovery') ? JSON.parse(await readFile(arg('discovery')!, 'utf8')) as DiscoveryResult : undefined
    const report = await generateReport({ candidateId: id, batchId: arg('batch'), discovery }, { store })
    const directory = resolve(arg('out', join(logs, id, 'reports', arg('batch', 'all')!))!); await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'report.md'), report.markdown); await writeFile(join(directory, 'applications.csv'), report.csv)
    await atomicJson(join(directory, 'results.json'), report.results); await atomicJson(join(directory, 'failures.json'), report.failures); await atomicJson(join(directory, 'robot-failures.json'), report.robotFailures)
    await atomicJson(join(directory, 'summary.json'), report.summary)
    if (discovery) await atomicJson(join(directory, 'source-audit.json'), discovery.audit)
    console.log(`Report: ${join(directory, 'report.md')}`); return
  }
  const candidate = command === 'collect' ? undefined : await store.candidate(id)
  if (candidate && arg('student')) candidate.databaseClientId = arg('student')
  const collection: ClassifiedCollection | undefined = db && arg('collection-run') ? (await loadCollection(arg('collection-run')!, db.read)).classification ?? undefined : arg('collection') ? JSON.parse(await readFile(arg('collection')!, 'utf8')) : input.collection
  const stackId = arg('stack') ?? input.stackId ?? ''
  const restrictions = async (): Promise<RestrictionPolicy> => {
    const evaluate = flag('no-ai') ? undefined : async (...args: Parameters<NonNullable<RestrictionPolicy['evaluate']>>) => createRestrictionEvaluator(measuredAi())(...args)
    if (flag('offline')) {
      if (!arg('restrictions')) throw Error('offline_restriction_snapshot_required')
      const snapshot = JSON.parse(await readFile(arg('restrictions')!, 'utf8'))
      return { load: async () => snapshot, evaluate }
    }
    if (arg('restrictions')) throw Error('restriction_files_require_offline_mode')
    const stack = collection?.collection.scope?.stacks.find(s => s.id === stackId)
    if (!stack) throw Error('database_campaign_scope_required')
    const market = arg('market', 'en')
    if (market !== 'en' && market !== 'ru') throw Error('invalid_restriction_market')
    return createPostgresRestrictionPolicy({ read: createDatabaseRead(), evaluate, market, expectedStack: stack })
  }
  if (command === 'match') {
    assertCurrentSelectionRules(collection?.selectionRules, await loadSelectionRules(arg('selection-rules')))
    const result = await matchCandidatePositions({ candidate: candidate!, collection: collection!, stackId }, { restrictions: await restrictions() })
    await output(result, arg('out')); return
  }
  const live = flag('live')
  if (command === 'apply') {
    if (requestedCommand === 'prepare' && live) throw Error('prepare cannot submit applications')
    if (requestedCommand !== 'prepare' && live === flag('dry-run')) throw Error('Select exactly one of --live or --dry-run')
    validateApplicationSelection({ candidate: candidate!, collection: collection!, stackId, positions: input.positions ?? [], batchId: arg('batch') ?? '', limit: Number(arg('limit')), mode: live ? 'live' : 'dry-run' })
    assertCurrentSelectionRules(collection?.selectionRules, await loadSelectionRules(arg('selection-rules')))
  }
  const runId = safeId(command === 'apply' ? arg('batch') ?? '' : arg('run', `discovery-${Date.now()}`)!)
  let scope: CampaignScope | undefined
  const databaseSources = command === 'collect' && db ? await loadDatabaseSources(createDatabaseRead()) : undefined
  const collectionSources = async () => databaseSources?.sources ?? await readSources({ entries: input.sources ?? [], path: input.sourcesPath })
  const persistCollection = async (result: import('./vacancy_collection/index.ts').VacancyCollection) => {
    if (databaseSources) { result.sourceIssues = databaseSources.issues; result.deferredSources = databaseSources.deferred }
    // Freeze the exact final result first: a lost SQL commit acknowledgement is replayable.
    await collectionCheckpoint?.complete(result)
    if (db) await saveCollection(result, db.write)
    await output(result, arg('out'))
  }
  if (command === 'collect' && !flag('offline')) {
    scope = arg('scope') ? JSON.parse(await readFile(arg('scope')!, 'utf8')) : await readScope()
    assertCampaignScope(scope!)
    if (!scope!.stacks.length) {
      const sources = await collectionSources()
      const result = await collectVacancies({ runId, sources, scope }, { strategy: { name: 'empty', discover: async () => { throw Error('empty_scope_cannot_crawl') } } })
      await persistCollection(result); console.log('Empty campaign: no stacks with students.'); return
    }
  }
  const sources = command === 'collect' || command === 'discover' ? await collectionSources() : []
  const strategyName = arg('strategy', 'websites')!
  if (command === 'collect') {
    collectionCheckpoint = await openCollectionCheckpoint({ directory: join(root, 'collections', runId), resume: flag('resume'), identity: {
      runId, sources, scope, strategy: strategyName, driver: parseBrowserDriver(arg('browser-driver')), maxPages: input.maxPages ?? 16,
      excludedHosts: input.excludedHosts ?? [], boards: input.boards ?? [], skillPath: input.skillPath ?? '.agents/skills/job-hunting',
      pasted: input.positions ?? [], sourceIssues: databaseSources?.issues ?? [], deferredSources: databaseSources?.deferred ?? [], contractVersion: 1,
    } })
    if (collectionCheckpoint.completed) { await persistCollection(collectionCheckpoint.completed); console.log('Collection replayed from its completed checkpoint.'); return }
  }
  const applicationRestrictions = command === 'apply' ? await restrictions() : undefined
  const context = await createBrowserSession({ profilePath: join(root, 'candidates', id, 'browser'), headless: flag('headless'), driver: parseBrowserDriver(arg('browser-driver')), onSession: info => diagnostic(store, { at: new Date().toISOString(), action: 'browser_session_started', runId, candidateId: id, data: { ...info } }) })
  try {
    if (command === 'discover' || command === 'collect') {
      const publicReader = createPageReader({ context, excludedHosts: input.excludedHosts })
      const reader = collectionCheckpoint?.reader(publicReader) ?? publicReader
      const titlePrecheck = scope ? (await import('./vacancy_collection/title-precheck.ts')).createTitlePrecheck(await loadSelectionRules(arg('selection-rules')),scope) : undefined
      const strategy = strategyName === 'job-hunting' ? createSkillStrategy({ skillPath: input.skillPath ?? '.agents/skills/job-hunting', python: input.python, boards: input.boards ?? [], reader, titlePrecheck }) : strategyName === 'dialog' ? createDialogStrategy(reader, input.positions, titlePrecheck) : createWebsiteStrategy({
        reader, titlePrecheck, maxPages: input.maxPages, reviews: createSourceReviewStore(join(root, 'source-reviews')), onSource: async (a, positions) => {
          await atomicJson(join(logs, id, 'discovery', runId, 'sources', `${a.source.workbook?.row ?? 'source'}-${positionId(a.source.url)}.json`), { audit: a, positions })
          await diagnostic(store, { at: new Date().toISOString(), action: 'source_completed', runId, candidateId: id, data: { source: a.source, status: a.status, found: a.found, issues: a.issues } })
          console.log(`${a.source.name}: ${a.status}; ${a.found} postings; ${a.pages.length} pages`)
        }
      })
      if (command === 'collect') {
        const result = await collectVacancies({ runId, sources, scope }, { strategy }); await persistCollection(result)
        console.log(`Collection: ${result.audit.length} sources, ${result.positions.length} postings. Classify before applying.`); return
      }
      const result = await discoverPositions({ candidate: candidate!, runId, sources }, { strategy, store, assess: flag('no-ai') ? undefined : aiFitAssessor(measuredAi()) })
      await output(result, arg('out')); console.log(`Discovery: ${result.audit.length} sources, ${result.positions.length} postings, ${result.positions.filter(p => p.fit?.decision === 'eligible').length} eligible`); return
    }
    if (command !== 'apply') throw Error(`Unknown command: ${command}`)
    const batchId = safeId(arg('batch') ?? ''), limit = Number(arg('limit'))
    const adapters = createAtsAdapters({ context, evidenceRoot: join(logs, id, 'evidence', batchId) })
    const answers = createAnswerGenerator(flag('no-ai') ? undefined : measuredAi())
    const run = async (resume: boolean) => {
      const current = await readInput(), fresh = await store.candidate(id)
      if (arg('student')) fresh.databaseClientId = arg('student')
      for (const [key, value] of Object.entries(current.confirmed ?? {})) fresh.facts[key] = { value: String(value), source: 'confirmed', evidence: 'Explicit candidate answer in application input' }
      const positions: Position[] = current.positions ?? []
      const prepared = withPreparedAnswers(answers, current.preparedAnswers)
      const result = await applyToPositions({ candidate: fresh, collection: collection!, stackId, batchId, positions, limit, mode: live ? 'live' : 'dry-run', resume, manualSubmit: flag('manual-submit'), reviewOverride: arg('review-override'), employerAiExceptions: current.employerAiExceptions }, { store, adapters, answers: prepared, restrictions: applicationRestrictions!, verification: { queue: async record => console.log(`Handoff: ${record.position.company}: ${record.reason ?? record.status}; ${record.detail}`) } })
      console.log(JSON.stringify(result.records.map(r => ({ id: r.position.id, company: r.position.company, status: r.status, reason: r.reason, detail: r.detail, evidence: r.evidence })), null, 2))
      await output(result, arg('out')); return result
    }
    const result = await run(flag('resume'))
    if (flag('live') && !flag('close') && result.records.some(r => ['blocked', 'failed', 'unknown', 'submitting'].includes(r.status))) {
      console.log('Browser handoff remains open. Complete verification in its tab, then type resume. Type exit to save and close.')
      const reader = createInterface({ input: process.stdin, output: process.stdout })
      for await (const line of reader) {
        if (line.trim() === 'exit') { reader.close(); break }
        if (line.trim() === 'resume') { try { await run(true) } catch (e: any) { console.error(e.message) } }
      }
      console.log('Input closed; saving checkpoints and closing browser. Use an interactive terminal to keep handoff tabs open.')
    }
  } catch (error: any) {
    await diagnostic(store, { at: new Date().toISOString(), action: `${command}_failed`, runId, candidateId: id, data: { error: error.message ?? String(error) } })
    throw error
  } finally { await context.close() }
  } finally {
    try { try { try { await collectionCheckpoint?.close() } finally { await releaseCrawl?.() } } finally { await db?.close() } } finally {
      const report = usage.report()
      if (report.httpAttempts) try {
        const context = { command: requestedCommand, candidateId: id, runId: arg('run') ?? arg('collection-run') ?? null, batchId: arg('batch') ?? null }
        await atomicJson(join(usageDirectory, 'summary.json'), { ...report, context })
        const header = 'model,operation,logical_calls,http_attempts,retries,known_input_tokens,known_output_tokens,known_cached_input_tokens,unknown_usage_attempts,repeated_inputs'
        const rows = report.byOperation.map(r => [r.model, r.operation, r.logicalCalls, r.httpAttempts, r.retryAttempts, r.knownInputTokens, r.knownOutputTokens, r.knownCachedInputTokens, r.unknownUsageAttempts, r.repeatedLogicalInputs].join(','))
        await writeFile(join(usageDirectory, 'operations.csv'), [header, ...rows].join('\n') + '\n', { mode: 0o600 })
        await writeFile(join(usageDirectory, 'summary.md'), ['# AI usage', '',
          `Logical calls: ${report.logicalCalls}; HTTP attempts: ${report.httpAttempts}; retries: ${report.retryAttempts}.`,
          `Known input tokens: ${report.knownInputTokens}; known output tokens: ${report.knownOutputTokens}; attempts with unknown usage: ${report.unknownUsageAttempts}.`,
          `Repeated logical inputs: ${report.repeatedLogicalInputs}; diagnostic failures: ${report.diagnosticFailures}.`, '',
          '| Operation | Known input | Known output | HTTP attempts | Unknown usage |', '|---|---:|---:|---:|---:|',
          ...report.byOperation.map(r => `| ${r.operation} | ${r.knownInputTokens} | ${r.knownOutputTokens} | ${r.httpAttempts} | ${r.unknownUsageAttempts} |`), '',
          ...report.notes.map(note => '- ' + note), '', 'Cost and external tailoring token usage are unknown.'].join('\n') + '\n', { mode: 0o600 })
        console.error(`external-responses: AI usage report: ${usageDirectory}`)
      } catch { console.error('external-responses: AI usage report unavailable; application state is unchanged.') }
    }
  }
}
main().catch(error => { console.error(`external-responses: ${error.message}`); process.exitCode = 1 })
