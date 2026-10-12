import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { createJevBrowserAdapter, loadJevSnapshot } from './browser-adapter.ts'

const require = createRequire(import.meta.url), { chromium } = require('patchright') as typeof import('playwright')
const html = `<!doctype html><html><body><h1>Careers</h1>
<input id="search" type="search" aria-label="Search roles">
<select id="stack" aria-label="Stack"><option>All</option><option value="go">Go</option></select>
<button id="show" onclick="document.querySelector('#jobs').hidden=false">Show jobs</button>
<section id="jobs" hidden><a id="detail" href="/jobs/go">Senior Go Engineer</a></section>
<a id="next" href="/page2">Next page</a><a id="redirect" href="/redirect">Redirect</a>
<a id="linkedin" href="https://www.linkedin.com/jobs">LinkedIn</a>
<button id="popup" onclick="window.open('/popup')">Open tab</button>
<button id="post" onclick="fetch('/submit',{method:'POST'})">POST</button>
<a id="allowedRedirect" href="/redirect-good">Allowed redirect</a>
<a id="redirectChain" href="/redirect-chain">Redirect chain</a>
<button id="xhrRedirect" onclick="fetch('/redirect').catch(()=>{})">XHR redirect</button>
<a id="download" href="/file" download>Download</a>
<form id="application" action="/submit" method="post"><input type="email"><input type="password"><input type="file"><button id="submit">Submit</button></form>
<button id="externalSubmit" type="submit" form="application">External submit</button>
</body></html>`

