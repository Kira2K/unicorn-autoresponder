import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPostSource } from '../source.ts'
import { createFactsExtractor } from '../extract-facts.ts'
import { mockContext } from '../mock-content.ts'
import type { SourceDependencies } from '../source-types.ts'
import { selectFinalEnglishCv } from '../../profile-filler/generation/cv-source.ts'
import { writePost } from '../writer.ts'
import { validateDraft } from '../content-validation.ts'
import { fixture } from './helpers.ts'
import { createFeatureAdapters } from '../../orchestrator/adapters.ts'
import { createPostOpenAi } from '../openai-client.ts'

const safeText = `Where should a Python service decide whether a retry is safe?

A timeout does not reveal whether the remote operation finished. The response may have been lost after the change was saved. Repeating a read usually has a different risk from repeating a payment or sending an invitation.

The useful boundary is the business operation. A transport helper can report a failure, but it cannot decide whether the application is allowed to repeat an action with an external effect.

Keep the operation identifier and check the recorded outcome before retrying. If the result is still unknown, preserve that uncertainty and arrange a later check. Avoid treating an absent response as evidence that nothing happened.

This makes error handling easier to review in Python code: the caller owns the decision, while the client describes the failure. A retry policy becomes a visible rule instead of an assumption hidden in a helper.

Where does the retry decision belong in the application being reviewed?

#Python #Backend #Reliability #SoftwareEngineering`
function stackSource() {
  const deps: SourceDependencies = {
    accounts: async () => [{ platformAccountId: 203, clientId: 42, clientName: 'Test',
      primaryStack: 'PYTHON', unipileAccountId: 'test', verifiedProviderId: 'owner',
      unipileAccountStatus: 'running' } as any],
    cvRows: async () => [], selectCv: selectFinalEnglishCv,
    loadCv: async () => { throw Error('Missing CV must not be downloaded') },
    extractFacts: async () => { throw Error('Missing CV must not call the model') }
  }
  return { deps, source: createPostSource(deps) }
}
function stackModel() {
  return {
    topics: async () => ({ topics: ['retry ownership', 'error boundaries', 'idempotency'].map((title, i) =>
      ({ title, signature: title, factIds: [], score: 90 - i })) }),
    draft: async () => ({ text: safeText, factIds: [], claims: [] }),
    review: async () => ({ allowed: true, onTopic: true, uncertain: false })
  }
}

test('missing final CV uses the configured stack with a warning, without invented CV facts', async () => {
  const { deps, source } = stackSource()
  const context = await source.context(203) as any
  assert.equal(context.source, 'stack'); assert.deepEqual(context.stack, ['PYTHON'])
  assert.deepEqual(context.facts, []); assert.equal(context.warning.code, 'post_cv_missing_stack')
  assert.match(context.warning.message, /CV.*стек/u)
  assert.deepEqual(await source.context(203, mockContext), context, 'An old CV context is not reused when CV is missing.')
  deps.accounts = async () => [{ platformAccountId: 203, clientId: 42, clientName: 'Test' }]
  await assert.rejects(source.context(203), { code: 'post_stack_missing' })
  deps.cvRows = async () => { throw Object.assign(Error('SQL unavailable'), { code: 'sql_unavailable' }) }
  await assert.rejects(source.context(203), { code: 'sql_unavailable' })
  deps.cvRows = async () => []; deps.selectCv = () => ({ url: 'mock://cv', revision: '1' })
  deps.loadCv = async () => { throw Object.assign(Error('download failed'), { code: 'profile_cv_download_failed' }) }
  await assert.rejects(source.context(203), { code: 'profile_cv_download_failed' })
  deps.loadCv = async () => ({ bytes: Buffer.from('ready CV'), revision: '2' })
  deps.extractFacts = async () => structuredClone(mockContext)
  const restoredCv = await source.context(203, context)
  assert.equal(restoredCv.warning, undefined); assert.ok(restoredCv.facts.length)
})

test('model receives stack-mode writing and review restrictions without real OpenAI calls', async () => {
  const context = await stackSource().source.context(203), requests: any[] = []
  const model = createPostOpenAi(() => {}, { OPENAI_LINKEDIN_POST_API_KEY: 'mock', OPENAI_LINKEDIN_POST_MODEL: 'mock' },
    (async (_url: any, init: any) => {
      requests.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{}' }] }] }))
    }) as typeof fetch)
  const topic = { title: 'Python retries', signature: 'retry ownership', factIds: [], score: 90 }
  await model.topics(context, []); await model.draft(context, topic)
  await model.review!(context, { topic, text: safeText, rules: {} })
  for (const request of requests) {
    assert.equal(JSON.parse(request.input[0].content[0].text).context.source, 'stack')
    assert.match(request.instructions, /context.source/); assert.match(request.instructions, /personal/)
  }
  assert.match(requests[0].instructions, /factIds=\[\]/)
  assert.match(requests[2].instructions, /allowed=false.*invented personal/)
})

