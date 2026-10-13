import assert from 'node:assert/strict'
import { mkdtemp, open, readFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { createHomeFeedReader } from '../../../integrations/unipile/home-feed.mts'
import { createFeedActions } from '../../../integrations/unipile/feed-actions.mts'
import { createFeedRun, stepFeedRun, feedRunSummary } from './run.mts'
import type { FeedRun, FeedRunDependencies } from './run.mts'
const require = createRequire(import.meta.url)
const { createUnipileHttpClient } = require('../../../integrations/unipile/http-client.ts')
const { createAccountRequestQueue } = require('../../../integrations/unipile/request-scheduler.ts')
const { installRequestPolicy } = require('../../../integrations/unipile/request-control.ts')

// Entire transport and model are mocked. No live mode, ENV or credentials loading.
const folder = await mkdtemp(join(tmpdir(), 'unicorn-feed-demo-')), path = join(folder, 'session.json')
let now = 1_800_000_000_000, requests = 0, pages = 0, comments = 0
const liked = new Set<string>(), requestLog: { at: number; method: string; operation: string }[] = []
const text = (id: string) => `Professional post ${id}: a concrete observation about work.`
const queue = createAccountRequestQueue({ now: () => now, random: () => 0.5, sleep: async (ms: number) => { now += ms } })
const remove = installRequestPolicy({
  queue: (info: any, _context: any, prepare: () => Promise<void>, action: () => Promise<unknown>) => queue.run(info.account, action, { prepare }),
  before: async () => {}, failed: async () => {},
  dispatched: async (info: any) => { requestLog.push({ at: now, method: info.method, operation: info.operation }) }
})
const client = createUnipileHttpClient({ apiKey: 'mock-only', baseUrl: 'https://unipile.invalid/v2',
  fetchImpl: async (url: string, init: { method: string; body?: string }) => {
    assert.ok(url.startsWith('https://unipile.invalid/v2/acc_feed_demo/')); requests++
    const body = init.body ? JSON.parse(init.body) : undefined
    let response: unknown
    if (url.endsWith('/linkedin/')) {
      assert.equal(init.method, 'POST'); assert.equal(body.method, 'GET')
      const start = pages++ * 75
      assert.equal(body.query_params.variables, `(start:${start},count:75${start ? ',paginationToken:demo-next' : ''})`)
      response = { object: 'LinkedInRawResponse', data: { data: { feedDashMainFeedByMainFeed: {
        elements: Array.from({ length: 75 }, (_, i) => ({ entityUrn: `urn:li:activity:${start + i}`,
          commentary: { text: { text: text(String(start + i)) } } })),
        metadata: { paginationToken: 'demo-next' }, paging: { start }
      } } } }
    } else {
      const encoded = url.split('/posts/')[1].split('/')[0], id = decodeURIComponent(encoded).replace(/^(activity:|canonical-)/, '')
      if (url.includes('/comments?')) response = { data: comments ? [{ object: 'Comment', id: 'comment-1', text: 'Does this approach also handle the boundary case?',
        is_sender: true, created_at: new Date(now - 90_000).toISOString() }] : [], total_count: comments }
      else if (url.endsWith('/comments')) { comments++; response = { object: 'Comment', id: 'comment-1', text: body.text, is_sender: true } }
      else if (url.endsWith('/reactions')) { assert.ok(!liked.has(id), 'duplicate_like'); liked.add(id); response = { object: 'PostReactionAdded' } }
      else response = { object: 'Post', id: `canonical-${id}`, text: text(id), author: { id: 'other' },
        permissions: { can_react: true, can_post_comments: true }, user_reacted: liked.has(id) ? 'linkedin_like' : false }
    }
    return new Response(JSON.stringify(response), { status: 200 })
  }
})
async function save(state: FeedRun) {
  const file = await open(`${path}.tmp`, 'w', 0o600)
  try { await file.writeFile(JSON.stringify(state, null, 2), 'utf8'); await file.sync() }
  finally { await file.close() }
  await rename(`${path}.tmp`, path)
}
const deps: FeedRunDependencies = { now: () => now, random: () => 0.5, save, assertActive: async () => {},
  read: createHomeFeedReader(client), provider: createFeedActions({ client, accountId: 'acc_feed_demo', now: () => now }),
  model: {
    evaluate: async ({ posts }) => ({ assessments: posts.map(p => ({ id: p.id,
      category: Number(p.id.split(':').at(-1)) < 3 || Number(p.id.split(':').at(-1)) >= 75 ? 'professional' : 'advertisement', reason: 'Mock-классификация' })) }),
    comment: async ({ post }) => ({ text: 'Does this approach also handle the boundary case?', evidence: post.text.slice(0, 20) })
  }
}
try {
  await save(createFeedRun({ id: 'demo', accountId: 'acc_feed_demo', ownerId: 'owner', now, excluded: [] }))
  let state!: FeedRun
  for (let i = 0; i < 100; i++) {
    state = JSON.parse(await readFile(path, 'utf8'))
    if (['completed', 'stopped', 'needs_attention'].includes(state.phase)) break
    now = Math.max(now, state.nextAt ?? 0, state.phase === 'collecting' ? state.feed.nextAt ?? 0 : 0)
    state = await stepFeedRun(state, deps)
  }
  assert.equal(state.phase, 'completed'); assert.equal(state.feed.cards?.length, 150)
  assert.equal(pages, 2); assert.equal(liked.size, 5); assert.equal(comments, 1)
  assert.equal(requests, 19) // 2 feed + 5 resolve + 5 like + 5 like check + comment + comment check.
  assert.ok(requestLog.every((r, i) => !i || r.at - requestLog[i - 1].at >= 90_000))
  await stepFeedRun(state, deps); assert.equal(requests, 19)
  console.log(JSON.stringify({ ...feedRunSummary(state), requests, result: state.reason, stateFile: path }, null, 2))
} finally { remove() }