test('Jev snapshot through Patchright: real DOM compatibility and collection boundaries', async t => {
  const received: string[] = [], server = createServer((req, res) => {
    received.push(req.method + ' ' + req.url)
    if (req.url === '/redirect') { res.writeHead(302, { location: `http://localhost:${(server.address() as any).port}/forbidden-origin` }); return res.end() }
    if (req.url === '/redirect-good') { res.writeHead(302, { location: '/page2' }); return res.end() }
    if (req.url === '/redirect-chain') { res.writeHead(307, { location: '/redirect' }); return res.end() }
    res.setHeader('Content-Type', 'text/html')
    res.end(req.url === '/page2' ? '<h1>Page two</h1><a href="/jobs/python">Senior Python Engineer</a>' : html)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as any).port}`, browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, serviceWorkers: 'block' }), other = await context.newPage()
  const snapshot = await loadJevSnapshot(), events: any[] = [], controller = new AbortController()
  const create = async (options: any = {}) => {
    const page = await context.newPage(); await page.goto(origin)
    const adapter = await createJevBrowserAdapter({ page, snapshot, allowedOrigins: [origin],
      allowedControls: ['#search', '#stack', '#show', '#detail', '#next', '#redirect', '#linkedin', '#submit', '#popup', '#post', '#allowedRedirect', '#redirectChain', '#xhrRedirect', '#download', '#externalSubmit'],
      minIntervalMs: 0, event: async event => { events.push(event) }, ...options })
    return { page, adapter }
  }
  try {
    await t.test('observe, typing, dropdown, dynamic jobs, pagination; no browser-setting override', async () => {
      const { page, adapter } = await create()
      try {
        let state = await adapter.observe()
        assert.equal(await page.evaluate(() => innerWidth), 1000)
        assert.equal(await page.evaluate(() => !!(window as any).__jevFast), true)
        assert.ok(!state.actions.some(a => /LinkedIn|submit|download/i.test(a.label)))
        await adapter.act(state, state.actions.find(a => a.kind === 'fill')!.id, 'Go')
        assert.equal(await page.locator('#search').inputValue(), 'Go')
        state = await adapter.observe(); await adapter.act(state, state.actions.find(a => a.kind === 'select')!.id)
        assert.equal(await page.locator('#stack').inputValue(), 'go')
        state = await adapter.observe(); await adapter.act(state, state.actions.find(a => a.label === 'Show jobs')!.id)
        state = await adapter.observe(); assert.ok(state.actions.some(a => a.label === 'Senior Go Engineer'))
        await adapter.act(state, state.actions.find(a => a.label === 'Next page')!.id)
        assert.match((await adapter.observe()).text, /Senior Python Engineer/)
      } finally { await adapter.close() }
    })
    await t.test('changed DOM, fabricated choices and consumed observations cannot execute', async () => {
      const { page, adapter } = await create()
      try {
        let state = await adapter.observe()
        await assert.rejects(adapter.act(state, 'fabricated'), /not_observed/)
        await page.locator('#show').evaluate(e => { e.textContent = 'Changed' })
        await assert.rejects(adapter.act(state, state.actions.find(a => a.label === 'Show jobs')!.id), /stale/)
        state = await adapter.observe(); await adapter.act(state, 'wait')
        await assert.rejects(adapter.act(state, 'wait'), /stale/)
      } finally { await adapter.close() }
    })
    await t.test('blocked POSTs and popups do not reach the local server', async () => {
      const { page, adapter } = await create()
      try {
        for (const label of ['POST', 'Open tab']) { const state = await adapter.observe(); await adapter.act(state, state.actions.find(a => a.label === label)!.id) }
        await new Promise(resolve => setTimeout(resolve, 150))
        assert.ok(!received.some(r => r.startsWith('POST ')), JSON.stringify(received))
        assert.ok(!received.some(r => r.includes('/popup')), JSON.stringify(received))
        assert.ok(!other.isClosed()); assert.ok(!page.isClosed())
      } finally { await adapter.close() }
    })
    await t.test('redirect to an unapproved loopback origin is blocked', async () => {
      const { page, adapter } = await create()
      try {
        let reached = false
        page.on('response', response => { if (response.url().includes('/forbidden-origin')) reached = true })
        const state = await adapter.observe()
        try { await adapter.act(state, state.actions.find(a => a.label === 'Redirect')!.id) } catch (e) { assert.match(String(e), /uncertain/) }
        assert.equal(reached, false)
        assert.ok(!received.some(r => r.includes('/forbidden-origin')))
      } finally { await adapter.close() }
    })
    await t.test('action limit, cancellation and cleanup preserve unrelated tabs', async () => {
      const { page, adapter } = await create({ maxActions: 1, signal: controller.signal })
      const state = await adapter.observe(); await adapter.act(state, 'wait')
      await assert.rejects(adapter.act(await adapter.observe(), 'wait'), /budget_exhausted/)
      controller.abort(); await adapter.close()
      assert.ok(page.isClosed()); assert.ok(!other.isClosed())
      await assert.rejects(adapter.observe(), /stopped/)
    })
    await t.test('logging failure after an action remains uncertain and cannot repeat it', async () => {
      const { adapter } = await create({ event: async () => { throw Error('disk failure') } })
      try {
        const state = await adapter.observe()
        await assert.rejects(adapter.act(state, 'wait'), /uncertain/)
        await assert.rejects(adapter.act(state, 'wait'), /uncertain_session/)
        await assert.rejects(adapter.observe(), /uncertain_session/)
      } finally { await adapter.close() }
    })
    await t.test('allowed redirects preserve final URL and description; redirect chains cannot escape', async () => {
      const { page, adapter } = await create()
      try {
        let state = await adapter.observe()
        await adapter.act(state, state.actions.find(a => a.label === 'Allowed redirect')!.id)
        assert.equal(page.url(), origin + '/page2')
        assert.match((await adapter.observe()).text, /Senior Python Engineer/)
        await page.goto(origin); state = await adapter.observe()
        await adapter.act(state, state.actions.find(a => a.label === 'Redirect chain')!.id).catch(e => assert.match(String(e), /uncertain/))
        assert.ok(!received.some(r => r.includes('/forbidden-origin')))
      } finally { await adapter.close() }
    })
    await t.test('XHR redirects are stopped before the disallowed destination receives a request', async () => {
      const { adapter } = await create()
      try {
        const state = await adapter.observe(); await adapter.act(state, state.actions.find(a => a.label === 'XHR redirect')!.id)
        await new Promise(resolve => setTimeout(resolve, 150))
        assert.ok(!received.some(r => r.includes('/forbidden-origin')))
      } finally { await adapter.close() }
    })
    await t.test('caller-modified observations, forged copies and cross-tab observations cannot execute', async () => {
      const a = await create(), b = await create()
      try {
        const state = await a.adapter.observe()
        await assert.rejects(b.adapter.act(state, 'wait'), /stale/)
        await assert.rejects(a.adapter.act(structuredClone(state), 'wait'), /stale/)
        state.actions.find(action => action.kind === 'select')!.value = 'forged'
        await assert.rejects(a.adapter.act(state, 'wait'), /stale/)
        assert.equal(await a.page.locator('#stack').inputValue(), 'All')
      } finally { await a.adapter.close(); await b.adapter.close() }
    })
    await t.test('concurrent commands reject the second; invalid input does not consume a valid observation', async () => {
      const { adapter, page } = await create()
      try {
        let state = await adapter.observe()
        const fill = state.actions.find(a => a.kind === 'fill')!.id
        await assert.rejects(adapter.act(state, fill, 'x'.repeat(2001)), /invalid_text/)
        await adapter.act(state, fill, 'Java')
        assert.equal(await page.locator('#search').inputValue(), 'Java')
        state = await adapter.observe()
        const first = adapter.act(state, 'wait')
        await assert.rejects(adapter.act(state, 'wait'), /concurrent/); await first
      } finally { await adapter.close() }
    })
    await t.test('covered controls cannot click through an overlay and uncertainty latches', async () => {
      const { adapter, page } = await create()
      try {
        await page.evaluate(() => { const cover = document.createElement('div'); cover.style.cssText = 'position:fixed;inset:0;z-index:9999'; document.body.append(cover) })
        const state = await adapter.observe()
        await assert.rejects(adapter.act(state, state.actions.find(a => a.label === 'Show jobs')!.id), /uncertain/)
        assert.equal(await page.locator('#jobs').isVisible(), false)
        await assert.rejects(adapter.observe(), /uncertain_session/)
      } finally { await adapter.close() }
    })
    await t.test('cancellation during pacing stops the action; concurrent close callers await cleanup', async () => {
      const abort = new AbortController(), { adapter, page } = await create({ minIntervalMs: 200, signal: abort.signal })
      const state = await adapter.observe(); await adapter.act(state, 'wait')
      const next = await adapter.observe(), pending = adapter.act(next, next.actions.find(a => a.label === 'Show jobs')!.id)
      abort.abort()
      await assert.rejects(pending, /stopped/)
      await Promise.all([adapter.close(), adapter.close()])
      assert.equal(page.isClosed(), true); assert.equal(other.isClosed(), false)
    })
    await t.test('unrelated tab networking and pre-existing routes survive adapter cleanup', async () => {
      let intercepted = 0
      await context.route('**/unrelated', async route => { intercepted++; await route.fulfill({ body: 'other route' }) })
      const { adapter } = await create()
      try {
        await other.goto(origin + '/unrelated'); assert.match(await other.content(), /other route/)
        await adapter.close(); await other.goto(origin + '/unrelated')
        assert.equal(intercepted, 2)
      } finally { await adapter.close(); await context.unroute('**/unrelated') }
    })
    await t.test('pre-aborted sessions close only their tab and invalid/live configurations are rejected', async () => {
      const abort = new AbortController(); abort.abort()
      const { adapter, page } = await create({ signal: abort.signal })
      assert.equal(page.isClosed(), true); await assert.rejects(adapter.observe(), /stopped/)
      const p = await context.newPage()
      try {
        const base = { page: p, snapshot, allowedOrigins: [origin], allowedControls: [] }
        await assert.rejects(createJevBrowserAdapter({ ...base, maxActions: NaN }), /invalid_limits/)
        await assert.rejects(createJevBrowserAdapter({ ...base, allowedOrigins: ['https://example.com'] }), /not_validated/)
        assert.equal(p.isClosed(), false)
      } finally { await p.close(); await adapter.close() }
    })
    assert.ok(events.length > 0)
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
