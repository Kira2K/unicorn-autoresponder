import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPostAdapter, type PostHttp } from '../../../../integrations/unipile/post-writer-adapter.ts'
import { createUnipileRequestScheduler } from '../../../../integrations/unipile/request-scheduler.ts'
import { reactionPresent, reactionsPresent } from '../../../../integrations/unipile/post-writer-reactions.ts'
import { fullRetryAfter, createPostOpenAi } from '../openai-client.ts'
import { mockContext } from '../mock-content.ts'
import { fixture } from './helpers.ts'
import { acquirePostWriterLease } from '../writer-lease.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('a shrinking reaction total cannot prove absence or permit another like', async () => {
  const account = (await fixture().deps.source.accounts())[0]; let reads = 0
  await assert.rejects(reactionPresent(account, 'post', async () => ++reads === 1
    ? { data: [{ sender: { id: 'a' } }], total_count: 3 }
    : { data: [{ sender: { id: 'b' } }], total_count: 2 }))
  assert.equal(reads, 2)
  await assert.rejects(reactionPresent(account, 'post', async () => ({ data: [{ sender: { id: '' } }], total_count: 1 })))
})

test('reactions honor a provider cursor and never accept an empty page with more data as absence', async () => {
  const account = (await fixture().deps.source.accounts())[0], paths: string[] = []
  assert.equal(await reactionPresent(account, 'post', async (_method, path) => {
    paths.push(path)
    return paths.length === 1 ? { data: [{ sender: { id: 'other' } }], next_cursor: 'page-2' }
      : { data: [{ sender: { id: account.verifiedProviderId } }] }
  }), true)
  const query = new URL(paths[1], 'https://mock.invalid').searchParams
  assert.equal(query.get('cursor'), 'page-2'); assert.equal(query.has('offset'), false)
  await assert.rejects(reactionPresent(account, 'post', async () => ({ data: [], next_cursor: 'more' })))
})

test('post reconciliation rejects malformed cursors without issuing a malformed follow-up', async () => {
  const account = (await fixture().deps.source.accounts())[0]
  for (const next_cursor of [123, {}, 'private-cursor']) {
    let reads = 0
    const adapter = createPostAdapter(() => {}, { async request<T>() {
      reads++; return { data: [], next_cursor } as T
    } }, { run: action => action() })
    await assert.rejects(adapter.recent(account)); assert.equal(reads, 1)
  }
})
test('adapter imports no concrete HTTP client or scheduler factory', () => {
  const source = readFileSync(join(process.cwd(), 'src/integrations/unipile/post-writer-adapter.ts'), 'utf8')
  assert.doesNotMatch(source, /createUnipileHttpClient|createUnipileRequestScheduler|process\.env/)
})
test('V2 post body, no post_as, actual Post response; reaction uses linkedin_like', async () => {
  const calls: { method: string; path: string; body: unknown }[] = []
  const http: PostHttp = { async request<T>(method: string, path: string, body: unknown) {
    calls.push({ method, path, body })
    return (path.endsWith('reactions') ? { object: 'PostReactionAdded' } : { id: 'post_1', text: 'text',
      author: { id: 'author' }, share_url: 'https://www.linkedin.com/feed/update/1/',
      created_at: new Date().toISOString() }) as T
  } }
  const adapter = createPostAdapter(() => undefined, http,
    createUnipileRequestScheduler({ minIntervalMs: 0 }))
  const f = fixture()
  const account = (await f.deps.source.accounts())[0]
  await adapter.publish(account, 'text')
  await adapter.like(account, 'post_1')
  assert.deepEqual(calls[0].body, { text: 'text', can_read: 'anyone', can_comment: 'anyone' })
  assert.deepEqual(calls[1].body, { reaction: 'linkedin_like' })
  assert.ok(calls[0].path.endsWith('/posts'))
})
test('reactions paginate using offset, short page is not assumed final', async () => {
  const f = fixture(), account = (await f.deps.source.accounts())[0]
  const paths: string[] = []
  const found = await reactionPresent(account, 'post_1', async (_method, path) => {
    paths.push(path)
    return { data: [{ sender: { id: paths.length === 1 ? 'other' : account.verifiedProviderId } }] }
  })
  assert.equal(found, true)
  assert.ok(paths[1].includes('offset=1'))
  await assert.rejects(reactionPresent(account, 'post_1', async () => ({ data: [], total_count: 10 })))
  await assert.rejects(reactionPresent(account, 'post_1', async () => ({ wrong: [] })))
})

test('all selected actors share one scan; confirmation is fresh but identity permits provider cache', async () => {
  const account = (await fixture().deps.source.accounts())[0]; let reads = 0
  assert.deepEqual(await reactionsPresent(account, 'post', ['a', 'b'], async () => {
    reads++; return { data: [{ sender: { id: reads === 1 ? 'a' : 'b' } }] }
  }), ['a', 'b'])
  assert.equal(reads, 2)
  await assert.rejects(reactionsPresent(account, 'post', ['missing'], async () => ({ data: [], total_count: 4 })))
  const modes: boolean[] = []
  const http: PostHttp = { async request<T>(...[_method, path, _body, options]: Parameters<PostHttp['request']>) {
    modes.push(options!.noCache)
    return (path.startsWith('/accounts/') ? { provider: 'LINKEDIN', status: 'running' } :
      path.includes('/users/me') ? { id: account.verifiedProviderId } : { data: [], total_count: 0 }) as T
  } }
  const adapter = createPostAdapter(() => {}, http, { run: action => action() })
  await adapter.identity(account); await adapter.reactions!(account, 'post', ['a', 'b'])
  assert.deepEqual(modes, [false, false, true])
})
test('full Retry-After and OpenAI structured request with usage', async () => {
  assert.equal(fullRetryAfter('3600'), 3_600_000)
  const events: string[] = []
  const client = createPostOpenAi(event => { events.push(event) }, {
    OPENAI_LINKEDIN_POST_API_KEY: 'test', OPENAI_LINKEDIN_POST_MODEL: 'test-model'
  }, async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.equal(body.store, false)
    assert.equal(body.text.format.strict, true)
    assert.deepEqual(body.tools, [])
    return new Response(JSON.stringify({ status: 'completed', output: [
      { content: [{ type: 'output_text', text: '{"topics":[]}' }] }], usage: { input_tokens: 10 } }))
  })
  await client.topics(mockContext, [])
  assert.ok(events.includes('openai_usage'))
})
test('one local writer, explicit stable ID', async () => {
  await assert.rejects(acquirePostWriterLease(''))
  const release = await acquirePostWriterLease('test-writer', 4438)
  try { await assert.rejects(acquirePostWriterLease('other-writer', 4438), /already_running/) }
  finally { release() }
})
test('injected scheduler gates every request; failures propagate without retries', async () => {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  let scheduled = 0
  let requests = 0
  const failure = new Error('mock transport failure')
  const http: PostHttp = { async request(_method, _path, _body, options) {
    requests++
    assert.deepEqual(options, { fullRetryAfter: true, noCache: true })
    throw failure
  } }
  const adapter = createPostAdapter(() => {}, http, {
    async run(operation) { scheduled++; await wait; return operation() }
  })
  const account = (await fixture().deps.source.accounts())[0]
  const result = adapter.read(account, 'post_1')
  assert.equal(scheduled, 1)
  assert.equal(requests, 0)
  release()
  await assert.rejects(result, error => error === failure)
  assert.equal(requests, 1)
  assert.equal(scheduled, 1)
})
