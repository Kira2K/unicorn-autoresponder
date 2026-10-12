import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchFixtureBrowser } from './browser-driver.ts'
import { createAtsAdapters } from '../applications/ats-forms.ts'
import type { Position } from '../types.ts'

test('same live tab continues only a verified CAPTCHA attempt with no application write', async t => {
  const browser = await launchFixtureBrowser({ channel: 'chrome' })
  const root = await mkdtemp(join(tmpdir(), 'ats-continuation-'))
  try {
    for (const scenario of ['automatic', 'receipt', 'repeated', 'disappeared', 'network-loss', 'no-write', 'guard-failed', 'opaque'] as const) {
      await t.test(scenario, async () => {
        const context = await browser.newContext()
        let requests = 0
        try {
          await context.route('**/*', async route => {
            const url = new URL(route.request().url())
            if (url.hostname === 'newassets.hcaptcha.com') return route.fulfill({ contentType: 'text/html', body: `<div id="puzzle">${scenario === 'opaque' ? '' : 'Select all images with buses'}</div><div role="checkbox" aria-checked="false"></div>` })
            if (route.request().method() === 'POST') {
              requests++
              if (scenario === 'network-loss') return route.abort('failed')
              return route.fulfill({ json: { accepted: true } })
            }
            return route.fulfill({ contentType: 'text/html', body: `<form onsubmit="event.preventDefault();if(!window.first){window.first=true;document.querySelector('#challenge').hidden=false;return}${scenario === 'no-write' ? 'return;' : ''}fetch('/submit',{method:'POST'}).then(()=>{document.body.innerHTML='<h1>Thank you for applying</h1>'}).catch(()=>{})"><button type="submit">Submit Application</button></form><iframe id="challenge" hidden style="width:400px;height:500px" title="Widget containing checkbox for hCaptcha security challenge" src="https://newassets.hcaptcha.com/captcha.html#frame=enclave"></iframe>` })
          })
          const url = `https://jobs.lever.co/fixture/${scenario}/apply`
          const position: Position = { id: scenario, url, applyUrl: url, company: 'Fixture', title: 'Engineer', location: '', description: '', retrievedAt: '', source: { name: 'Fixture', url } }
          const adapter = createAtsAdapters({ context, evidenceRoot: root, outcomeTimeoutMs: 800 }).find(a => a.name === 'lever')!
          const first = await adapter.open(position)
          const started = Date.now()
          const blocked = await first.submit()
          assert.equal(blocked.reason, 'captcha_required')
          assert.equal(blocked.evidence?.confirmation, undefined)
          assert.equal(requests, 0)
          const traces = (await readdir(root)).filter(file => file.startsWith(`${scenario}-request-`) && file.endsWith('.jsonl'))
          assert.equal(traces.length, 1)
          const events = (await readFile(join(root, traces[0]), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { event: string; requests?: number })
          assert.equal(events[0].event, 'capture_started')
          assert.equal(events.at(-1)?.event, 'observation_complete')
          assert.equal(events.at(-1)?.requests, 0)
          if (scenario === 'opaque') {
            assert.ok(Date.now() - started < 5000, 'opaque post-submit challenge hands off before the normal outcome wait')
            assert.equal(context.pages()[0].isClosed(), false)
            await first.close()
            return
          }
          // Reopen the exact tab: its first-click and network history must survive.
          const session = await adapter.open(position)
          const page = context.pages()[0]
          if (scenario === 'automatic') {
            await page.evaluate(() => { document.body.innerHTML = '<h1>Thank you for applying</h1>' })
            const outcome = await session.reconcile()
            assert.equal(outcome.status, 'succeeded'); assert.equal(outcome.evidence?.confirmation, 'captured')
            assert.equal(outcome.manualAssistance, undefined); assert.equal(requests, 0)
            await session.close()
            return
          }
          if (scenario !== 'repeated') await page.frameLocator('#challenge').locator('#puzzle').evaluate(element => { element.remove() })
          if (scenario !== 'disappeared') await page.frameLocator('#challenge').locator('[role="checkbox"]').evaluate(element => { element.setAttribute('aria-checked', 'true') })
          let approved = 0
          const outcome = await session.continueAfterCaptcha! (async () => { approved++; return scenario !== 'guard-failed' })
          if (scenario === 'receipt') {
            assert.equal(approved, 1); assert.equal(requests, 1); assert.equal(outcome.status, 'succeeded'); assert.equal(outcome.evidence?.confirmation, 'captured'); assert.equal(outcome.manualAssistance, undefined)
          } else if (scenario === 'network-loss') {
            assert.equal(approved, 1); assert.equal(requests, 1); assert.equal(outcome.status, 'unknown'); assert.equal(outcome.evidence?.confirmation, undefined)
            await session.continueAfterCaptcha! (async () => { approved++; return true })
            assert.equal(approved, 1); assert.equal(requests, 1)
          } else if (scenario === 'guard-failed') {
            assert.equal(approved, 1); assert.equal(requests, 0); assert.equal(outcome.status, 'unknown')
          } else if (scenario === 'no-write') {
            assert.equal(approved, 1); assert.equal(requests, 0); assert.equal(outcome.status, 'unknown')
            await session.continueAfterCaptcha!(async () => { approved++; return true })
            assert.equal(approved, 1); assert.equal(requests, 0)
          } else {
            assert.equal(approved, 0); assert.equal(requests, 0); assert.notEqual(outcome.status, 'succeeded')
          }
          await session.close()
        } finally { await context.close() }
      })
    }
    await t.test('delayed application write remains in the same trace across adapter reopen', async () => {
      const context = await browser.newContext()
      try {
        await context.route('**/*', route => route.request().method() === 'POST'
          ? route.fulfill({ json: { accepted: true } })
          : route.fulfill({ contentType: 'text/html', body: '<form onsubmit="event.preventDefault();document.querySelector(\'#challenge\').hidden=false"><button type="submit">Submit Application</button></form><iframe id="challenge" hidden style="width:400px;height:500px" src="https://newassets.hcaptcha.com/captcha.html#frame=enclave"></iframe>' }))
        const url = 'https://jobs.lever.co/fixture/delayed/apply'
        const position: Position = { id: 'delayed', url, applyUrl: url, company: 'Fixture', title: 'Engineer', location: '', description: '', retrievedAt: '', source: { name: 'Fixture', url } }
        const adapter = createAtsAdapters({ context, evidenceRoot: root, outcomeTimeoutMs: 800 }).find(a => a.name === 'lever')!
        const first = await adapter.open(position)
        assert.equal((await first.submit()).reason, 'captcha_required')
        const second = await adapter.open(position)
        await context.pages()[0].evaluate(() => fetch('/delayed', { method: 'POST' }))
        await second.reconcile()
        const third = await adapter.open(position)
        await context.pages()[0].evaluate(() => fetch('/delayed-again', { method: 'POST' }))
        await third.reconcile()
        const traces = (await readdir(root)).filter(file => file.startsWith('delayed-request-') && file.endsWith('.jsonl'))
        assert.equal(traces.length, 1)
        const events = (await readFile(join(root, traces[0]), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { event: string; requests?: number; count?: number })
        assert.deepEqual(events.filter(event => event.event === 'possible_application_request').map(event => event.count), [1, 2])
        assert.equal(events.at(-1)?.event, 'observation_complete')
        assert.equal(events.at(-1)?.requests, 2)
        await third.close()
      } finally { await context.close() }
    })
  } finally { await browser.close(); await rm(root, { recursive: true, force: true }) }
})