test('stack-only Writer requires neutral content and a successful semantic review', async () => {
  const context = await stackSource().source.context(203), model = stackModel()
  assert.deepEqual(validateDraft(await model.draft(), context, []), [])
  assert.equal((await writePost({ context, history: [] }, model)).status, 'ready')
  assert.ok(validateDraft({ text: safeText.replace('A timeout', 'My team knows a timeout'), factIds: [], claims: [] }, context, [])
    .includes('post_stack_personal_claim'))
  assert.ok(validateDraft({ text: safeText.replace('A timeout', 'A 90% timeout'), factIds: [], claims: [] }, context, [])
    .includes('unsupported_number'))
  assert.ok(validateDraft({ text: safeText, factIds: ['fake-cv'], claims: [] }, context, [])
    .includes('unknown_or_duplicate_fact'))
  assert.equal((await writePost({ context, history: [] }, { ...model, review: undefined })).status, 'blocked')
  assert.equal((await writePost({ context, history: [] }, { ...model,
    review: async () => ({ allowed: true, onTopic: true, uncertain: true }) })).status, 'blocked')
})

test('scheduled missing-CV post reaches publication after restart and reports its warning to the journal', async () => {
  const f = fixture(); Object.assign(f.deps.source, stackSource().source)
  Object.assign(f.deps.generator, stackModel())
  const stages: Array<{ code: string; message: string }> = []
  const adapters = createFeatureAdapters({ posts: f.service } as any)
  const ctx: any = { task: { id: 'stack-task', account: { id: 203 }, day: '2026-09-07',
    postPolicy: { contentMode: 'prepared', generateIfMissing: true } }, signal: new AbortController().signal,
    now: f.deps.now, cooperate: (action: any) => action(), assertWrite: async () => {},
    bind: async (id: string) => { ctx.task.runId = id },
    stage: async (code: string, message: string) => { stages.push({ code, message }) } }
  const first = await adapters.posts.step(ctx); ctx.task.reason = first.reason
  assert.equal(first.status, 'ready'); assert.equal(f.counts.publish, 0)
  assert.equal(stages.filter(s => s.code === 'post_cv_missing_stack').length, 1)
  assert.match(stages.find(s => s.code === 'post_cv_missing_stack')!.message, /CV.*стек/u)
  f.restart()
  const resumed = createFeatureAdapters({ posts: f.service } as any)
  await resumed.posts.step(ctx); f.setNow(f.deps.now() + 6000); await resumed.posts.step(ctx)
  assert.equal((await f.run()).status, 'published'); assert.equal(f.counts.publish, 1)
  assert.equal((await f.run()).context?.facts.length, 0)
  assert.equal(stages.filter(s => s.code === 'post_cv_missing_stack').length, 1)
  await f.service.close()
})

test('injected source caches facts by reference, revision and bytes without catalog requests', async () => {
  let extractions = 0
  let loads = 0
  let bytes = 'first CV'
  const deps: SourceDependencies = {
    accounts: async () => [{ platformAccountId: 203, clientId: 42, clientName: 'Test',
      unipileAccountId: 'test', verifiedProviderId: 'owner', unipileAccountStatus: 'running' }],
    cvRows: async () => [],
    selectCv: (_rows, clientId) => {
      assert.equal(clientId, 42)
      return { url: 'mock://cv', revision: '1' }
    },
    loadCv: async (url, limit) => {
      loads++
      assert.equal(url, 'mock://cv')
      assert.equal(limit, 20 * 1024 * 1024)
      return { bytes: Buffer.from(bytes), revision: '1' }
    },
    extractFacts: async () => { extractions++; return structuredClone(mockContext) }
  }
  const source = createPostSource(deps)
  assert.equal((await source.accounts()).length, 1)
  const first = await source.context(203)
  assert.deepEqual(await source.context(203, first), first)
  assert.equal(extractions, 1)
  bytes = 'changed in place'
  assert.notEqual((await source.context(203, first)).revision, first.revision)
  assert.equal(extractions, 2)
  assert.equal(loads, 3)
  await assert.rejects(source.context(999), { code: 'post_account_missing' })
  const current = await source.context(203)
  const { factsVersion: _version, ...legacy } = current
  const beforeRefresh = extractions
  const refreshed = await source.context(203, legacy)
  await source.context(203, refreshed)
  assert.equal(extractions, beforeRefresh + 1)
})
test('fact extraction preserves the request and validates the model output', async () => {
  let calls = 0
  const extract = createFactsExtractor(async (input, schema, instructions) => {
    calls++
    assert.match(JSON.stringify(input), /input_file/)
    assert.match(JSON.stringify(schema), /evidence/)
    assert.match(instructions, /never invent/)
    return { ...mockContext, facts: mockContext.facts.map(fact => ({ ...fact, id: 'ignored' })) }
  })
  const result = await extract({ bytes: Buffer.from('mock CV'), revision: '1' })
  assert.equal(result.facts[0].id, 'fact_1')
  assert.equal(calls, 1)
  await assert.rejects(createFactsExtractor(async () => ({ facts: [] }))(
    { bytes: Buffer.from('mock'), revision: '1' }), { code: 'post_facts_missing' })
})
