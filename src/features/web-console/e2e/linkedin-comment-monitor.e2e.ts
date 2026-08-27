const assert = require('node:assert/strict')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { chromium } = require('playwright')
const { pollMonitorJob } = require('../../linkedin-automation/comment-monitor/poll-job.ts') as
  typeof import('../../linkedin-automation/comment-monitor/poll-job.ts')

const ROOT = path.resolve(__dirname, '../../../..')
const API_PORT = 4330
const UI_PORT = 4331
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function start(args: string[], env: Record<string, string>) {
  return spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'] })
}

async function waitForHttp(url: string) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).status < 500) return } catch {}
    await wait(250)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function stop(child: any) {
  if (child.exitCode === null && !child.killed) child.kill()
  await wait(300)
}

async function runPolicyPipeline() {
  const now = new Date().toISOString()
  const job: any = { jobId: 'policy-e2e', platformAccountId: 203, accountId: 'mock-account',
    clientName: 'Test Client', status: 'waiting', stage: 'waiting_next_check', nextCheckAt: now,
    createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString(),
    authorContextFetchedAt: now, authorContextStatus: 'empty', state: {
      posts: [{ id: 'post', text: 'distributed systems retries' }], items: [], knownIds: [],
      checks: 0, discovered: 0, published: 0, failed: 0, threadReplies: {} } }
  const published: any[] = []
  const publishedParents: string[] = []
  let openAiCalls = 0
  const adapter = {
    async listComments() { return { items: [
      { id: 'short', thread_id: 'short', text: 'Thanks!', can_reply: true,
        reply_counter: 0, created_at: now },
      { id: 'ai', thread_id: 'ai', text: 'Did ChatGPT write this post?', can_reply: true,
        reply_counter: 0, created_at: now },
      { id: 'irrelevant', thread_id: 'irrelevant', text: 'Как зовут королеву Британии?',
        can_reply: true, reply_counter: 0, created_at: now },
      { id: 'cjk', thread_id: 'cjk', text: '这是一个很有意思的观点', can_reply: true,
        reply_counter: 0, created_at: now }
    ] } },
    async listReplies() { return { items: published } },
    async getOwnProfile() { throw new Error('negative author context cache must be used') },
    async reply(_accountId: string, _postId: string, parentId: string, text: string) {
      publishedParents.push(parentId)
      const row = { id: `reply-${published.length + 1}`, is_sender: true, text }
      published.push(row); return row
    }
  }
  const openai = { async generate(input: any) {
    openAiCalls += 1
    return { replies: input.items.map((item: any) => {
      const skipReason = item.incoming_id === 'ai' ? 'ai_authorship_question' :
        item.incoming_id === 'irrelevant' ? 'irrelevant_to_context' : undefined
      return skipReason
        ? { incoming_id: item.incoming_id, action: 'skip', reason: skipReason,
          reply: '', grounding_phrase: '' }
        : { incoming_id: item.incoming_id, action: 'reply', reason: 'reply',
          reply: 'Careful retries strengthen reliable distributed systems.',
          grounding_phrase: 'distributed systems' }
    }) }
  } }
  await pollMonitorJob({ job, adapter, openai, store: { async update() {} },
    logger: { event() {} }, random: () => 0, sleep: async () => undefined })
  const byId = new Map<string, any>(
    job.state.items.map((item: any) => [item.incomingId, item]))
  assert.equal(byId.get('short')?.status, 'ignored')
  assert.equal(byId.get('short')?.reasonCode, 'too_short')
  assert.equal(byId.get('short')?.replyText, undefined)
  assert.equal(byId.get('ai')?.status, 'ignored')
  assert.equal(byId.get('ai')?.reasonCode, 'ai_authorship_question')
  assert.equal(byId.get('ai')?.replyText, undefined)
  assert.equal(byId.get('irrelevant')?.status, 'ignored')
  assert.equal(byId.get('irrelevant')?.reasonCode, 'irrelevant_to_context')
  assert.equal(byId.get('irrelevant')?.replyText, undefined)
  assert.equal(byId.get('cjk')?.status, 'verified')
  assert.equal(openAiCalls, 1)
  assert.deepEqual(publishedParents, ['cjk'])
  assert.equal(job.state.published, 1)
}

async function run() {
  await runPolicyPipeline()
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
  const backend = start(['src/features/web-console/backend/index.ts'], {
    WEB_CONSOLE_USE_MOCK_DATA: 'true', WEB_CONSOLE_HOST: '127.0.0.1',
    WEB_CONSOLE_PORT: String(API_PORT) })
  const frontend = start([vite, '--config', 'src/features/web-console/frontend/vite.config.js',
    '--host', '127.0.0.1', '--port', String(UI_PORT)], {
    WEB_CONSOLE_API_URL: `http://127.0.0.1:${API_PORT}` })
  let browser: any
  try {
    await waitForHttp(`http://127.0.0.1:${API_PORT}/api/auth/me`)
    await waitForHttp(`http://127.0.0.1:${UI_PORT}`)
    browser = await chromium.launch(); const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${UI_PORT}`)
    await page.getByTestId('email-input').fill('unicornveryevil@gmail.com')
    await page.locator('input[type="password"]').fill('101010')
    await page.getByTestId('login-button').click(); await page.getByTestId('admin-linkedin-tab').click()
    page.once('dialog', (dialog: any) => dialog.accept())
    await page.getByTestId('comment-monitor-toggle-203').click()
    await page.getByTestId('comment-monitor-203').getByText('Waiting', { exact: true }).waitFor()
    assert.equal(await page.getByTestId('comment-monitor-203').locator('a').count(), 2)
    await page.getByTestId('comment-monitor-toggle-203').click()
    await page.getByTestId('comment-monitor-203').getByText('Off', { exact: true }).waitFor()
  } finally {
    if (browser) await browser.close(); await stop(frontend); await stop(backend)
  }
}

run().then(() => console.log('linkedin comment monitor e2e passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
